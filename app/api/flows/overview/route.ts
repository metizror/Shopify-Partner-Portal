import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/flows/overview — KPIs + recent runs for the Flows Overview page.
export async function GET() {
  try {
    const [totalFlows, activeFlows, totalRuns, successRuns, recent, pendingTasks] = await Promise.all([
      prisma.flow.count(),
      prisma.flow.count({ where: { active: true } }),
      prisma.flowRun.count(),
      prisma.flowRun.count({ where: { status: 'success' } }),
      prisma.flowRun.findMany({ orderBy: { ranAt: 'desc' }, take: 10 }),
      prisma.flowTask.count({ where: { status: 'pending' } }),
    ])
    const flowIds = [...new Set(recent.map((r) => r.flowId))]
    const flows = await prisma.flow.findMany({ where: { id: { in: flowIds } }, select: { id: true, name: true, slug: true } })
    const nameById = new Map(flows.map((f) => [f.id, f.name]))
    const slugById = new Map(flows.map((f) => [f.id, f.slug || String(f.id)]))
    const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 1000) / 10 : 0
    return NextResponse.json({
      totalFlows,
      activeFlows,
      totalRuns,
      successRate,
      pendingTasks,
      recent: recent.map((r) => {
        // Surface WHY a run failed: the detail of the first failed step in its log.
        const log = Array.isArray(r.log) ? (r.log as any[]) : []
        const firstFail = log.find((s) => s && s.ok === false)
        return {
          id: r.id, flowId: r.flowId, flowSlug: slugById.get(r.flowId) || String(r.flowId),
          flowName: nameById.get(r.flowId) || `Flow ${r.flowId}`,
          trigger: r.trigger, domain: r.domain, status: r.status, ranAt: r.ranAt.toISOString(),
          error: r.status === 'failed' ? (firstFail?.detail || 'a step failed') : null,
        }
      }),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
