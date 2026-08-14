import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { runFlowNow } from '@/services/flow-engine'
import { resolveFlowId } from '@/services/flow-slug'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/flows/[id]/test  ("Run now")
// For event flows, runs against the latest UNPROCESSED trigger event (an actual
// install / uninstall / subscription). Returns { ran:false } when there is no
// new event since the last run. Scheduled flows run once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = await resolveFlowId((await params).id)
    if (!id) return NextResponse.json({ error: 'flow not found' }, { status: 404 })
    const result = await runFlowNow(id)
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 404 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
