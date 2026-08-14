import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { setPartnerCookies, getPartnerCookies, daysUntilExpiry, checkPartnerCookieHealth } from '@/services/partner-cookies'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

// GET /api/cookies            → stored-cookie summary (fast)
// GET /api/cookies?live=1     → also runs a LIVE session-health check
export async function GET(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  try {
    const cookies = await getPartnerCookies()
    const base = {
      cookie_count: cookies.length,
      days_until_expiry: daysUntilExpiry(cookies),
      has_session_cookie: cookies.some((c) => c.name === '_partners_session'),
    }

    if (req.nextUrl.searchParams.get('live') === '1') {
      const health = await checkPartnerCookieHealth()
      // Cache the latest result so the alert/UI can read it cheaply.
      await prisma.state.upsert({
        where: { id: 'cookie_health' },
        create: { id: 'cookie_health', value: health as any },
        update: { value: health as any },
      })
      return NextResponse.json({
        ...base,
        session_valid: health.ok,
        session_expired: health.expired,
        health_reason: health.reason ?? null,
        checked_at: health.checkedAt,
      })
    }

    // Without ?live=1, surface the last cached live result if we have one.
    const cached = await prisma.state.findUnique({ where: { id: 'cookie_health' } })
    const h = (cached?.value as unknown as { ok?: boolean; expired?: boolean; reason?: string; checkedAt?: string } | null) || null
    return NextResponse.json({
      ...base,
      session_valid: h?.ok ?? null,
      session_expired: h?.expired ?? null,
      health_reason: h?.reason ?? null,
      checked_at: h?.checkedAt ?? null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'unknown' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.cookies)) {
      await setPartnerCookies(body.cookies)
    }
    if (body.shopid_map && typeof body.shopid_map === 'object') {
      const value = { map: body.shopid_map }
      await prisma.partnerCookie.upsert({
        where: { id: 'shopid_map' },
        create: { id: 'shopid_map', value: value as any },
        update: { value: value as any },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'unknown' }, { status: 500 })
  }
}
