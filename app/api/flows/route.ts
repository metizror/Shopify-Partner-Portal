import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { TRIGGERS } from '@/services/flow-constants'
import { uniqueFlowSlug } from '@/services/flow-slug'
import { computeNextRun } from '@/services/flow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_TRIGGERS = new Set(TRIGGERS.map((t) => t.type))

// GET /api/flows — list flows with run counts.
export async function GET() {
  const flows = await prisma.flow.findMany({ orderBy: { updatedAt: 'desc' } })
  const runCounts = await prisma.flowRun.groupBy({ by: ['flowId'], _count: { _all: true }, _max: { ranAt: true } })
  const byFlow = new Map(runCounts.map((r) => [r.flowId, { runs: r._count._all, lastRun: r._max.ranAt }]))
  return NextResponse.json(
    flows.map((f) => ({
      id: f.id,
      slug: f.slug || String(f.id),
      name: f.name,
      trigger: f.trigger,
      appScope: f.appScope,
      active: f.active,
      steps: Array.isArray(f.steps) ? f.steps : [],
      stepCount: Array.isArray(f.steps) ? f.steps.length : 0,
      runs: byFlow.get(f.id)?.runs || 0,
      lastRun: byFlow.get(f.id)?.lastRun || null,
      updatedAt: f.updatedAt.toISOString(),
    })),
  )
}

// POST /api/flows — create a flow.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!VALID_TRIGGERS.has(b.trigger)) return NextResponse.json({ error: 'invalid trigger' }, { status: 400 })
    const slug = await uniqueFlowSlug(String(b.name))
    // Any flow may have an optional schedule. A 'scheduled' trigger needs one, so
    // it defaults if none is given. A flow with no schedule never auto-runs.
    const scheduleId = b.scheduleId ? Number(b.scheduleId) : null
    let inline = !scheduleId && b.schedule ? b.schedule : null
    if (b.trigger === 'scheduled' && !scheduleId && !inline) inline = { freq: 'daily', hour: 9, minute: 0 }
    let effective: any = inline
    if (scheduleId) {
      const s = await prisma.flowSchedule.findUnique({ where: { id: scheduleId } })
      effective = s ? { freq: s.freq, hour: s.hour, minute: s.minute, weekday: s.weekday } : null
    }
    const hasSchedule = !!(scheduleId || inline)
    const created = await prisma.flow.create({
      data: {
        name: String(b.name).slice(0, 255),
        slug,
        trigger: b.trigger,
        appScope: b.appScope ? String(b.appScope) : 'all',
        active: b.active !== false,
        steps: (Array.isArray(b.steps) ? b.steps : []) as any,
        layout: (b.layout ?? null) as any,
        schedule: inline as any,
        scheduleId,
        nextRunAt: hasSchedule && effective ? computeNextRun(effective) : null,
        createdBy: b.createdBy ? String(b.createdBy).slice(0, 255) : null,
      },
    })
    return NextResponse.json({ ok: true, id: created.id, slug })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
