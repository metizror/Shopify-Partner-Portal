import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

/**
  * Deny-by-default guard for /api/*.
 *
 * Route handlers call requireDashboardPassword() individually, but that is opt-in:
 * a handler that forgets it is silently public, and an audit found 28 GETs in that
 * state — including /api/customers, which served merchant names, domains and
 * revenue to anyone who knew the path. This middleware inverts the default so a
 * new route is protected the day it is created. The in-route guards stay as
 * defence in depth.
 *
 * Anything not in PUBLIC needs the session cookie or the x-dashboard-password
 * header — the same two ways in that lib/auth.ts accepts.
 */

/**
 * Endpoints that must answer without a session, with the reason each one is safe.
 * Add to this list only with a reason; every entry is an unauthenticated surface.
 */
const PUBLIC = new Set([
  '/api/auth/login',      // issues the session — cannot require one
  '/api/auth/logout',     // clears the cookie; nothing to leak
  '/api/auth/me',         // returns null when unauthenticated, by design
  '/api/health',          // uptime probe, no data
  '/api/track/open',      // email open pixel — recipients have no session
  '/api/webhooks/brevo',  // Brevo can't send headers; gated by BREVO_WEBHOOK_SECRET
  '/api/partner-webhook', // app backends post here; gated by PARTNER_WEBHOOK_SECRET
])

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Proxy runs for every request; only /api is ours to guard. Pages are already
  // safe — they render no data server-side and redirect to /login client-side.
  if (!pathname.startsWith('/api/')) return NextResponse.next()

  if (PUBLIC.has(pathname)) return NextResponse.next()

  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()

  const password = process.env.DASHBOARD_PASSWORD
  if (password && req.headers.get('x-dashboard-password') === password) return NextResponse.next()

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}
