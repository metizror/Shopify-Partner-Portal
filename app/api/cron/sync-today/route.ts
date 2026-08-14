import { NextRequest, NextResponse } from 'next/server'
import { pollPartnerEvents } from '@/services/partner-event-poller'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/sync-today
// Scheduled refresh of per-app install/uninstall counts + "today" trend for
// connected apps, via the Partner API token (no partner cookie required).
// Auth (any one):
//   - Vercel Cron:  Authorization: Bearer $CRON_SECRET   (set CRON_SECRET env)
//   - Manual/n8n:   x-dashboard-password: $DASHBOARD_PASSWORD
async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization') || ''
  const pwOk = req.headers.get('x-dashboard-password') === process.env.DASHBOARD_PASSWORD
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!pwOk && !cronOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // Trend-only refresh (no emails); the notify poller owns alerting.
    const result = await pollPartnerEvents({ notify: false, deadlineMs: 50_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}

export const GET = run
export const POST = run
