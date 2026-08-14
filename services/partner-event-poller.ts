// Token-based partner event poller. Uses the Shopify Partner API token (NO
// partner cookie) to pull each app's recent install/uninstall events — which
// come back newest-first, so today's activity is always on the first page(s).
// For every run it:
//   1. Updates the per-app daily trend (app_users_meta:<appId>) — powers the
//      "installs/uninstalls today" counts.
//   2. When notify=true, records any brand-new event to ShopifyAppEvent and
//      sends the welcome/alert emails via services/partner-notify.ts.
//
// This is the practical replacement for a Shopify "partner webhook" (which does
// not exist for relationship events): instead of each app POSTing to us, we
// poll the API and fan out the same notifications from one place.
//
// First-run safety: on the very first notify run we SEED — record existing
// recent events and set a watermark WITHOUT emailing — so enabling the poller
// never blasts a backlog of alerts. Only events newer than the watermark email.

import { prisma } from '@/lib/db'
import { SHOPIFY_PARTNER_API_VERSION } from '@/config'
import { calendarDay } from '@/lib/tz'
import type { TrendPoint } from '@/services/shopify-partner'
import { persistAppEvent, sendInstallEmails, sendUninstallEmails } from '@/services/partner-notify'
import { drainFlowTasks, runDueFlows, runFlowsForTrigger } from '@/services/flow-engine'
import { drainCampaignSends } from '@/services/campaigns'
import { drainSequenceSends, enrollTriggeredSequences, runDueSequences } from '@/services/sequences'
import { pollSequenceReplies } from '@/services/sequence-replies'
import { captureUninstallSnapshot, retryPendingSnapshots } from '@/services/uninstall-enrichment'

export interface PollResult {
  apps: number
  seeded: boolean
  recorded: number   // new events written to ShopifyAppEvent
  emailed: number    // events that triggered emails
  errors: string[]
}

const NOTIFY_STATE_ID = 'partner_notify_state'
const metaId = (appId: string) => `app_users_meta:${appId}`
const TRANSIENT = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Which calendar day an event belongs to, in the display timezone (TZ_DISPLAY),
// so the trend buckets line up with the dates the dashboard renders.
const istDay = (iso: string) => calendarDay(new Date(iso))

export interface RecentEvent {
  type: 'installed' | 'uninstalled'
  occurredAt: string
  domain: string
  name: string
  // Uninstall survey only, and only when the merchant filled it in.
  reason?: string
  description?: string
}

function mergeTrend(a: TrendPoint[], b: TrendPoint[]): TrendPoint[] {
  const m = new Map<string, { installs: number; uninstalls: number }>()
  for (const p of [...a, ...b]) {
    const cur = m.get(p.date)
    if (!cur) m.set(p.date, { installs: p.installs, uninstalls: p.uninstalls })
    else {
      cur.installs = Math.max(cur.installs, p.installs)
      cur.uninstalls = Math.max(cur.uninstalls, p.uninstalls)
    }
  }
  return [...m.entries()]
    .map(([date, v]) => ({ date, installs: v.installs, uninstalls: v.uninstalls }))
    .sort((x, y) => (x.date < y.date ? -1 : 1))
}

const RECENT_QUERY = `query($id: ID!, $after: String) {
  app(id: $id) {
    events(first: 100, after: $after, types: [RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED]) {
      edges {
        cursor
        node {
          ... on RelationshipInstalled   { type occurredAt shop { myshopifyDomain name } }
          ... on RelationshipUninstalled { type occurredAt reason description shop { myshopifyDomain name } }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`

// Fetch recent install/uninstall events (newest-first) for one app, stopping
// once events pass the cutoff. Cheap — usually one page. Exported so the
// baseline seeder can reuse it to backfill a wider window.
export async function fetchRecentAppEvents(
  orgId: string,
  appId: string,
  token: string,
  opts: { sinceDays?: number; maxPages?: number } = {},
): Promise<RecentEvent[]> {
  const sinceDays = opts.sinceDays ?? 8
  const maxPages = opts.maxPages ?? 6
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const gid = `gid://partners/App/${appId}`
  const cutoff = Date.now() - sinceDays * 24 * 3_600_000

  const out: RecentEvent[] = []
  let after: string | null = null
  let pages = 0
  let passedCutoff = false

  while (pages < maxPages && !passedCutoff) {
    let body: any = null
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: RECENT_QUERY, variables: { id: gid, after } }),
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

    const conn = body?.data?.app?.events
    const edges: any[] = conn?.edges || []
    for (const e of edges) {
      const n = e?.node
      if (!n?.occurredAt) continue
      if (new Date(n.occurredAt).getTime() < cutoff) { passedCutoff = true; continue }
      out.push({
        type: n.type === 'RELATIONSHIP_INSTALLED' ? 'installed' : 'uninstalled',
        occurredAt: n.occurredAt,
        domain: n.shop?.myshopifyDomain || '',
        name: n.shop?.name || n.shop?.myshopifyDomain || '',
        reason: n.reason || undefined,
        description: n.description || undefined,
      })
    }
    pages++
    const last = edges[edges.length - 1]
    if (passedCutoff || !conn?.pageInfo?.hasNextPage || !last?.cursor) break
    after = last.cursor
  }
  return out
}

function trendFromEvents(events: RecentEvent[]): TrendPoint[] {
  const m = new Map<string, { installs: number; uninstalls: number }>()
  for (const e of events) {
    const d = istDay(e.occurredAt)
    const t = m.get(d) || { installs: 0, uninstalls: 0 }
    if (e.type === 'installed') t.installs++
    else t.uninstalls++
    m.set(d, t)
  }
  return [...m.entries()]
    .map(([date, v]) => ({ date, installs: v.installs, uninstalls: v.uninstalls }))
    .sort((x, y) => (x.date < y.date ? -1 : 1))
}

/**
 * Poll every connected app's recent events. Always refreshes the daily trend;
 * when `notify` is true, records new events and emails those newer than the
 * stored watermark (seeding silently on the first run).
 */
export async function pollPartnerEvents(
  opts: { notify?: boolean; deadlineMs?: number } = {},
): Promise<PollResult> {
  const notify = opts.notify ?? false
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000)
  const result: PollResult = { apps: 0, seeded: false, recorded: 0, emailed: 0, errors: [] }

  const apps = await prisma.shopifyApp.findMany({ select: { appId: true, partnerId: true } })
  const partners = await prisma.shopifyPartner.findMany({ select: { partnerId: true, apiToken: true } })
  const tokenByPartner = new Map(partners.map((p) => [p.partnerId, p.apiToken]))

  // Watermark: only email events strictly newer than this. null → first run.
  const stateRow = await prisma.state.findUnique({ where: { id: NOTIFY_STATE_ID } })
  const prevThrough = (stateRow?.value as { notifiedThrough?: string } | null)?.notifiedThrough || null
  const firstRun = notify && !prevThrough
  result.seeded = firstRun
  let maxSeen = prevThrough ? new Date(prevThrough).getTime() : 0

  for (const app of apps) {
    result.apps++
    const token = tokenByPartner.get(app.partnerId)
    if (!token || Date.now() >= deadline) continue

    let events: RecentEvent[]
    try {
      events = await fetchRecentAppEvents(app.partnerId, app.appId, token)
    } catch (e: any) {
      result.errors.push(`${app.appId}: ${e?.message || 'fetch failed'}`)
      continue
    }

    // 1) Trend refresh (always).
    try {
      const recent = trendFromEvents(events)
      const existing = await prisma.state.findUnique({ where: { id: metaId(app.appId) } })
      const prev = (existing?.value as any) || {}
      const value = {
        ...prev,
        source: 'partner_api',
        trend: mergeTrend((prev.trend as TrendPoint[]) || [], recent),
        syncedAt: new Date().toISOString(),
      }
      await prisma.state.upsert({
        where: { id: metaId(app.appId) },
        create: { id: metaId(app.appId), value: value as any },
        update: { value: value as any },
      })
    } catch (e: any) {
      result.errors.push(`${app.appId}: trend ${e?.message || 'failed'}`)
    }

    if (!notify) continue

    // 2) Record + notify new events (oldest→newest so emails arrive in order).
    for (const ev of [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))) {
      const ts = new Date(ev.occurredAt).getTime()
      if (ts > maxSeen) maxSeen = ts
      const isNew = await persistAppEvent(ev.type, app.appId, ev.domain, ev.name, ev.occurredAt, 'poller')
      if (!isNew) continue
      result.recorded++

      // Capture the app's own record of this store (install date, plan, usage
      // duration, last user) while the app still has it — Flow emails read this
      // snapshot, and a delayed/scheduled flow may not send for days by which
      // point the app has purged the shop. Runs even on a seed run: it's cheap
      // and gives the first real uninstall some history to work with.
      if (ev.type === 'uninstalled' && Date.now() < deadline - 10_000) {
        try {
          await captureUninstallSnapshot({
            appId: app.appId,
            domain: ev.domain,
            occurredAt: ev.occurredAt,
            reason: ev.reason,
            description: ev.description,
          })
        } catch (e: any) {
          result.errors.push(`${app.appId}: enrich ${e?.message || 'failed'}`)
        }
      }

      // Seed run: record but never email. Otherwise email only if newer than
      // the previous watermark.
      if (firstRun) continue
      if (prevThrough && ts <= new Date(prevThrough).getTime()) continue
      try {
        if (ev.type === 'installed') await sendInstallEmails(app.appId, ev.domain, ev.name, ev.occurredAt)
        else await sendUninstallEmails(app.appId, ev.domain, ev.name, ev.occurredAt)
        result.emailed++
      } catch (e: any) {
        result.errors.push(`${app.appId}: email ${e?.message || 'failed'}`)
      }
      // Fire matching automation Flows for this real event. Only schedule-less
      // flows run here (scheduled ones batch to their time via runDueFlows); this
      // block only runs for brand-new, past-watermark events, so each event fires
      // its flows exactly once — no duplicate sends.
      try {
        // A reinstall is just an install — it fires customer_installs like any
        // other, so a returning store runs the install flow once and no more.
        const trigger = ev.type === 'uninstalled' ? 'customer_uninstalls' : 'customer_installs'
        await runFlowsForTrigger({ trigger, appId: app.appId, domain: ev.domain, storeName: ev.name, occurredAt: ev.occurredAt })
      } catch (e: any) {
        result.errors.push(`${app.appId}: flow ${e?.message || 'failed'}`)
      }
      // Enrol the store into any merchant sequence armed for this event. The
      // fresh email is queued now; its follow-ups run on the contact's own
      // clock (services/sequences.ts).
      try {
        await enrollTriggeredSequences({
          trigger: ev.type === 'uninstalled' ? 'uninstall' : 'install',
          appId: app.appId, domain: ev.domain, storeName: ev.name, occurredAt: ev.occurredAt,
        })
      } catch (e: any) {
        result.errors.push(`${app.appId}: sequence ${e?.message || 'failed'}`)
      }
    }
  }

  // Drain any delayed flow actions whose timer has elapsed, and run any flow
  // whose schedule is due.
  if (notify) {
    try {
      const drained = await drainFlowTasks(100)
      if (drained.processed > drained.ok) result.errors.push(`flow-tasks: ${drained.processed - drained.ok} failed`)
    } catch { /* best-effort */ }
    try {
      await runDueFlows()
    } catch { /* best-effort */ }
    // Re-attempt uninstall snapshots that failed, or whose app hadn't yet
    // processed its own uninstall webhook when we first asked. Also backfills
    // recent churn for an app whose endpoint was configured after the fact.
    try {
      await retryPendingSnapshots({ deadlineMs: 15_000 })
    } catch { /* best-effort */ }
    // Drain any due campaign sends (send-now batches + scheduled campaigns whose
    // time has arrived). No-ops on environments without BREVO_API_KEY.
    try {
      await drainCampaignSends({ deadlineMs: 30_000 })
    } catch { /* best-effort */ }
    // Advance any due campaign sequences (enqueue this cycle's fresh/follow-up
    // emails) and drain their queue. Draining no-ops without BREVO_API_KEY.
    try {
      await runDueSequences()
    } catch { /* best-effort */ }
    try {
      await drainSequenceSends({ deadlineMs: 20_000 })
    } catch { /* best-effort */ }
    // Auto-detect sequence replies by polling the Zoho inbox. No-ops unless the
    // ZOHO_* env vars are set (see services/zoho-mail.ts).
    try {
      await pollSequenceReplies()
    } catch { /* best-effort */ }
  }

  // Advance the watermark so the next run only considers newer events.
  if (notify) {
    const notifiedThrough = new Date(Math.max(maxSeen, prevThrough ? new Date(prevThrough).getTime() : 0)).toISOString()
    await prisma.state.upsert({
      where: { id: NOTIFY_STATE_ID },
      create: { id: NOTIFY_STATE_ID, value: { notifiedThrough } as any },
      update: { value: { notifiedThrough } as any },
    })
  }

  return result
}
