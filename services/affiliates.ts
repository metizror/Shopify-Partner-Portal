// Affiliate balance math, shared by the affiliates list + overview.
// balance = approved referral commissions − paid payouts.

import { prisma } from '@/lib/db'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface Balance { earned: number; paid: number; balance: number }

export async function affiliateBalances(): Promise<Map<number, Balance>> {
  const [refs, pays] = await Promise.all([
    prisma.referral.groupBy({ by: ['affiliateId'], where: { status: 'approved' }, _sum: { commission: true } }),
    prisma.affiliatePayout.groupBy({ by: ['affiliateId'], where: { status: 'paid' }, _sum: { amount: true } }),
  ])
  const m = new Map<number, Balance>()
  for (const r of refs) m.set(r.affiliateId, { earned: round2(r._sum.commission || 0), paid: 0, balance: 0 })
  for (const p of pays) {
    const cur = m.get(p.affiliateId) || { earned: 0, paid: 0, balance: 0 }
    cur.paid = round2(p._sum.amount || 0)
    m.set(p.affiliateId, cur)
  }
  for (const v of m.values()) v.balance = round2(v.earned - v.paid)
  return m
}

/** Commission a referral earns under its affiliate's program. */
export async function commissionFor(affiliateId: number, saleAmount: number): Promise<number> {
  const aff = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { programId: true } })
  if (!aff?.programId) return 0
  const prog = await prisma.affiliateProgram.findUnique({ where: { id: aff.programId } })
  if (!prog) return 0
  const val = prog.commissionValue || 0
  return round2(prog.commissionType === 'fixed' ? val : (saleAmount * val) / 100)
}
