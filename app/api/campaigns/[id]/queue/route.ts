import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { queueCampaign, drainCampaignSends, type Selection } from '@/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/campaigns/[id]/queue
// body: { templateId, senderId?, varMap?, selection:{mode,ids?,n?}, when?:'now'|'schedule', scheduledAt? }
// Enqueues the selected recipients. For "now" it also kicks the drainer once so
// a small send goes out immediately without waiting for the next cron tick.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number((await params).id)
    const b = await req.json().catch(() => ({}))
    const templateId = Number(b.templateId)
    if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 })
    const subject = String(b.subject || '').trim()
    if (!subject) return NextResponse.json({ error: 'subject is required' }, { status: 400 })

    const selection: Selection = {
      mode: b.selection?.mode === 'ids' || b.selection?.mode === 'random' ? b.selection.mode : 'all',
      ids: Array.isArray(b.selection?.ids) ? b.selection.ids.map(Number) : undefined,
      n: b.selection?.n != null ? Number(b.selection.n) : undefined,
    }

    let scheduledAt: Date | null = null
    if (b.when === 'schedule' && b.scheduledAt) {
      const d = new Date(b.scheduledAt)
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'invalid scheduledAt' }, { status: 400 })
      scheduledAt = d
    }

    const res = await queueCampaign(id, {
      templateId,
      subject,
      senderId: b.senderId ? Number(b.senderId) : null,
      varMap: b.varMap && typeof b.varMap === 'object' ? b.varMap : undefined,
      selection,
      scheduledAt,
    })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })

    // Fire the drainer once for immediate sends (best-effort; cron continues it).
    let sent = 0
    let failed = 0
    let held = false
    if (!scheduledAt) {
      const d = await drainCampaignSends({ deadlineMs: 45_000 })
      sent = d.sent
      failed = d.failed
      held = d.skipped // BREVO_API_KEY unset on this environment
    }

    return NextResponse.json({ ok: true, queued: res.queued, sent, failed, held, scheduled: !!scheduledAt })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
