import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { listProviderSenders, syncProviderSenders } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/config/senders — the from-addresses the provider will accept,
// alongside the ones already saved locally.
//
// Brevo is the source of truth for its own account, so the list is fetched live
// rather than cached: someone adds a sender in Brevo, reloads this page, and it
// is there. `saved` is what the rest of the app (flows, campaigns, sequences)
// actually offers in its from dropdowns, so the page can show which live
// addresses are not usable yet.
export async function GET(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  await syncProviderSenders()
  const [live, saved] = await Promise.all([
    listProviderSenders(),
    prisma.emailSender.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  return NextResponse.json({
    ok: live.ok,
    error: live.error || null,
    senders: live.senders,
    saved: saved.map((s) => ({ id: s.id, email: s.email, name: s.name, isDefault: s.isDefault, verified: s.verified })),
  })
}

// POST /api/email/config/senders  body: { email, name?, makeDefault? }
//
// Import one provider address into email_senders so it shows up in every
// from-address dropdown. Upsert by email — re-importing after a rename in Brevo
// updates the label instead of erroring on the unique constraint.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  try {
    const b = await req.json().catch(() => ({}))
    const email = String(b.email || '').trim().toLowerCase()
    if (!/.+@.+\..+/.test(email)) return NextResponse.json({ error: 'valid email required' }, { status: 400 })

    // An address the provider reports is recorded as verified. One it does not
    // is still accepted — SMTP cannot enumerate anything, aliases and
    // domain-wide relays are legitimate, and refusing them would mean the only
    // usable from-address is whatever the provider happens to list. It is
    // stored unverified instead, which is what the settings page warns on, so
    // an actual typo shows up there rather than as a silent send failure.
    const live = await listProviderSenders()
    const match = live.ok ? live.senders.find((s) => s.email.toLowerCase() === email) : undefined
    const verified = !!match?.verified

    const name = String(b.name || match?.name || email.split('@')[0]).slice(0, 128)
    const row = await prisma.emailSender.upsert({
      where: { email },
      create: { email: email.slice(0, 255), name, verified },
      update: { name, verified },
    })

    if (b.makeDefault === true) {
      await prisma.emailSender.updateMany({ data: { isDefault: false } })
      await prisma.emailSender.update({ where: { id: row.id }, data: { isDefault: true } })
    }

    return NextResponse.json({ ok: true, id: row.id, verified })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
