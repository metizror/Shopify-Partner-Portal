import { NextRequest, NextResponse } from 'next/server'
import { pollPartnerEvents } from '@/services/partner-event-poller'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET/POST /api/cron/poll-events
// Every 5 minutes: pull each app's recent install/uninstall events via the
// Partner API token, refresh the daily trend, record new events, and send the
// welcome/alert emails for anything newer than the watermark (seeding silently
// on the first run). This is the cookie-free stand-in for a Shopify "partner
// webhook", which does not exist for relationship events.
// Auth (any one):
//   - Vercel Cron:  Authorization: Bearer $CRON_SECRET
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
    const result = await pollPartnerEvents({ notify: true, deadlineMs: 55_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}

export const GET = run
export const POST = run
