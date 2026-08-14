import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { nextISTHour } from '@/services/sequences'
import { isEmailConfigured } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/sequences/[id] — full detail: sequence, per-batch pipeline stats,
// contacts (capped), activity log. Everything the admin visuals need.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const s = await prisma.campaignSequence.findUnique({ where: { id } })
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || 2000), 5000)

  const contacts = await prisma.sequenceContact.findMany({
    where: { sequenceId: id },
    orderBy: [{ batchNo: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  const emails = await prisma.sequenceEmail.findMany({
    where: { sequenceId: id },
    select: { contactId: true, kind: true, status: true, sentAt: true, error: true },
  })
  const emailsByContact = new Map<number, { kind: string; status: string; sentAt: Date | null; error: string | null }[]>()
  for (const e of emails) {
    const list = emailsByContact.get(e.contactId) || []
    list.push(e)
    emailsByContact.set(e.contactId, list)
  }

  // Per-batch pipeline stats for the board.
  const batches = []
  for (let b = 1; b <= s.totalBatches; b++) {
    const inBatch = contacts.filter((c) => c.batchNo === b)
    const kinds = (kind: string, status: string) =>
      inBatch.reduce((n, c) => n + ((emailsByContact.get(c.id) || []).some((e) => e.kind === kind && e.status === status) ? 1 : 0), 0)
    batches.push({
      batchNo: b,
      size: inBatch.length,
      fresh: { sent: kinds('fresh', 'sent'), queued: kinds('fresh', 'queued') + kinds('fresh', 'sending'), failed: kinds('fresh', 'failed') },
      fu1: { sent: kinds('fu1', 'sent'), queued: kinds('fu1', 'queued') + kinds('fu1', 'sending'), failed: kinds('fu1', 'failed'), skipped: kinds('fu1', 'skipped') },
      fu2: { sent: kinds('fu2', 'sent'), queued: kinds('fu2', 'queued') + kinds('fu2', 'sending'), failed: kinds('fu2', 'failed'), skipped: kinds('fu2', 'skipped') },
      opened: inBatch.filter((c) => c.engaged === 'opened').length,
      replied: inBatch.filter((c) => c.engaged === 'replied').length,
      done: inBatch.filter((c) => c.stage === 'fu2_sent' || c.stage === 'finished').length,
    })
  }

  const queuedTotal = emails.filter((e) => e.status === 'queued' || e.status === 'sending').length

  // Drives the "email isn't configured" banner — a sequence can be built and
  // queued long before anyone fills in Settings → Email.
  const emailEnabled = await isEmailConfigured()

  return NextResponse.json({
    id: s.id,
    name: s.name,
    campaignId: s.campaignId,
    status: s.status,
    // Null on sequences created before merchant audiences existed.
    audience: (s.audience as any) || { source: 'sheet' },
    batchSize: s.batchSize,
    gapDays: s.gapDays,
    sendHour: s.sendHour,
    fu1Days: s.fu1Days,
    fu2Days: s.fu2Days,
    freshTemplateId: s.freshTemplateId,
    freshSubject: s.freshSubject,
    fu1TemplateId: s.fu1TemplateId,
    fu1Subject: s.fu1Subject,
    fu2TemplateId: s.fu2TemplateId,
    fu2Subject: s.fu2Subject,
    senderId: s.senderId,
    currentCycle: s.currentCycle,
    totalCycles: s.totalBatches + 2,
    totalBatches: s.totalBatches,
    nextRunAt: s.nextRunAt?.toISOString() || null,
    activity: Array.isArray(s.activity) ? s.activity : [],
    createdAt: s.createdAt.toISOString(),
    emailEnabled,
    queuedTotal,
    batches,
    contacts: contacts.map((c) => ({
      id: c.id,
      email: c.email,
      vars: c.vars,
      batchNo: c.batchNo,
      // Triggered sequences only — when this contact's next follow-up is due.
      nextDueAt: c.nextDueAt?.toISOString() || null,
      stage: c.stage,
      engaged: c.engaged,
      openedAt: c.openedAt?.toISOString() || null,
      repliedAt: c.repliedAt?.toISOString() || null,
      lastSentAt: c.lastSentAt?.toISOString() || null,
      error: c.error,
      emails: (emailsByContact.get(c.id) || []).map((e) => ({ kind: e.kind, status: e.status, sentAt: e.sentAt?.toISOString() || null })),
    })),
  })
}

// PATCH /api/sequences/[id] — { action: 'pause' | 'resume' | 'cancel' } or { name }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const id = Number((await params).id)
  const s = await prisma.campaignSequence.findUnique({ where: { id } })
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const b = await req.json().catch(() => ({}))

  if (b.action === 'pause') {
    if (s.status !== 'running') return NextResponse.json({ error: 'not running' }, { status: 400 })
    await prisma.campaignSequence.update({ where: { id }, data: { status: 'paused' } })
    return NextResponse.json({ ok: true, status: 'paused' })
  }
  if (b.action === 'resume') {
    if (s.status !== 'paused') return NextResponse.json({ error: 'not paused' }, { status: 400 })
    // If the pause outlived the scheduled run, fire at the next send hour.
    // A triggered sequence has no cycle clock — keep nextRunAt null so the
    // batched sweep never picks it up; it just re-arms for events.
    const now = new Date()
    const triggered = (s.audience as any)?.source === 'merchants'
    const nextRunAt = triggered ? null : s.nextRunAt && s.nextRunAt > now ? s.nextRunAt : nextISTHour(now, s.sendHour)
    await prisma.campaignSequence.update({ where: { id }, data: { status: 'running', nextRunAt } })
    return NextResponse.json({ ok: true, status: 'running', nextRunAt: nextRunAt?.toISOString() || null })
  }
  if (b.action === 'cancel') {
    // Stop the clock and void anything still queued; history stays.
    await prisma.sequenceEmail.updateMany({
      where: { sequenceId: id, status: { in: ['queued', 'sending'] } },
      data: { status: 'skipped', error: 'sequence cancelled' },
    })
    await prisma.campaignSequence.update({ where: { id }, data: { status: 'cancelled', nextRunAt: null } })
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }
  if (typeof b.name === 'string' && b.name.trim()) {
    await prisma.campaignSequence.update({ where: { id }, data: { name: b.name.trim().slice(0, 255) } })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
}

// DELETE /api/sequences/[id] — remove the sequence and all its rows.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const id = Number((await params).id)
  await prisma.sequenceEmail.deleteMany({ where: { sequenceId: id } })
  await prisma.sequenceContact.deleteMany({ where: { sequenceId: id } })
  await prisma.campaignSequence.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
