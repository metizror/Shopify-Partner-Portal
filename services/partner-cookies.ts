// Stores Shopify Partner browser cookies in MySQL so the scrapers
// (categorize_stores, fetch_store_countries, fetch_app_ads) can run on
// Vercel without a GitHub Secret.
//
// You upload the cookies via the dashboard UI (or POST to /api/cookies).
// The dashboard tracks cookie health for its "Session expired" badge, but does
// NOT email when the session expires (that alert was intentionally removed).

import { prisma } from '@/lib/db'
import { listPartners } from '@/services/app-catalog'

const HEALTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0'

export interface PartnerCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expirationDate?: number // unix seconds
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

const COOKIE_DOC_ID = 'shopify_partner'

interface CookieValue {
  cookies?: PartnerCookie[]
}

export async function getPartnerCookies(): Promise<PartnerCookie[]> {
  const doc = await prisma.partnerCookie.findUnique({ where: { id: COOKIE_DOC_ID } })
  return ((doc?.value as CookieValue | null)?.cookies as PartnerCookie[]) || []
}

export async function setPartnerCookies(cookies: PartnerCookie[]): Promise<void> {
  const value = { cookies }
  await prisma.partnerCookie.upsert({
    where: { id: COOKIE_DOC_ID },
    create: { id: COOKIE_DOC_ID, value: value as any },
    update: { value: value as any },
  })
}

/** Convert cookie array to a `Cookie:` header string for use with fetch(). */
export function cookieHeader(cookies: PartnerCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

/** Get just the values relevant to partners.shopify.com requests. */
export async function partnerCookieHeader(): Promise<string> {
  const cookies = await getPartnerCookies()
  return cookieHeader(cookies)
}

export interface CookieHealth {
  ok: boolean
  /** true only for a *definitive* dead session (logged out), not transient errors. */
  expired: boolean
  reason?: string
  checkedAt: string
}

/**
 * Live health check: actually hits the Partner Dashboard with the stored
 * cookies and detects whether the session is still authenticated. This catches
 * the case where `_partners_session` is invalidated server-side even though its
 * stored expiry date is still far off (which `daysUntilExpiry` cannot see).
 */
export async function checkPartnerCookieHealth(orgId?: string): Promise<CookieHealth> {
  const now = new Date().toISOString()
  // Any connected organisation will do — the check is on the session, not the
  // org. With none connected there is no URL to probe, so say so plainly
  // rather than probing a hardcoded org id that belongs to someone else.
  orgId ||= (await listPartners())[0]?.partnerId
  if (!orgId) {
    return { ok: false, expired: false, reason: 'No partner organisation connected.', checkedAt: now }
  }
  const cookies = await getPartnerCookies()
  if (cookies.length === 0) {
    return { ok: false, expired: true, reason: 'No partner cookies stored.', checkedAt: now }
  }
  if (!cookies.some((c) => c.name === '_partners_session')) {
    return { ok: false, expired: true, reason: 'Missing _partners_session cookie.', checkedAt: now }
  }

  let res: Response
  try {
    res = await fetch(`https://partners.shopify.com/${orgId}/apps`, {
      headers: { 'User-Agent': HEALTH_UA, Cookie: cookieHeader(cookies), Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    // Network/timeout — not a definitive expiry, don't cry wolf.
    return { ok: false, expired: false, reason: 'Could not reach the Partner Dashboard.', checkedAt: now }
  }

  if (res.url.toLowerCase().includes('login') || res.url.includes('accounts.shopify.com')) {
    return { ok: false, expired: true, reason: 'Session expired — redirected to login. Refresh the _partners_session cookie.', checkedAt: now }
  }
  if (!res.ok) {
    return { ok: false, expired: false, reason: `Partner Dashboard returned ${res.status}.`, checkedAt: now }
  }
  return { ok: true, expired: false, checkedAt: now }
}

/** Returns days until _partners_session expires, or null if unknown. */
export function daysUntilExpiry(cookies: PartnerCookie[]): number | null {
  const session = cookies.find((c) => c.name === '_partners_session')
  if (!session?.expirationDate) return null
  const expMs = session.expirationDate * 1000
  return Math.floor((expMs - Date.now()) / (1000 * 60 * 60 * 24))
}

/**
 * Refresh the Partner cookie health status and persist it to State so the
 * API/UI can show the "Session expired" badge without re-hitting Shopify.
 *
 * NOTE: session-expiry EMAIL alerts were intentionally removed — we no longer
 * email when the Partner session expires. The health status below still powers
 * the dashboard badge; the user refreshes the cookie manually when they see it.
 */
export async function checkCookieExpiry(): Promise<void> {
  const cookies = await getPartnerCookies()
  if (cookies.length === 0) return

  // Live check — catches a session invalidated before its stored expiry date.
  const health = await checkPartnerCookieHealth()
  await prisma.state.upsert({
    where: { id: 'cookie_health' },
    create: { id: 'cookie_health', value: health as any },
    update: { value: health as any },
  })
}
