import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fetchAppUsers, type TrendPoint } from '@/services/shopify-partner'
import { slugify } from '@/lib/slug'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Source = 'partner_dashboard' | 'partner_api'

interface UserMeta {
  source: Source
  currentInstalls: number | null // authoritative panel count (unused on the API path)
  trend: TrendPoint[]
  partial: boolean
  syncedAt: string
}

const metaId = (appId: string) => `app_users_meta:${appId}`

// GET /api/shopify-apps/by-slug/[slug]?refresh=1
// Resolves an app by handle / name-slug / appId, then returns it with ALL its
// users (installed stores) and per-day install/uninstall trend, sourced purely
// from the Shopify Partner API token — no partner session cookie required.
// Results are cached in the DB so only the first visit is slow.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const decoded = decodeURIComponent(slug)
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'

  // Resolve the app: handle match → name-slug match → appId fallback.
  let app = await prisma.shopifyApp.findFirst({ where: { handle: decoded } })
  if (!app) {
    const all = await prisma.shopifyApp.findMany()
    app =
      all.find((a) => slugify(a.name) === decoded) ||
      all.find((a) => a.appId === decoded) ||
      null
  }
  if (!app) return NextResponse.json({ error: 'App not found.' }, { status: 404 })

  const partner = await prisma.shopifyPartner.findUnique({ where: { partnerId: app.partnerId } })

  const appOut = {
    id: app.id,
    partnerId: app.partnerId,
    appId: app.appId,
    name: app.name,
    handle: app.handle,
    icon: app.icon,
    syncedAt: app.syncedAt.toISOString(),
  }

  if (!partner) {
    return NextResponse.json({
      app: appOut,
      partnerName: `Partner ${app.partnerId}`,
      users: [],
      installed: 0,
      uninstalled: 0,
      authoritativeInstalls: null,
      source: 'partner_api' as Source,
      trend: [],
      partial: false,
      cached: false,
      lastSyncedAt: null,
      usersError: 'No connected partner found for this app.',
    })
  }

  // ── Serve from cache unless a refresh was requested ──────────────────────
  if (!refresh) {
    const cached = await prisma.shopifyAppUser.findMany({
      where: { appId: app.appId },
      orderBy: [{ status: 'asc' }, { installedAt: 'desc' }],
    })
    if (cached.length > 0) {
      const metaRow = await prisma.state.findUnique({ where: { id: metaId(app.appId) } })
      const meta = (metaRow?.value as unknown as UserMeta | null) || null
      const lastSyncedAt = cached.reduce<Date | null>(
        (max, r) => (!max || r.syncedAt > max ? r.syncedAt : max),
        null,
      )
      return NextResponse.json({
        app: appOut,
        partnerName: partner.orgName,
        users: cached.map((r) => ({
          domain: r.domain,
          name: r.name,
          status: r.status,
          installedAt: r.installedAt ? r.installedAt.toISOString() : null,
          uninstalledAt: r.uninstalledAt ? r.uninstalledAt.toISOString() : null,
          uninstallReason: r.uninstallReason,
          uninstallDescription: r.uninstallDescription,
        })),
        installed: cached.filter((r) => r.status === 'installed').length,
        uninstalled: cached.filter((r) => r.status === 'uninstalled').length,
        authoritativeInstalls: meta?.currentInstalls ?? null,
        source: meta?.source ?? ('partner_api' as Source),
        trend: meta?.trend ?? [],
        partial: meta?.partial ?? false,
        cached: true,
        lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
        usersError: null,
      })
    }
  }

  // ── Live fetch via the Partner API token (no partner cookie needed) ───────
  // fetchAppUsers folds the app's install/uninstall/reactivate/deactivate
  // events per store domain, so `installed` is the exact count of stores whose
  // latest event leaves them installed, and `trend` is the per-IST-day
  // install/uninstall breakdown. `partial` is true only if the app's event
  // history was too large to paginate fully within the time budget.
  let users: { domain: string; name: string; status: string; installedAt?: string | null; uninstalledAt?: string | null; uninstallReason?: string | null; uninstallDescription?: string | null }[] = []
  let installed = 0
  let uninstalled = 0
  const authoritativeInstalls: number | null = null
  const source: Source = 'partner_api'
  let partial = false
  let trend: TrendPoint[] = []

  try {
    const r = await fetchAppUsers(partner.partnerId, app.appId, partner.apiToken, { budgetMs: 240_000 })
    users = r.users
    installed = r.installed
    uninstalled = r.uninstalled
    partial = r.partial
    trend = r.trend
  } catch (e: any) {
    return NextResponse.json({
      app: appOut,
      partnerName: partner.orgName,
      users: [],
      installed: 0,
      uninstalled: 0,
      authoritativeInstalls: null,
      source: 'partner_api' as Source,
      trend: [],
      partial: false,
      cached: false,
      lastSyncedAt: null,
      usersError: e?.message || 'Could not load users for this app.',
    })
  }
  const partialNote = partial
    ? 'Partial data — this app has a very large event history and could not be fully paginated within the time limit. Counts may be slightly under-reported; try Refresh again.'
    : null

  // Persist as the cache + record source/authoritative count.
  const now = new Date()
  await prisma.shopifyAppUser.deleteMany({ where: { appId: app.appId } })
  if (users.length > 0) {
    await prisma.shopifyAppUser.createMany({
      data: users.map((u) => ({
        partnerId: app!.partnerId,
        appId: app!.appId,
        domain: u.domain,
        name: u.name,
        status: u.status,
        installedAt: u.installedAt ? new Date(u.installedAt) : null,
        uninstalledAt: u.uninstalledAt ? new Date(u.uninstalledAt) : null,
        uninstallReason: u.uninstallReason ?? null,
        uninstallDescription: u.uninstallDescription ?? null,
        syncedAt: now,
      })),
    })
  }
  const meta: UserMeta = { source, currentInstalls: authoritativeInstalls, trend, partial, syncedAt: now.toISOString() }
  await prisma.state.upsert({
    where: { id: metaId(app.appId) },
    create: { id: metaId(app.appId), value: meta as any },
    update: { value: meta as any },
  })

  return NextResponse.json({
    app: appOut,
    partnerName: partner.orgName,
    users,
    installed,
    uninstalled,
    authoritativeInstalls,
    source,
    trend,
    partial,
    cached: false,
    lastSyncedAt: now.toISOString(),
    usersError: partialNote,
  })
}
