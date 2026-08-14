import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { affiliateBalances } from '@/services/affiliates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

// GET /api/affiliates/overview — KPIs + top affiliates + recent referrals.
export async function GET() {
  try {
    const [totalAffiliates, activePrograms, approvedAgg, pendingPayoutAgg, openClaims, balances, recent, affs] = await Promise.all([
      prisma.affiliate.count(),
      prisma.affiliateProgram.count({ where: { status: 'active' } }),
      prisma.referral.aggregate({ where: { status: 'approved' }, _sum: { commission: true } }),
      prisma.affiliatePayout.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      prisma.affiliateClaim.count({ where: { status: 'open' } }),
      affiliateBalances(),
      prisma.referral.findMany({ orderBy: { occurredAt: 'desc' }, take: 8 }),
      prisma.affiliate.findMany({ select: { id: true, name: true } }),
    ])
    const name = new Map(affs.map((a) => [a.id, a.name]))
    const top = [...balances.entries()]
      .map(([id, b]) => ({ id, name: name.get(id) || `#${id}`, balance: b.balance, earned: b.earned }))
      .sort((a, b) => b.balance - a.balance).slice(0, 5)
    return NextResponse.json({
      totalAffiliates,
      activePrograms,
      totalCommissions: round2(approvedAgg._sum.commission || 0),
      pendingPayouts: round2(pendingPayoutAgg._sum.amount || 0),
      openClaims,
      topAffiliates: top,
      recent: recent.map((r) => ({
        id: r.id, affiliateName: name.get(r.affiliateId) || `#${r.affiliateId}`,
        customer: r.customerName || r.customerDomain || '—', commission: r.commission, status: r.status,
        occurredAt: r.occurredAt.toISOString(),
      })),
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
