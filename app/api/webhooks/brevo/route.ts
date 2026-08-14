import { NextRequest, NextResponse } from 'next/server'
import { applyBrevoEvent } from '@/services/sequences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Brevo transactional webhook → auto-marks sequence contacts on open / click /
// unsubscribe / bounce. This is UNAUTHENTICATED by design (Brevo can't send a
// custom header), so we gate on an optional shared secret in the URL:
//   https://your-dashboard.example.com/api/webhooks/brevo?token=<BREVO_WEBHOOK_SECRET>
// If BREVO_WEBHOOK_SECRET is unset, all requests are accepted (matching the
// project's "works without config" posture). Match is strictly by message-id, so
// an unknown/foreign event simply finds nothing and is ignored.
//
// Brevo may POST a single event object or an array of them. Fields of interest:
//   { event, email, "message-id", reason }
// Events handled: opened, unique_opened, click, unsubscribed, hard_bounce,
// blocked, invalid_email, spam. Others (delivered, soft_bounce, request…) no-op.

function authorized(req: NextRequest): boolean {
  const secret = process.env.BREVO_WEBHOOK_SECRET || ''
  if (!secret) return true
  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token') || ''
  return token === secret
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'webhooks/brevo' })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const events = Array.isArray(body) ? body : [body]

    let matched = 0
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue
      const res = await applyBrevoEvent({
        event: ev.event || ev.type,
        messageId: ev['message-id'] || ev.messageId || ev.message_id,
        email: ev.email,
        reason: ev.reason,
      })
      if (res === 'matched') matched++
    }
    // Always 200 quickly so Brevo doesn't enter a retry storm.
    return NextResponse.json({ status: 'ok', received: events.length, matched })
  } catch (err: any) {
    console.error('[brevo-webhook] error:', err)
    // Still 200 — a 5xx makes Brevo retry the same unparseable payload forever.
    return NextResponse.json({ status: 'error', detail: String(err?.message || err) })
  }
}
