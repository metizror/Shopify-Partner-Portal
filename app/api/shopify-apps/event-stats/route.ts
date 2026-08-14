import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dayBounds, today as displayToday } from '@/lib/tz'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TrendPoint { date: string; installs: number; uninstalls: number }
type Counts = { installs: number; uninstalls: number; installed: number }

// "Today" and its UTC bounds are resolved in the display timezone (TZ_DISPLAY).
// These used to add 5.5 hours and hardcode a +05:30 offset, which pinned the
// dashboard to India and broke for any zone that observes daylight saving.

// GET /api/shopify-apps/event-stats[?appId=...&partnerId=...]
// Today's (IST) install/uninstall counts plus the currently-installed total,
// grouped by app and by partner. Today's counts are the MAX of two sources:
//   1. live webhook events (ShopifyAppEvent) — updates the instant an install/
//      uninstall happens, no scrape needed.
//   2. the periodic scrape trend (app_users_meta:<appId>) — reconciliation.
// Taking the max keeps the number live while never under-reporting if one
// source hasn't caught up yet. The installed total comes from the scrape.
export async function GET(req: NextRequest) {
  const onlyAppId = req.nextUrl.searchParams.get('appId') || undefined
  const onlyPartnerId = req.nextUrl.searchParams.get('partnerId') || undefined
  const today = displayToday()
  const { start: dayStart, end: dayEnd } = dayBounds(today)

  const apps = await prisma.shopifyApp.findMany({
    where: { ...(onlyAppId ? { appId: onlyAppId } : {}), ...(onlyPartnerId ? { partnerId: onlyPartnerId } : {}) },
    select: { appId: true, partnerId: true },
  })

  // Live webhook counts for today (IST), grouped by app + type.
  const liveRows = await prisma.shopifyAppEvent.groupBy({
    by: ['appId', 'type'],
    where: {
      occurredAt: { gte: dayStart, lt: dayEnd },
      ...(onlyAppId ? { appId: onlyAppId } : {}),
      ...(onlyPartnerId ? { partnerId: onlyPartnerId } : {}),
    },
    _count: { _all: true },
  })
  const liveByApp = new Map<string, { installs: number; uninstalls: number }>()
  for (const r of liveRows) {
    const e = liveByApp.get(r.appId) ?? { installs: 0, uninstalls: 0 }
    if (r.type === 'installed') e.installs += r._count._all
    else if (r.type === 'uninstalled') e.uninstalls += r._count._all
    liveByApp.set(r.appId, e)
  }

  // Per-app trend + install-count anchors from the cached meta.
  //  - baselineInstalled/baselineAsOf: authoritative snapshot (from app_stats)
  //    that we keep live by applying post-snapshot deltas (see install-baseline).
  //  - currentInstalls: legacy authoritative panel count (cookie path).
  // Exact Partner-panel install count from the cookie scraper (app_stats). This
  // is the authoritative "Installs" number; used first when present & fresh.
  const statRows = await prisma.state.findMany({ where: { id: { startsWith: 'app_stats:' } } })
  const panelInstallsByApp = new Map<string, number>()
  for (const s of statRows) {
    const appId = s.id.slice('app_stats:'.length)
    const ci = (s.value as any)?.current_installs
    if (typeof ci === 'number' && ci > 0) panelInstallsByApp.set(appId, ci)
  }

  const metas = await prisma.state.findMany({ where: { id: { startsWith: 'app_users_meta:' } } })
  const trendByApp = new Map<string, TrendPoint[]>()
  const currentInstallsByApp = new Map<string, number | null>()
  const baselineByApp = new Map<string, { installed: number; asOf: Date }>()
  for (const m of metas) {
    const appId = m.id.slice('app_users_meta:'.length)
    const val = m.value as any
    trendByApp.set(appId, (val?.trend as TrendPoint[]) || [])
    currentInstallsByApp.set(appId, typeof val?.currentInstalls === 'number' ? val.currentInstalls : null)
    if (typeof val?.baselineInstalled === 'number' && typeof val?.baselineAsOf === 'string') {
      baselineByApp.set(appId, { installed: val.baselineInstalled, asOf: new Date(val.baselineAsOf) })
    }
  }

  // Post-baseline install/uninstall deltas per app (events strictly after each
  // app's snapshot date), so installed = baseline + installs − uninstalls.
  const baselineDeltaByApp = new Map<string, number>()
  await Promise.all(
    [...baselineByApp.entries()].map(async ([appId, b]) => {
      const rows = await prisma.shopifyAppEvent.groupBy({
        by: ['type'],
        where: { appId, occurredAt: { gt: b.asOf } },
        _count: { _all: true },
      })
      let delta = 0
      for (const r of rows) {
        if (r.type === 'installed') delta += r._count._all
        else if (r.type === 'uninstalled') delta -= r._count._all
      }
      baselineDeltaByApp.set(appId, delta)
    }),
  )

  // Fallback installed total = count of cached users still installed (used when
  // there's no authoritative panel count, i.e. the Partner API path).
  const grouped = await prisma.shopifyAppUser.groupBy({
    by: ['appId'],
    where: {
      status: 'installed',
      ...(onlyAppId ? { appId: onlyAppId } : {}),
      ...(onlyPartnerId ? { partnerId: onlyPartnerId } : {}),
    },
    _count: { _all: true },
  })
  const installedByApp = new Map(grouped.map((g) => [g.appId, g._count._all]))

  const byApp: Record<string, Counts> = {}
  const byPartner: Record<string, Counts> = {}
  for (const app of apps) {
    const point = (trendByApp.get(app.appId) || []).find((t) => t.date === today)
    const live = liveByApp.get(app.appId)
    const ci = currentInstallsByApp.get(app.appId)
    // Installed-count priority:
    //   1. exact Partner-panel count from the cookie scraper (app_stats)
    //   2. incremental baseline (replay/snapshot) + live token deltas
    //   3. legacy panel count / cached-user count
    const panel = panelInstallsByApp.get(app.appId)
    const base = baselineByApp.get(app.appId)
    const installed = panel != null
      ? panel
      : base
        ? Math.max(0, base.installed + (baselineDeltaByApp.get(app.appId) ?? 0))
        : ci != null && ci > 0
          ? ci
          : (installedByApp.get(app.appId) ?? 0)
    const c: Counts = {
      installs: Math.max(point?.installs ?? 0, live?.installs ?? 0),
      uninstalls: Math.max(point?.uninstalls ?? 0, live?.uninstalls ?? 0),
      installed,
    }
    byApp[app.appId] = c
    const p = (byPartner[app.partnerId] ??= { installs: 0, uninstalls: 0, installed: 0 })
    p.installs += c.installs
    p.uninstalls += c.uninstalls
    p.installed += c.installed
  }

  return NextResponse.json({ date: today, byApp, byPartner })
}
