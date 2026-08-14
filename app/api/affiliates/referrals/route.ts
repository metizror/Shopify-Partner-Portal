import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { commissionFor } from '@/services/affiliates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/affiliates/referrals[?affiliateId=]
export async function GET(req: NextRequest) {
  const affiliateId = Number(new URL(req.url).searchParams.get('affiliateId')) || undefined
  const [refs, affs] = await Promise.all([
    prisma.referral.findMany({ where: affiliateId ? { affiliateId } : undefined, orderBy: { occurredAt: 'desc' }, take: 500 }),
    prisma.affiliate.findMany({ select: { id: true, name: true } }),
  ])
  const name = new Map(affs.map((a) => [a.id, a.name]))
  return NextResponse.json(refs.map((r) => ({
    id: r.id, affiliateId: r.affiliateId, affiliateName: name.get(r.affiliateId) || `#${r.affiliateId}`,
    customerName: r.customerName, customerDomain: r.customerDomain, saleAmount: r.saleAmount,
    commission: r.commission, status: r.status, occurredAt: r.occurredAt.toISOString(),
  })))
}

// POST — commission is derived from the affiliate's program.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    const affiliateId = Number(b.affiliateId)
    if (!affiliateId) return NextResponse.json({ error: 'affiliateId required' }, { status: 400 })
    const saleAmount = Number(b.saleAmount) || 0
    const commission = b.commission != null ? Number(b.commission) : await commissionFor(affiliateId, saleAmount)
    const created = await prisma.referral.create({
      data: {
        affiliateId, saleAmount, commission,
        customerName: b.customerName ? String(b.customerName).slice(0, 255) : null,
        customerDomain: b.customerDomain ? String(b.customerDomain).slice(0, 255) : null,
        status: ['approved', 'rejected'].includes(b.status) ? b.status : 'pending',
      },
    })
    return NextResponse.json({ ok: true, id: created.id, commission })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

// PATCH ?id= — approve/reject.
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (['pending', 'approved', 'rejected'].includes(b.status)) data.status = b.status
    if (b.commission != null) data.commission = Number(b.commission)
    await prisma.referral.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.referral.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
