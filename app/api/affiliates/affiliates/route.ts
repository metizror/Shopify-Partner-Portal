import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { affiliateBalances } from '@/services/affiliates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const slugCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'REF'

// GET /api/affiliates/affiliates — list with program name + balances.
export async function GET() {
  const [affiliates, programs, balances] = await Promise.all([
    prisma.affiliate.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.affiliateProgram.findMany({ select: { id: true, name: true } }),
    affiliateBalances(),
  ])
  const progName = new Map(programs.map((p) => [p.id, p.name]))
  return NextResponse.json(affiliates.map((a) => {
    const b = balances.get(a.id) || { earned: 0, paid: 0, balance: 0 }
    return {
      id: a.id, name: a.name, email: a.email, code: a.code, status: a.status,
      programId: a.programId, programName: a.programId ? progName.get(a.programId) || null : null,
      earned: b.earned, paid: b.paid, balance: b.balance,
    }
  }))
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name?.trim() || !b.email?.trim()) return NextResponse.json({ error: 'name and email required' }, { status: 400 })
    let code = b.code ? slugCode(String(b.code)) : slugCode(String(b.name))
    // ensure unique
    for (let i = 0; i < 20; i++) {
      const exists = await prisma.affiliate.findUnique({ where: { code }, select: { id: true } })
      if (!exists) break
      code = slugCode(String(b.name)) + Math.floor(Math.random() * 900 + 100)
    }
    const created = await prisma.affiliate.create({
      data: {
        name: String(b.name).slice(0, 255), email: String(b.email).slice(0, 255), code,
        programId: b.programId ? Number(b.programId) : null,
        status: ['pending', 'suspended'].includes(b.status) ? b.status : 'active',
      },
    })
    return NextResponse.json({ ok: true, id: created.id, code })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    for (const k of ['name', 'email', 'status'] as const) if (typeof b[k] === 'string') data[k] = b[k]
    if ('programId' in b) data.programId = b.programId ? Number(b.programId) : null
    await prisma.affiliate.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.referral.deleteMany({ where: { affiliateId: id } })
    await prisma.affiliatePayout.deleteMany({ where: { affiliateId: id } })
    await prisma.affiliateClaim.deleteMany({ where: { affiliateId: id } })
    await prisma.affiliate.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
