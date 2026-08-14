import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// CRUD for the per-app `shop-lookup` endpoints used to enrich uninstall emails.
//
// SECURITY: `authToken` is a live admin credential for the app's backend and is
// NEVER returned by this API — only a masked hint. The dashboard ships
// NEXT_PUBLIC_DASHBOARD_PASSWORD to the browser, so anything returned here must
// be assumed publicly readable. Sending an empty/absent token on PATCH keeps the
// stored one rather than clearing it.

const AUTH_TYPES = new Set(['header', 'bearer', 'query', 'none'])

/** `abcd…wxyz` → `••••wxyz`. Enough to tell two tokens apart, useless to steal. */
function maskToken(token: string | null): string | null {
  if (!token) return null
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`
}

function shape(r: {
  id: number; appId: string; url: string; authType: string; authHeader: string | null
  authToken: string | null; shopParam: string; timeoutMs: number; enabled: boolean
  lastOkAt: Date | null; lastError: string | null; updatedAt: Date
}) {
  return {
    id: r.id,
    appId: r.appId,
    url: r.url,
    authType: r.authType,
    authHeader: r.authHeader,
    tokenSet: !!r.authToken,
    tokenHint: maskToken(r.authToken),
    shopParam: r.shopParam,
    timeoutMs: r.timeoutMs,
    enabled: r.enabled,
    lastOkAt: r.lastOkAt ? r.lastOkAt.toISOString() : null,
    lastError: r.lastError,
    updatedAt: r.updatedAt.toISOString(),
  }
}

function validate(body: any): string | null {
  if (!String(body.appId ?? '').trim()) return 'appId is required'
  const url = String(body.url ?? '').trim()
  if (!url) return 'url is required'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'url must be a valid absolute URL'
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return 'url must use https (the token is sent on every request)'
  }
  const authType = String(body.authType ?? 'header')
  if (!AUTH_TYPES.has(authType)) return `authType must be one of: ${[...AUTH_TYPES].join(', ')}`
  if (authType === 'header' && !String(body.authHeader ?? '').trim()) {
    return "authHeader is required when authType is 'header' (e.g. x-api-key)"
  }
  const timeoutMs = Number(body.timeoutMs ?? 8000)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    return 'timeoutMs must be between 1000 and 30000'
  }
  return null
}

// GET /api/app-endpoints[?appId=…] — tokens masked.
export async function GET(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const appId = req.nextUrl.searchParams.get('appId') || undefined
  const rows = await prisma.appDataEndpoint.findMany({
    where: appId ? { appId } : undefined,
    orderBy: { appId: 'asc' },
  })
  return NextResponse.json(rows.map(shape))
}

// POST /api/app-endpoints — create or replace the config for one app.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const err = validate(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const appId = String(body.appId).trim()
  const token = String(body.authToken ?? '').trim()
  const data = {
    url: String(body.url).trim().replace(/\s+/g, ''),
    authType: String(body.authType ?? 'header'),
    authHeader: String(body.authHeader ?? '').trim() || null,
    shopParam: String(body.shopParam ?? 'domain').trim() || 'domain',
    timeoutMs: Number(body.timeoutMs ?? 8000),
    enabled: body.enabled !== false,
  }

  const row = await prisma.appDataEndpoint.upsert({
    where: { appId },
    create: { appId, ...data, authToken: token || null },
    // Blank token on update = "leave it alone", so saving the form without
    // re-typing the secret doesn't silently wipe it.
    update: token ? { ...data, authToken: token } : data,
  })
  return NextResponse.json(shape(row), { status: 201 })
}

// PATCH /api/app-endpoints — partial update (used by the Enabled toggle).
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const appId = String(body.appId ?? '').trim()
  if (!appId) return NextResponse.json({ error: 'appId is required' }, { status: 400 })

  const existing = await prisma.appDataEndpoint.findUnique({ where: { appId } })
  if (!existing) return NextResponse.json({ error: 'no endpoint configured for this app' }, { status: 404 })

  const data: Record<string, any> = {}
  if (body.enabled !== undefined) data.enabled = !!body.enabled
  if (body.url !== undefined) data.url = String(body.url).trim()
  if (body.authType !== undefined && AUTH_TYPES.has(String(body.authType))) data.authType = String(body.authType)
  if (body.authHeader !== undefined) data.authHeader = String(body.authHeader).trim() || null
  if (body.shopParam !== undefined) data.shopParam = String(body.shopParam).trim() || 'domain'
  if (body.timeoutMs !== undefined) {
    const t = Number(body.timeoutMs)
    if (Number.isFinite(t) && t >= 1000 && t <= 30000) data.timeoutMs = t
  }
  if (String(body.authToken ?? '').trim()) data.authToken = String(body.authToken).trim()

  const row = await prisma.appDataEndpoint.update({ where: { appId }, data })
  return NextResponse.json(shape(row))
}

// DELETE /api/app-endpoints?appId=…
export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const appId = req.nextUrl.searchParams.get('appId') || ''
  if (!appId) return NextResponse.json({ error: 'appId is required' }, { status: 400 })
  await prisma.appDataEndpoint.deleteMany({ where: { appId } })
  return NextResponse.json({ ok: true })
}
