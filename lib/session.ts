import { createHmac, timingSafeEqual, randomBytes } from 'crypto'

/**
 * Signed session cookies.
 *
 * The browser used to hold the API password itself (NEXT_PUBLIC_DASHBOARD_PASSWORD,
 * which Next.js inlines into the client bundle — readable by anyone who opened
 * devtools). It now holds only this token: an httpOnly cookie carrying the
 * logged-in email plus an HMAC the client cannot forge, because SESSION_SECRET
 * never leaves the server.
 */

export const SESSION_COOKIE = 'dash_session'

/** A week. Long enough not to annoy, short enough that a leaked token expires. */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

export interface SessionPayload {
  /** Email of the logged-in dashboard user. */
  email: string
  /** Expiry, epoch seconds. */
  exp: number
}

function secret(): string {
  // Falls back to DASHBOARD_PASSWORD so an existing deploy keeps working if
  // SESSION_SECRET hasn't been added yet — but that couples session validity to
  // the API password, so .env.example tells you to set a real one.
  const s = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD
  if (!s) throw new Error('SESSION_SECRET (or DASHBOARD_PASSWORD) must be set')
  return s
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

/** Build a signed token for this email. */
export function createSessionToken(email: string): string {
  const payload: SessionPayload = {
    email,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body)}`
}

/** Verify a token; returns the payload, or null if forged, malformed or expired. */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null

  const body = token.slice(0, dot)
  const supplied = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(body))
  // Constant-time compare — a length mismatch alone already means forged.
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (!payload?.email || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** Cookie options shared by the set and clear paths so they can't drift apart. */
export function sessionCookieOptions(maxAge = MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // The dashboard is served over HTTPS in production; over plain HTTP in dev,
    // where a Secure cookie would simply never be stored.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}

/** Helper for generating a SESSION_SECRET value (used by the setup docs). */
export function generateSecret(): string {
  return randomBytes(32).toString('hex')
}
