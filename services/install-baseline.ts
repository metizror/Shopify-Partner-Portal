// Incremental-baseline install total.
//
// The Partner API can't cheaply reproduce an app's lifetime installed count
// (install events for the existing base are older than the retained/paginable
// window). So we anchor to a known-authoritative snapshot — the cookie-scraped
// `app_stats:<appId>.current_installs` — and then keep it live by applying the
// token's accurate install/uninstall deltas that happen AFTER the snapshot.
//
//   installed(now) = baselineInstalled + (installs after asOf) − (uninstalls after asOf)
//
// The deltas come from ShopifyAppEvent (the deduped record the poller/webhook
// maintain), so the number is derived — never drifts from double counting.
// This file seeds the baselines and backfills the events between the snapshot
// date and now so no delta is missed.

import { prisma } from '@/lib/db'
import { persistAppEvent } from '@/services/partner-notify'
import { fetchRecentAppEvents } from '@/services/partner-event-poller'

const metaId = (appId: string) => `app_users_meta:${appId}`
const statsId = (appId: string) => `app_stats:${appId}`

export interface BaselineSeedResult {
  apps: number
  seeded: number
  backfilled: number
  skipped: string[]
  errors: string[]
}

// Backfill install/uninstall events from `sinceIso` up to now into
// ShopifyAppEvent (idempotent), so post-baseline deltas are complete.
async function backfillEventsSince(
  orgId: string,
  appId: string,
  token: string,
  sinceIso: string,
): Promise<number> {
  const sinceMs = new Date(sinceIso).getTime()
  const sinceDays = Math.max(1, Math.ceil((Date.now() - sinceMs) / 86_400_000) + 1)
  const events = await fetchRecentAppEvents(orgId, appId, token, { sinceDays, maxPages: 40 })
  let n = 0
  for (const ev of events) {
    if (new Date(ev.occurredAt).getTime() <= sinceMs) continue // strictly after asOf
    const isNew = await persistAppEvent(ev.type, appId, ev.domain, ev.name, ev.occurredAt, 'seed')
    if (isNew) n++
  }
  return n
}

/**
 * Seed each app's baseline from its cookie-scraped `app_stats` snapshot, then
 * backfill the events since that snapshot so the derived total is accurate from
 * the first render. Safe to re-run: re-seeding just refreshes the anchor.
 */
export async function seedBaselinesFromAppStats(
  opts: { backfill?: boolean } = {},
): Promise<BaselineSeedResult> {
  const backfill = opts.backfill ?? true
  const result: BaselineSeedResult = { apps: 0, seeded: 0, backfilled: 0, skipped: [], errors: [] }

  const apps = await prisma.shopifyApp.findMany({ select: { appId: true, partnerId: true } })
  const partners = await prisma.shopifyPartner.findMany({ select: { partnerId: true, apiToken: true } })
  const tokenByPartner = new Map(partners.map((p) => [p.partnerId, p.apiToken]))

  for (const app of apps) {
    result.apps++
    try {
      const stats = await prisma.state.findUnique({ where: { id: statsId(app.appId) } })
      const val = (stats?.value as any) || null
      const count = typeof val?.current_installs === 'number' ? val.current_installs : null
      const asOf = typeof val?.updated_at === 'string' ? val.updated_at : null
      if (count == null || count <= 0 || !asOf) {
        result.skipped.push(`${app.appId}: no app_stats snapshot`)
        continue
      }

      // Backfill events between the snapshot and now (before writing the
      // baseline, so a concurrent read never sees baseline without its deltas).
      const token = tokenByPartner.get(app.partnerId)
      if (backfill && token) {
        try {
          result.backfilled += await backfillEventsSince(app.partnerId, app.appId, token, asOf)
        } catch (e: any) {
          result.errors.push(`${app.appId}: backfill ${e?.message || 'failed'}`)
        }
      }

      const metaRow = await prisma.state.findUnique({ where: { id: metaId(app.appId) } })
      const prev = (metaRow?.value as any) || {}
      const value = { ...prev, baselineInstalled: count, baselineAsOf: asOf }
      await prisma.state.upsert({
        where: { id: metaId(app.appId) },
        create: { id: metaId(app.appId), value: value as any },
        update: { value: value as any },
      })
      result.seeded++
    } catch (e: any) {
      result.errors.push(`${app.appId}: ${e?.message || 'seed failed'}`)
    }
  }

  return result
}
