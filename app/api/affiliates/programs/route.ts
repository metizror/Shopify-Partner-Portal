import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/affiliates/programs — list with affiliate counts.
export async function GET() {
  const [programs, counts] = await Promise.all([
    prisma.affiliateProgram.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.affiliate.groupBy({ by: ['programId'], _count: { _all: true } }),
  ])
  const byProgram = new Map(counts.map((c) => [c.programId, c._count._all]))
  return NextResponse.json(programs.map((p) => ({
    id: p.id, name: p.name, description: p.description, commissionType: p.commissionType,
    commissionValue: p.commissionValue, cookieDays: p.cookieDays, status: p.status,
    affiliates: byProgram.get(p.id) || 0,
  })))
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const created = await prisma.affiliateProgram.create({
      data: {
        name: String(b.name).slice(0, 255), description: b.description ? String(b.description) : null,
        commissionType: b.commissionType === 'fixed' ? 'fixed' : 'percentage',
        commissionValue: Number(b.commissionValue) || 0, cookieDays: Number(b.cookieDays) || 30,
        status: b.status === 'paused' ? 'paused' : 'active',
      },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    for (const k of ['name', 'description', 'status'] as const) if (typeof b[k] === 'string') data[k] = b[k]
    if (b.commissionType) data.commissionType = b.commissionType === 'fixed' ? 'fixed' : 'percentage'
    if (b.commissionValue != null) data.commissionValue = Number(b.commissionValue)
    if (b.cookieDays != null) data.cookieDays = Number(b.cookieDays)
    await prisma.affiliateProgram.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.affiliate.updateMany({ where: { programId: id }, data: { programId: null } })
    await prisma.affiliateProgram.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
