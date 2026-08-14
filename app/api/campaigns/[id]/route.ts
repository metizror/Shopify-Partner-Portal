import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { detectEmailColumn } from '@/lib/campaign'
import { isEmailConfigured } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/campaigns/[id] — campaign + recipients (capped; supports ?status= & ?limit=).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const c = await prisma.campaign.findUnique({ where: { id } })
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const emailEnabled = await isEmailConfigured()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 2000)

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, ...(status ? { status } : {}) },
    orderBy: { id: 'asc' },
    take: limit,
  })

  return NextResponse.json({
    id: c.id,
    name: c.name,
    fileName: c.fileName,
    sheetName: c.sheetName,
    headers: c.headers,
    emailColumn: c.emailColumn,
    subject: c.subject,
    templateId: c.templateId,
    senderId: c.senderId,
    varMap: c.varMap || {},
    status: c.status,
    scheduledAt: c.scheduledAt?.toISOString() || null,
    // Whether THIS environment can actually send (a provider is configured).
    // When false, queued sends wait for the live server — so the UI shouldn't
    // poll for progress.
    emailEnabled,
    totalCount: c.totalCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
    recipients: recipients.map((r) => ({
      id: r.id,
      email: r.email,
      vars: r.vars,
      selected: r.selected,
      status: r.status,
      sentAt: r.sentAt?.toISOString() || null,
      error: r.error,
    })),
  })
}

// PATCH /api/campaigns/[id] — update name / emailColumn / template / sender / varMap.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number((await params).id)
    const c = await prisma.campaign.findUnique({ where: { id } })
    if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (typeof b.name === 'string') data.name = b.name.slice(0, 255)
    if (typeof b.subject === 'string') data.subject = b.subject.slice(0, 255)
    if (typeof b.emailColumn === 'string') data.emailColumn = b.emailColumn
    if ('templateId' in b) data.templateId = b.templateId ? Number(b.templateId) : null
    if ('senderId' in b) data.senderId = b.senderId ? Number(b.senderId) : null
    if (b.varMap && typeof b.varMap === 'object') data.varMap = b.varMap

    // Changing the email column re-classifies which rows are eligible.
    if (typeof b.emailColumn === 'string' && b.emailColumn !== c.emailColumn) {
      await reclassifyRecipients(id, b.emailColumn)
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    await prisma.campaign.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/campaigns/[id] — remove the campaign and its recipients.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const id = Number((await params).id)
  await prisma.campaignRecipient.deleteMany({ where: { campaignId: id } })
  await prisma.campaign.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

// When the email column changes, recompute each recipient's email + eligibility.
// Only touches rows not already sent/sending, so in-flight sends are untouched.
async function reclassifyRecipients(campaignId: number, emailColumn: string) {
  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ['pending', 'skipped', 'queued'] } },
    select: { id: true, vars: true },
  })
  const seen = new Set<string>()
  for (const r of rows) {
    const raw = String((r.vars as any)?.[emailColumn] ?? '').trim()
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !seen.has(raw.toLowerCase())
    if (valid) seen.add(raw.toLowerCase())
    await prisma.campaignRecipient.update({
      where: { id: r.id },
      data: {
        email: (valid ? raw : `row-${r.id}@invalid.local`).slice(0, 320),
        status: valid ? 'pending' : 'skipped',
        selected: false,
      },
    }).catch(() => {}) // ignore unique-email collisions
  }
}
