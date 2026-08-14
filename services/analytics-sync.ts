// Analytics ETL: pulls the Shopify Partner API `transactions` connection for
// every connected partner org and records each financial line into the `Charge`
// table. This is what powers the Home dashboard's revenue metrics (MRR, ARPU,
// gross/net earnings) — the legacy `Event` table only ever captured a charge
// amount for a handful of rows.
//
// Transactions come back newest-first, so a normal run only needs the first
// page(s): we stop as soon as we cross the per-partner watermark (the newest
// occurredAt we saw last time). The first run has no watermark, so pass
// `fullBackfill: true` (or a generous `sinceDays`) to seed history.
//
// Charges are immutable once issued, so we insert with skipDuplicates and never
// update — `tx_id` (the Partner transaction GID tail) is the dedupe key.

import { prisma } from '@/lib/db'
import { SHOPIFY_PARTNER_API_VERSION } from '@/config'
import { partnersWithToken } from '@/services/app-catalog'

export interface SyncChargesResult {
  partners: number
  fetched: number   // transaction lines seen
  upserted: number  // new Charge rows written
  errors: string[]
}

const WATERMARK_ID = (partnerId: string) => `charges_sync:${partnerId}`
const TRANSIENT = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const KIND_BY_TYPENAME: Record<string, string> = {
  AppSubscriptionSale: 'subscription',
  AppUsageSale: 'usage',
  AppOneTimeSale: 'one_time',
  AppSaleCredit: 'credit',
  AppSaleAdjustment: 'adjustment',
}

// All AppSale* transaction types expose netAmount/grossAmount/shopifyFee/app/shop.
// chargeId + billingInterval only exist on the recurring/charge-backed types.
const TX_QUERY = `query($after: String) {
  transactions(
    first: 100
    after: $after
    types: [APP_SUBSCRIPTION_SALE, APP_USAGE_SALE, APP_ONE_TIME_SALE, APP_SALE_CREDIT, APP_SALE_ADJUSTMENT]
  ) {
    edges {
      cursor
      node {
        __typename
        ... on AppSubscriptionSale { id createdAt netAmount { amount currencyCode } grossAmount { amount } shopifyFee { amount } app { id } shop { myshopifyDomain name } chargeId billingInterval }
        ... on AppUsageSale        { id createdAt netAmount { amount currencyCode } grossAmount { amount } shopifyFee { amount } app { id } shop { myshopifyDomain name } chargeId }
        ... on AppOneTimeSale      { id createdAt netAmount { amount currencyCode } grossAmount { amount } shopifyFee { amount } app { id } shop { myshopifyDomain name } chargeId }
        ... on AppSaleCredit       { id createdAt netAmount { amount currencyCode } grossAmount { amount } shopifyFee { amount } app { id } shop { myshopifyDomain name } }
        ... on AppSaleAdjustment   { id createdAt netAmount { amount currencyCode } grossAmount { amount } shopifyFee { amount } app { id } shop { myshopifyDomain name } }
      }
    }
    pageInfo { hasNextPage }
  }
}`

interface ChargeInsert {
  txId: string
  kind: string
  partnerId: string
  appId: string
  shopDomain: string | null
  shopName: string | null
  chargeId: string | null
  billingInterval: string | null
  net: number
  gross: number
  fee: number
  currency: string
  occurredAt: Date
}

const gidTail = (gid?: string | null): string => (gid ? String(gid).split('/').pop() || '' : '')
const num = (v?: { amount?: string } | null): number => {
  const n = parseFloat(v?.amount ?? '')
  return Number.isFinite(n) ? n : 0
}

/** Fetch + record all recent transactions for one partner org. */
async function syncPartnerCharges(
  partnerId: string,
  token: string,
  opts: { budgetMs: number; cutoffMs: number; fireSub: boolean },
): Promise<{ fetched: number; upserted: number; newestMs: number }> {
  const url = `https://partners.shopify.com/${partnerId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const start = Date.now()
  let after: string | null = null
  let fetched = 0
  let upserted = 0
  let newestMs = 0
  let passedCutoff = false

  while (!passedCutoff && Date.now() - start < opts.budgetMs) {
    let body: any = null
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: TX_QUERY, variables: { after } }),
          signal: AbortSignal.timeout(20_000),
        })
      } catch {
        await sleep(500 * (attempt + 1))
        continue
      }
      if (res.status === 200) { body = await res.json(); break }
      if (res.status === 401 || res.status === 403) throw new Error('Invalid API token')
      if (TRANSIENT.has(res.status)) { await sleep(600 * (attempt + 1)); continue }
      throw new Error(`Partner API error ${res.status}`)
    }
    if (!body) throw new Error('Partner API unreachable')
    if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Partner API error')

    const conn = body?.data?.transactions
    const edges: any[] = conn?.edges || []
    const batch: ChargeInsert[] = []
    for (const e of edges) {
      const n = e?.node
      const kind = KIND_BY_TYPENAME[n?.__typename]
      if (!kind || !n?.id || !n?.createdAt) continue
      const ms = new Date(n.createdAt).getTime()
      fetched++
      if (ms < opts.cutoffMs) { passedCutoff = true; continue }
      if (ms > newestMs) newestMs = ms
      batch.push({
        txId: gidTail(n.id),
        kind,
        partnerId,
        appId: gidTail(n.app?.id),
        shopDomain: n.shop?.myshopifyDomain || null,
        shopName: n.shop?.name || null,
        chargeId: n.chargeId ? gidTail(n.chargeId) : null,
        billingInterval: n.billingInterval || null,
        net: num(n.netAmount),
        gross: num(n.grossAmount),
        fee: num(n.shopifyFee),
        currency: n.netAmount?.currencyCode || 'USD',
        occurredAt: new Date(n.createdAt),
      })
    }

    if (batch.length) {
      // Detect which rows are genuinely new so we can fire subscription_activated
      // exactly once per subscription (on its first charge, not every renewal).
      const txIds = batch.map((b) => b.txId)
      const existing = new Set(
        (await prisma.charge.findMany({ where: { txId: { in: txIds } }, select: { txId: true } })).map((x) => x.txId),
      )
      const newRows = batch.filter((b) => !existing.has(b.txId))
      if (newRows.length) {
        const r = await prisma.charge.createMany({ data: newRows, skipDuplicates: true })
        upserted += r.count
        // NOTE: subscription_activated flows are not fired here — flows only run
        // automatically on their schedule (see runDueFlows).
      }
    }

    const last = edges[edges.length - 1]
    if (passedCutoff || !conn?.pageInfo?.hasNextPage || !last?.cursor) break
    after = last.cursor
  }

  return { fetched, upserted, newestMs }
}

/**
 * Sync charges for every connected partner. Incremental by default (stops at the
 * per-partner watermark). Pass `fullBackfill: true` to ignore the watermark and
 * walk history back `sinceDays` (default 400 on a full backfill, 3 otherwise).
 */
export async function syncCharges(
  opts: { budgetMs?: number; sinceDays?: number; fullBackfill?: boolean } = {},
): Promise<SyncChargesResult> {
  const budgetMs = opts.budgetMs ?? 50_000
  // Every organisation added under Shopify → Partners. An org missing here is
  // an org that was never connected — it will not appear in revenue figures.
  const partners = await partnersWithToken()

  const result: SyncChargesResult = { partners: 0, fetched: 0, upserted: 0, errors: [] }
  const deadline = Date.now() + budgetMs

  for (const partner of partners) {
    if (!partner.apiToken || Date.now() >= deadline) continue
    result.partners++

    // Watermark: newest occurredAt we've already recorded for this partner.
    const wmRow = opts.fullBackfill
      ? null
      : await prisma.state.findUnique({ where: { id: WATERMARK_ID(partner.partnerId) } })
    const wmMs = (wmRow?.value as { throughMs?: number } | null)?.throughMs || 0

    // How far back to walk. On a full backfill, a wide window; incremental runs
    // only look a few days back beyond the watermark as a safety overlap.
    const sinceDays = opts.sinceDays ?? (opts.fullBackfill ? 400 : 3)
    const cutoffMs = Math.max(wmMs, Date.now() - sinceDays * 24 * 3_600_000)

    try {
      const { fetched, upserted, newestMs } = await syncPartnerCharges(partner.partnerId, partner.apiToken, {
        budgetMs: Math.max(5_000, deadline - Date.now()),
        cutoffMs,
        // Only fire subscription_activated on incremental runs — a full backfill
        // would flood flows with thousands of historical activations.
        fireSub: !opts.fullBackfill,
      })
      result.fetched += fetched
      result.upserted += upserted
      const throughMs = Math.max(newestMs, wmMs)
      if (throughMs > 0) {
        await prisma.state.upsert({
          where: { id: WATERMARK_ID(partner.partnerId) },
          create: { id: WATERMARK_ID(partner.partnerId), value: { throughMs } as any },
          update: { value: { throughMs } as any },
        })
      }
    } catch (e: any) {
      result.errors.push(`${partner.partnerId}: ${e?.message || 'sync failed'}`)
    }
  }

  return result
}
