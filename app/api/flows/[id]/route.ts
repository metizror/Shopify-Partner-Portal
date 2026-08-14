import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { TRIGGERS } from '@/services/flow-constants'
import { resolveFlowId, uniqueFlowSlug } from '@/services/flow-slug'
import { computeNextRun } from '@/services/flow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_TRIGGERS = new Set(TRIGGERS.map((t) => t.type))

// The [id] segment accepts either a numeric id or a slug.
// GET /api/flows/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = await resolveFlowId((await params).id)
  if (!id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const f = await prisma.flow.findUnique({ where: { id } })
  if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    id: f.id, slug: f.slug || String(f.id), name: f.name, trigger: f.trigger, appScope: f.appScope, active: f.active,
    steps: Array.isArray(f.steps) ? f.steps : [],
    layout: f.layout ?? null,
    schedule: f.schedule ?? null,
    scheduleId: f.scheduleId ?? null,
    nextRunAt: f.nextRunAt ? f.nextRunAt.toISOString() : null,
  })
}

// PATCH /api/flows/[id] — update any of name/trigger/appScope/active/steps.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = await resolveFlowId((await params).id)
    if (!id) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (typeof b.name === 'string') data.name = b.name.slice(0, 255)
    if (b.trigger !== undefined) {
      if (!VALID_TRIGGERS.has(b.trigger)) return NextResponse.json({ error: 'invalid trigger' }, { status: 400 })
      data.trigger = b.trigger
    }
    if (b.appScope !== undefined) data.appScope = String(b.appScope)
    if (typeof b.active === 'boolean') data.active = b.active
    if (Array.isArray(b.steps)) data.steps = b.steps
    if ('layout' in b) data.layout = b.layout ?? null
    // Schedule (optional, on any flow). A named schedule takes precedence over
    // inline. No schedule → nextRunAt null → the flow never auto-runs.
    const trig = (data.trigger as string | undefined) ?? undefined
    if ('schedule' in b || 'scheduleId' in b || trig !== undefined) {
      const scheduleId = b.scheduleId ? Number(b.scheduleId) : null
      let inline = !scheduleId && b.schedule ? b.schedule : null
      const willBeScheduledTrigger = (trig ?? (await prisma.flow.findUnique({ where: { id }, select: { trigger: true } }))?.trigger) === 'scheduled'
      if (willBeScheduledTrigger && !scheduleId && !inline) inline = { freq: 'daily', hour: 9, minute: 0 }
      let effective: any = inline
      if (scheduleId) {
        const s = await prisma.flowSchedule.findUnique({ where: { id: scheduleId } })
        effective = s ? { freq: s.freq, hour: s.hour, minute: s.minute, weekday: s.weekday } : null
      }
      const hasSchedule = !!(scheduleId || inline)
      data.scheduleId = scheduleId
      data.schedule = inline
      data.nextRunAt = hasSchedule && effective ? computeNextRun(effective) : null
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    // Backfill a slug for legacy flows that never had one (keeps existing slugs stable).
    const cur = await prisma.flow.findUnique({ where: { id }, select: { slug: true, name: true } })
    if (!cur?.slug) data.slug = await uniqueFlowSlug(typeof b.name === 'string' ? b.name : cur?.name || 'flow', id)
    await prisma.flow.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/flows/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = await resolveFlowId((await params).id)
    if (!id) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await prisma.flowRun.deleteMany({ where: { flowId: id } })
    await prisma.flowTask.deleteMany({ where: { flowId: id } })
    await prisma.flow.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
