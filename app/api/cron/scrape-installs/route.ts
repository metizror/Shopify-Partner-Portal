import { NextRequest, NextResponse } from 'next/server'
import { scrapeInstallCounts } from '@/services/partner-dashboard-scraper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET/POST /api/cron/scrape-installs
// Cookie-based refresh of the EXACT Partner Dashboard "Installs" count for every
// app (writes app_stats:<appId>). Cheap: one internal query per app. Only works
// while a valid partner session cookie is stored; if the cookie is missing/dead
// it returns cookieMissing/expired and the cards fall back to the cookie-free
// token estimate. Auth (any one):
//   - Vercel Cron:  Authorization: Bearer $CRON_SECRET
//   - Manual/n8n:   x-dashboard-password: $DASHBOARD_PASSWORD
async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization') || ''
  const pwOk = req.headers.get('x-dashboard-password') === process.env.DASHBOARD_PASSWORD
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!pwOk && !cronOk) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const result = await scrapeInstallCounts()
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    const msg = err?.message || String(err)
    // Missing/expired cookie is an expected, recoverable state — not a 500.
    if (msg === 'PARTNER_COOKIES_MISSING' || msg === 'PARTNER_COOKIES_EXPIRED') {
      return NextResponse.json({ ok: false, cookie: msg, updated: 0 })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = run
export const POST = run
