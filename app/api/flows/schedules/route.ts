import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { computeNextRun } from '@/services/flow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clean = (b: any) => ({
  name: String(b.name || 'Schedule').slice(0, 128),
  freq: ['hourly', 'daily', 'weekly'].includes(b.freq) ? b.freq : 'daily',
  hour: Math.min(23, Math.max(0, Number(b.hour) || 0)),
  minute: Math.min(59, Math.max(0, Number(b.minute) || 0)),
  weekday: Math.min(6, Math.max(0, Number(b.weekday) || 0)),
})

// GET /api/flows/schedules — reusable named schedules (+ how many flows use each).
export async function GET() {
  const [schedules, usage] = await Promise.all([
    prisma.flowSchedule.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.flow.groupBy({ by: ['scheduleId'], where: { scheduleId: { not: null } }, _count: { _all: true } }),
  ])
  const byId = new Map(usage.map((u) => [u.scheduleId, u._count._all]))
  return NextResponse.json(schedules.map((s) => ({ ...s, flows: byId.get(s.id) || 0 })))
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const created = await prisma.flowSchedule.create({ data: clean(b) })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

// PATCH /api/flows/schedules?id= — edit; reschedules all flows using it.
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const data = clean(await req.json().catch(() => ({})))
    await prisma.flowSchedule.update({ where: { id }, data })
    // Recompute next-run for every flow using this schedule.
    const flows = await prisma.flow.findMany({ where: { scheduleId: id, trigger: 'scheduled' } })
    const next = computeNextRun(data)
    await Promise.all(flows.map((f) => prisma.flow.update({ where: { id: f.id }, data: { nextRunAt: next } })))
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}

// DELETE /api/flows/schedules?id= — flows using it fall back to their inline schedule.
export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req); if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.flow.updateMany({ where: { scheduleId: id }, data: { scheduleId: null } })
    await prisma.flowSchedule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 }) }
}
