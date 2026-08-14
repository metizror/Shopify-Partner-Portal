import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/shopify-apps[?partnerId=...] — list synced apps, optionally for one partner.
export async function GET(req: NextRequest) {
  const partnerId = req.nextUrl.searchParams.get('partnerId') || undefined
  const rows = await prisma.shopifyApp.findMany({
    where: partnerId ? { partnerId } : undefined,
    orderBy: [{ partnerId: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      partnerId: r.partnerId,
      appId: r.appId,
      name: r.name,
      handle: r.handle,
      icon: r.icon,
      syncedAt: r.syncedAt.toISOString(),
    })),
  )
}

// POST /api/shopify-apps  body: { partnerId, appId, name, handle?, icon? }
// Manual add — stores exactly what's provided (no API lookup), so apps that
// can't be auto-discovered (unlisted / zero-sales) can be added with full
// details. Unique per (partnerId, appId) — re-adding updates the entry.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const partnerId = String(body.partnerId ?? '').trim()
  const appId = String(body.appId ?? '').trim()
  const name = String(body.name ?? '').trim()
  const handle = String(body.handle ?? '').trim() || null
  const icon = String(body.icon ?? '').trim() || null

  if (!partnerId || !appId || !name) {
    return NextResponse.json({ error: 'Partner, App ID and App name are required.' }, { status: 400 })
  }

  const partner = await prisma.shopifyPartner.findUnique({ where: { partnerId } })
  if (!partner) return NextResponse.json({ error: 'Unknown partner.' }, { status: 404 })

  const now = new Date()
  const row = await prisma.shopifyApp.upsert({
    where: { partnerId_appId: { partnerId, appId } },
    create: { partnerId, appId, name, handle, icon, syncedAt: now, source: 'manual' },
    update: { name, handle, icon, syncedAt: now, source: 'manual' },
  })
  return NextResponse.json(
    {
      id: row.id,
      partnerId: row.partnerId,
      appId: row.appId,
      name: row.name,
      handle: row.handle,
      icon: row.icon,
      syncedAt: row.syncedAt.toISOString(),
    },
    { status: 201 },
  )
}
