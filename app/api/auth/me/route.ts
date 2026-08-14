import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sessionEmail } from '@/lib/auth'
import { toProfile } from '@/lib/user-profile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — who the session cookie belongs to.
 *
 * The client calls this on mount instead of trusting localStorage: permissions
 * come from the DB on every load, so a role change takes effect immediately and
 * a tampered localStorage entry buys nothing.
 */
export async function GET(req: NextRequest) {
  const email = sessionEmail(req)
  if (!email) return NextResponse.json({ user: null }, { status: 401 })

  const user = await prisma.user.findFirst({ where: { email } })
  // Session is valid but the account is gone — treat as logged out.
  if (!user) return NextResponse.json({ user: null }, { status: 401 })

  return NextResponse.json({ user: toProfile(user) })
}
