// Materializes the `Customer` table (the CRM store list) from the data we
// already ingest:
//   - ShopifyAppUser  → identity, per-app install status, first/last seen
//   - Charge          → LTV (lifetime gross) and MRR (current monthly recurring)
//   - StoreCountry    → country
//   - StoreEmail      → email
//
// A customer is one Shopify store (myshopify domain); a store may have several
// of our apps, so we fold ShopifyAppUser rows by domain. Only the PROJECTED
// columns are written — the user-owned CRM columns (tags, notes, accountOwner)
// are never touched, so a resync never clobbers manual edits.

import { prisma } from '@/lib/db'

const DAY_MS = 24 * 3_600_000
const MRR_WINDOW_DAYS = 35

export interface SyncCustomersResult {
  stores: number
  created: number
  updated: number
}

interface Projected {
  domain: string
  name: string
  status: string
  appIds: string[]
  firstSeen: Date | null
  lastSeen: Date | null
  country: string | null
  email: string | null
  ltv: number
  mrr: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const monthly = (gross: number, interval: string | null) => (interval === 'ANNUAL' ? gross / 12 : gross)

async function chunked<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size))
}

export async function syncCustomers(): Promise<SyncCustomersResult> {
  // 1) Fold ShopifyAppUser by domain.
  const users = await prisma.shopifyAppUser.findMany({
    select: { domain: true, appId: true, name: true, status: true, installedAt: true, uninstalledAt: true, updatedAt: true },
  })
  const byDomain = new Map<string, Projected>()
  for (const u of users) {
    if (!u.domain) continue
    const cur = byDomain.get(u.domain) || {
      domain: u.domain, name: u.name || u.domain, status: 'uninstalled', appIds: [],
      firstSeen: null, lastSeen: null, country: null, email: null, ltv: 0, mrr: 0,
    }
    if (u.name && (cur.name === cur.domain || (u.updatedAt && u.installedAt))) cur.name = u.name
    if (!cur.appIds.includes(u.appId)) cur.appIds.push(u.appId)
    if (u.status === 'installed') cur.status = 'installed' // installed if ANY app active
    const inst = u.installedAt
    const uninst = u.uninstalledAt
    if (inst && (!cur.firstSeen || inst < cur.firstSeen)) cur.firstSeen = inst
    for (const d of [inst, uninst]) if (d && (!cur.lastSeen || d > cur.lastSeen)) cur.lastSeen = d
    byDomain.set(u.domain, cur)
  }

  // 2) LTV: lifetime gross per domain.
  const ltvRows = await prisma.charge.groupBy({ by: ['shopDomain'], _sum: { gross: true } })
  for (const r of ltvRows) {
    if (!r.shopDomain) continue
    const c = byDomain.get(r.shopDomain)
    if (c) c.ltv = round2(r._sum.gross || 0)
  }

  // 3) MRR: latest subscription charge per subscription within the trailing
  //    window, normalized to a monthly figure, summed per domain.
  const since = new Date(Date.now() - MRR_WINDOW_DAYS * DAY_MS)
  const subs = await prisma.charge.findMany({
    where: { kind: 'subscription', occurredAt: { gte: since } },
    select: { shopDomain: true, chargeId: true, gross: true, billingInterval: true, occurredAt: true },
  })
  // latest per (domain, subscription key)
  const latest = new Map<string, { domain: string; gross: number; interval: string | null; ts: number }>()
  for (const s of subs) {
    if (!s.shopDomain) continue
    const key = `${s.shopDomain}::${s.chargeId || 'shop'}`
    const ts = s.occurredAt.getTime()
    const prev = latest.get(key)
    if (!prev || ts > prev.ts) latest.set(key, { domain: s.shopDomain, gross: s.gross, interval: s.billingInterval, ts })
  }
  const mrrByDomain = new Map<string, number>()
  for (const v of latest.values()) {
    const m = monthly(v.gross, v.interval)
    if (m <= 0) continue
    mrrByDomain.set(v.domain, (mrrByDomain.get(v.domain) || 0) + m)
  }
  for (const [domain, mrr] of mrrByDomain) {
    const c = byDomain.get(domain)
    if (c) c.mrr = round2(mrr)
  }

  // 4) Country + email maps.
  const [countries, emails] = await Promise.all([
    prisma.storeCountry.findMany({ select: { domain: true, country: true } }),
    prisma.storeEmail.findMany({ select: { domain: true, email: true } }),
  ])
  const countryMap = new Map(countries.map((c) => [c.domain, c.country]))
  const emailMap = new Map(emails.map((e) => [e.domain, e.email]))
  for (const c of byDomain.values()) {
    c.country = countryMap.get(c.domain) || null
    c.email = emailMap.get(c.domain) || null
  }

  // 5) Upsert — projected columns only. New rows via createMany, existing rows
  //    via targeted updates (so tags/notes/accountOwner survive).
  const all = [...byDomain.values()]
  const existing = await prisma.customer.findMany({ select: { domain: true } })
  const existingSet = new Set(existing.map((e) => e.domain))
  const toCreate = all.filter((c) => !existingSet.has(c.domain))
  const toUpdate = all.filter((c) => existingSet.has(c.domain))

  const now = new Date()
  await chunked(toCreate, 500, async (batch) => {
    await prisma.customer.createMany({
      data: batch.map((c) => ({
        domain: c.domain, name: c.name.slice(0, 255), status: c.status, country: c.country,
        email: c.email, appIds: c.appIds as any, ltv: c.ltv, mrr: c.mrr,
        firstSeen: c.firstSeen, lastSeen: c.lastSeen, syncedAt: now,
      })),
      skipDuplicates: true,
    })
  })

  await chunked(toUpdate, 40, async (batch) => {
    await Promise.all(batch.map((c) =>
      prisma.customer.update({
        where: { domain: c.domain },
        data: {
          name: c.name.slice(0, 255), status: c.status, country: c.country, email: c.email,
          appIds: c.appIds as any, ltv: c.ltv, mrr: c.mrr,
          firstSeen: c.firstSeen, lastSeen: c.lastSeen, syncedAt: now,
        },
      }),
    ))
  })

  return { stores: all.length, created: toCreate.length, updated: toUpdate.length }
}
