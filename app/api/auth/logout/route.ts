import { NextResponse } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/auth/logout — expire the session cookie server-side. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0))
  return res
}
