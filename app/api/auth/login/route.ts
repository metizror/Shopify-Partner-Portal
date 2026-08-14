import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'
import { toProfile } from '@/lib/user-profile'
import { hashPassword, isHashed, verifyPassword } from '@/lib/password'
import { clientIp, hit, peek, reset } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Two limits, because they stop different attacks and each covers the other's
// blind spot.
//
// Per account: the attacker picks the email — it is the one value they cannot
// vary while still attacking that account — so this holds even when they rotate
// IPs or forge the forwarded header. It is the limit that actually protects a
// password.
//
// Per IP: catches spraying one common password across many accounts, which the
// per-account limit never sees because no single account accumulates failures.
// Spoofable, hence the wider allowance and its role as a supplement.
const PER_ACCOUNT_LIMIT = 5
const PER_IP_LIMIT = 20
const WINDOW_MS = 15 * 60 * 1000

/**
 * POST /api/auth/login  { email, password }
 *
 * Credentials are checked here, on the server. The browser previously pulled the
 * entire user table — passwords included — from /api/users and compared in JS;
 * now it only ever receives a profile and an httpOnly session cookie.
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({ email: '', password: '' }))
  const em = String(email || '').trim().toLowerCase()
  const pw = String(password || '')

  if (!em || !pw) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const ip = clientIp(req)
  const accountKey = `login:account:${em}`
  const ipKey = ip ? `login:ip:${ip}` : null

  // Checked before the user lookup and the scrypt comparison: once a client is
  // blocked, every further attempt should cost this server nothing. Peeking
  // rather than counting means a blocked attacker cannot keep extending their
  // own lockout, so the window still expires on schedule for the real owner.
  const blocked = [
    peek(accountKey, PER_ACCOUNT_LIMIT),
    ipKey ? peek(ipKey, PER_IP_LIMIT) : null,
  ].find((r) => r && !r.allowed)
  if (blocked) return tooMany(blocked.retryAfter)

  const user = await prisma.user.findFirst({ where: { email: em } })
  // Same response either way — no hint about which accounts exist.
  if (!user || !(await verifyPassword(pw, user.password))) {
    return failed(em, accountKey, ipKey)
  }

  // This portal is admin-only: what it exposes — merchant domains, revenue,
  // partner API tokens, the ability to mail merchants — has no reduced-privilege
  // view worth maintaining. A non-admin row is therefore dormant rather than
  // limited, and stays out at the door instead of being half-blocked deeper in.
  // Same generic message as a bad password, so the response never confirms that
  // an account exists.
  if (user.role !== 'admin') {
    return failed(em, accountKey, ipKey)
  }

  // Opportunistic upgrade: a row that still holds a plaintext password becomes a
  // hash the first time its owner logs in, so the last stragglers clear
  // themselves even if the bulk migration was never run here. Failure to write
  // must not block the login — the next login retries.
  if (!isHashed(user.password)) {
    try {
      await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(pw) } })
    } catch { /* keep going; the password itself is still correct */ }
  }

  // Proving you own the account clears its counter, so a few fumbled attempts
  // before the right password don't leave the limit primed against you. The IP
  // counter is deliberately left alone: one valid account is exactly what an
  // attacker spraying from a single host would have.
  reset(accountKey)

  const res = NextResponse.json({ user: toProfile(user) })
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.email), sessionCookieOptions())
  return res
}

/**
 * Record a failed attempt and answer.
 *
 * The body is the same generic string whether the email is unknown, the password
 * is wrong, or the account is not an admin — anything more specific tells an
 * attacker which half to keep working on. The 429 that follows a run of these is
 * unavoidably informative about the limit itself, which is fine: knowing you are
 * throttled does not help you get past it.
 */
function failed(em: string, accountKey: string, ipKey: string | null): NextResponse {
  const account = hit(accountKey, PER_ACCOUNT_LIMIT, WINDOW_MS)
  const byIp = ipKey ? hit(ipKey, PER_IP_LIMIT, WINDOW_MS) : null
  const over = [account, byIp].find((r) => r && !r.allowed)
  if (over) {
    console.warn(`[login] rate limited after failed attempt for ${em}`)
    return tooMany(over.retryAfter)
  }
  return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
}

function tooMany(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many login attempts. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}
