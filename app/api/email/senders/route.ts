import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { syncProviderSenders } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/senders — every from-address the pickers can offer.
//
// The addresses belonging to whatever is configured under Settings → Email are
// folded in first, so configuring a provider is all it takes for its address to
// appear in the Sender dropdown of a flow, campaign, sequence or template.
export async function GET() {
  await syncProviderSenders()
  const rows = await prisma.emailSender.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(rows.map((s) => ({ id: s.id, email: s.email, name: s.name, isDefault: s.isDefault, verified: s.verified })))
}

// POST /api/email/senders  body: { email, name }
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.email || !/.+@.+\..+/.test(String(b.email))) return NextResponse.json({ error: 'valid email required' }, { status: 400 })
    const created = await prisma.emailSender.upsert({
      where: { email: String(b.email) },
      create: { email: String(b.email).slice(0, 255), name: String(b.name || 'Sender').slice(0, 128) },
      update: { name: String(b.name || 'Sender').slice(0, 128) },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// PATCH /api/email/senders?id=1  body: { isDefault?, name? } — sets the default sender.
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    if (b.isDefault === true) {
      await prisma.emailSender.updateMany({ data: { isDefault: false } })
      await prisma.emailSender.update({ where: { id }, data: { isDefault: true } })
    }
    if (typeof b.name === 'string') await prisma.emailSender.update({ where: { id }, data: { name: b.name.slice(0, 128) } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/email/senders?id=1
export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.emailSender.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
