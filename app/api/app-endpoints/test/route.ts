import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { fetchShopLookup, buildLookupUrl, type EndpointConfig } from '@/services/app-data-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST /api/app-endpoints/test  { appId, domain, url?, authType?, authHeader?, authToken?, shopParam?, timeoutMs? }
//
// Runs a live lookup and returns BOTH the normalised result and the raw body, so
// an admin can confirm an endpoint works before relying on it — and see exactly
// which fields that app actually returns (the last_accessed_* block is optional
// and several apps omit it).
//
// Fields supplied in the body override the stored config, which lets you test a
// change before saving it. When no token is supplied the stored one is used, so
// you can re-test without re-typing the secret.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const appId = String(body.appId ?? '').trim()
  const domain = String(body.domain ?? '').trim().toLowerCase()

  if (!appId) return NextResponse.json({ error: 'appId is required' }, { status: 400 })
  if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 })

  const stored = await prisma.appDataEndpoint.findUnique({ where: { appId } })
  const url = String(body.url ?? stored?.url ?? '').trim()
  if (!url) {
    return NextResponse.json({ error: 'no endpoint configured for this app, and no url supplied' }, { status: 400 })
  }

  const cfg: EndpointConfig = {
    url,
    authType: String(body.authType ?? stored?.authType ?? 'header'),
    authHeader: (body.authHeader ?? stored?.authHeader ?? null) || null,
    authToken: String(body.authToken ?? '').trim() || stored?.authToken || null,
    shopParam: String(body.shopParam ?? stored?.shopParam ?? 'domain'),
    timeoutMs: Number(body.timeoutMs ?? stored?.timeoutMs ?? 8000),
  }

  const started = Date.now()
  const res = await fetchShopLookup(cfg, domain, { attempts: 1 })
  const ms = Date.now() - started

  return NextResponse.json({
    ok: res.status === 'ok',
    status: res.status,
    httpStatus: res.httpStatus ?? null,
    error: res.error ?? null,
    ms,
    // Echo the URL WITHOUT the token so an admin can eyeball the shop param.
    requestUrl: buildLookupUrl(cfg, domain),
    // What we'd store — i.e. what the merge tags would resolve to.
    normalized: res.data
      ? {
          shopUrl: res.data.shopUrl,
          installDate: res.data.installDate?.toISOString() ?? null,
          uninstallDate: res.data.uninstallDate?.toISOString() ?? null,
          planType: res.data.planType,
          previousPlan: res.data.previousPlan,
          durationDays: res.data.durationDays,
          durationText: res.data.durationText,
          lastUserEmail: res.data.lastUserEmail,
          lastUserName: res.data.lastUserName,
          lastAccessedAt: res.data.lastAccessedAt?.toISOString() ?? null,
          contactEmail: res.data.contactEmail,
          contactName: res.data.contactName,
          isUninstall: res.data.isUninstall,
          appStatus: res.data.appStatus,
        }
      : null,
    raw: res.data?.raw ?? null,
  })
}
