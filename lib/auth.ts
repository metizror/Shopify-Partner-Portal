import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { prisma } from '@/lib/db'

/**
 * Route-handler guard. Pattern:
 *   const auth = requireDashboardPassword(req)
 *   if (auth) return auth
 * Returns null when the caller is authenticated, otherwise a 401 (or 500 if the
 * server has no password configured at all).
 *
 * Two ways in:
 *   1. The httpOnly session cookie, set by POST /api/auth/login. This is how the
 *      browser authenticates — it never sees DASHBOARD_PASSWORD.
 *   2. The x-dashboard-password header, for server-to-server callers that have
 *      no cookie jar: crons, scripts/poll-events.sh, manual curl.
 */
export function requireDashboardPassword(req: NextRequest): NextResponse | null {
  const password = process.env.DASHBOARD_PASSWORD
  if (!password) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASSWORD not configured on server' },
      { status: 500 },
    )
  }

  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return null

  const supplied = req.headers.get('x-dashboard-password') || ''
  if (supplied === password) return null

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/** Email of the logged-in user, or null for header-authenticated callers. */
export function sessionEmail(req: NextRequest): string | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)?.email ?? null
}

/**
 * Same contract as requireDashboardPassword, but also demands role === 'admin'.
 * Async because the session token carries only { email, exp } — the role has to
 * come from the DB, which also means a demoted or deleted user loses access on
 * their next request rather than when their 7-day token expires.
 *
 * Usage:
 *   const auth = await requireAdmin(req)
 *   if (auth) return auth
 *
 * x-dashboard-password callers pass: that header is the server's own secret, so
 * anything holding it already outranks any user account.
 */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const email = sessionEmail(req)
  if (!email) return null // authenticated by header, not by a user account

  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } })
  if (user?.role === 'admin') return null

  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}
