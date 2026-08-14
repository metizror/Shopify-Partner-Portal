import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/affiliates/payouts
export async function GET() {
  const [payouts, affs] = await Promise.all([
    prisma.affiliatePayout.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.affiliate.findMany({ select: { id: true, name: true } }),
  ])
  const name = new Map(affs.map((a) => [a.id, a.name]))
  return NextResponse.json(payouts.map((p) => ({
    id: p.id, affiliateId: p.affiliateId, affiliateName: name.get(p.affiliateId) || `#${p.affiliateId}`,
    amount: p.amount, method: p.method, status: p.status, note: p.note,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null, createdAt: p.createdAt.toISOString(),
  })))
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    const affiliateId = Number(b.affiliateId)
    if (!affiliateId || !b.amount) return NextResponse.json({ error: 'affiliateId and amount required' }, { status: 400 })
    const paid = b.status === 'paid'
    const created = await prisma.affiliatePayout.create({
      data: {
        affiliateId, amount: Number(b.amount), method: b.method ? String(b.method).slice(0, 64) : null,
        note: b.note ? String(b.note) : null, status: paid ? 'paid' : 'pending', paidAt: paid ? new Date() : null,
      },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

// PATCH ?id= — mark paid / pending.
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (b.status === 'paid') { data.status = 'paid'; data.paidAt = new Date() }
    else if (b.status === 'pending') { data.status = 'pending'; data.paidAt = null }
    if (b.amount != null) data.amount = Number(b.amount)
    await prisma.affiliatePayout.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.affiliatePayout.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
