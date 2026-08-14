import { NextRequest, NextResponse } from 'next/server'
import { runReplayChunk, getReplayStatus } from '@/services/full-replay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET  /api/cron/replay-installs          → advance one chunk (cron) OR ?status=1 for status
// POST /api/cron/replay-installs {force}   → force-start a new cycle now
// Auth (any one):
//   - Vercel Cron:  Authorization: Bearer $CRON_SECRET
//   - Manual/n8n:   x-dashboard-password: $DASHBOARD_PASSWORD
function authed(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization') || ''
  const pwOk = req.headers.get('x-dashboard-password') === process.env.DASHBOARD_PASSWORD
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  return pwOk || cronOk
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (req.nextUrl.searchParams.get('status') === '1') {
    return NextResponse.json({ ok: true, ...(await getReplayStatus()) })
  }
  try {
    const result = await runReplayChunk({ deadlineMs: 50_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  try {
    const result = await runReplayChunk({ deadlineMs: 50_000, force: body?.force === true })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}
