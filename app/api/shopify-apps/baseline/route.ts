import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { seedBaselinesFromAppStats } from '@/services/install-baseline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const metaId = (appId: string) => `app_users_meta:${appId}`

// GET /api/shopify-apps/baseline
// Show each app's current install baseline anchor (installed snapshot + asOf).
export async function GET(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const metas = await prisma.state.findMany({ where: { id: { startsWith: 'app_users_meta:' } } })
  const out = metas
    .map((m) => {
      const v = m.value as any
      return {
        appId: m.id.slice('app_users_meta:'.length),
        baselineInstalled: typeof v?.baselineInstalled === 'number' ? v.baselineInstalled : null,
        baselineAsOf: typeof v?.baselineAsOf === 'string' ? v.baselineAsOf : null,
      }
    })
    .filter((x) => x.baselineInstalled != null)
  return NextResponse.json({ baselines: out })
}

// POST /api/shopify-apps/baseline
//   { "mode": "seed", "backfill": true }      → seed all from app_stats snapshots
//   { "appId": "1533025", "installed": 2451, "asOf": "2026-05-26T06:03:25Z" }
//                                             → set/override one app manually
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({} as any))

  // Manual single-app override.
  if (body?.appId && typeof body?.installed === 'number') {
    const appId = String(body.appId)
    const asOf = typeof body.asOf === 'string' ? body.asOf : new Date().toISOString()
    const metaRow = await prisma.state.findUnique({ where: { id: metaId(appId) } })
    const prev = (metaRow?.value as any) || {}
    const value = { ...prev, baselineInstalled: body.installed, baselineAsOf: asOf }
    await prisma.state.upsert({
      where: { id: metaId(appId) },
      create: { id: metaId(appId), value: value as any },
      update: { value: value as any },
    })
    return NextResponse.json({ ok: true, appId, baselineInstalled: body.installed, baselineAsOf: asOf })
  }

  // Bulk seed from app_stats.
  try {
    const result = await seedBaselinesFromAppStats({ backfill: body?.backfill !== false })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}
