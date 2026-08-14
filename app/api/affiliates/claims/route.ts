import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/affiliates/claims
export async function GET() {
  const [claims, affs] = await Promise.all([
    prisma.affiliateClaim.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.affiliate.findMany({ select: { id: true, name: true } }),
  ])
  const name = new Map(affs.map((a) => [a.id, a.name]))
  return NextResponse.json(claims.map((c) => ({
    id: c.id, affiliateId: c.affiliateId, affiliateName: name.get(c.affiliateId) || `#${c.affiliateId}`,
    amount: c.amount, reason: c.reason, status: c.status, createdAt: c.createdAt.toISOString(),
  })))
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    const affiliateId = Number(b.affiliateId)
    if (!affiliateId || !b.reason?.trim()) return NextResponse.json({ error: 'affiliateId and reason required' }, { status: 400 })
    const created = await prisma.affiliateClaim.create({
      data: { affiliateId, amount: Number(b.amount) || 0, reason: String(b.reason).slice(0, 2000), status: 'open' },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

// PATCH ?id= — approve / reject.
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    if (!['open', 'approved', 'rejected'].includes(b.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    await prisma.affiliateClaim.update({ where: { id }, data: { status: b.status } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.affiliateClaim.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
