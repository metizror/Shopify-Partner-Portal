import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getEmailConfig, maskSecret } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/config — the saved delivery settings, secrets masked.
//
// Secrets NEVER leave the server in full. The UI only needs to know a key is
// there (so it can show "••••••••a1b2" instead of an empty box); to change one
// you type a new one. Same rule the users API follows for User.password.
export async function GET(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const cfg = await getEmailConfig()
  return NextResponse.json({
    provider: cfg.provider,
    configured: cfg.configured,
    source: cfg.source,
    brevoApiKeyMasked: maskSecret(cfg.brevoApiKey),
    // Whether the key shown is BREVO_API_KEY from the environment rather than
    // a saved one. `source` only says this when Brevo is the active provider;
    // the UI needs to know either way, because a key it cannot delete must not
    // be offered a Remove button.
    brevoFromEnv: !!cfg.brevoApiKey && cfg.brevoApiKey === (process.env.BREVO_API_KEY || '').trim(),
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpUser: cfg.smtpUser,
    smtpPasswordMasked: maskSecret(cfg.smtpPassword),
    smtpSecure: cfg.smtpSecure,
  })
}

/** '' means "clear this field", undefined/absent means "leave it alone". */
function optionalSecret(v: unknown): string | null | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s === '' ? null : s
}

// PUT /api/email/config  body: { provider?, brevoApiKey?, smtpHost?, smtpPort?,
//                                smtpUser?, smtpPassword?, smtpSecure? }
//
// Partial: only the keys present are written. That is what lets the page save a
// provider switch without resending credentials it was never shown in full.
export async function PUT(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  try {
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}

    if (b.provider === 'brevo' || b.provider === 'smtp') data.provider = b.provider

    const brevoKey = optionalSecret(b.brevoApiKey)
    if (brevoKey !== undefined) data.brevoApiKey = brevoKey?.slice(0, 255) ?? null

    if (typeof b.smtpHost === 'string') data.smtpHost = b.smtpHost.trim().slice(0, 255) || null
    if (b.smtpPort !== undefined && b.smtpPort !== null && b.smtpPort !== '') {
      const port = Number(b.smtpPort)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json({ error: 'smtpPort must be 1-65535' }, { status: 400 })
      }
      data.smtpPort = port
    }
    if (typeof b.smtpUser === 'string') data.smtpUser = b.smtpUser.trim().slice(0, 255) || null

    const smtpPass = optionalSecret(b.smtpPassword)
    if (smtpPass !== undefined) data.smtpPassword = smtpPass?.slice(0, 255) ?? null

    if (typeof b.smtpSecure === 'boolean') data.smtpSecure = b.smtpSecure

    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

    await prisma.emailConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...data } as any,
      update: data as any,
    })

    const cfg = await getEmailConfig()
    return NextResponse.json({ ok: true, provider: cfg.provider, configured: cfg.configured, source: cfg.source })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
