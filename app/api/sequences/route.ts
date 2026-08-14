import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createSequence } from '@/services/sequences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/sequences — all sequences with summary stats for the list page.
export async function GET() {
  const rows = await prisma.campaignSequence.findMany({ orderBy: { createdAt: 'desc' } })
  const out = []
  for (const s of rows) {
    const [total, finished, opened, replied, sent, failed, queued] = await Promise.all([
      prisma.sequenceContact.count({ where: { sequenceId: s.id } }),
      prisma.sequenceContact.count({ where: { sequenceId: s.id, stage: { in: ['fu2_sent', 'finished'] } } }),
      prisma.sequenceContact.count({ where: { sequenceId: s.id, engaged: 'opened' } }),
      prisma.sequenceContact.count({ where: { sequenceId: s.id, engaged: 'replied' } }),
      prisma.sequenceEmail.count({ where: { sequenceId: s.id, status: 'sent' } }),
      prisma.sequenceEmail.count({ where: { sequenceId: s.id, status: 'failed' } }),
      prisma.sequenceEmail.count({ where: { sequenceId: s.id, status: { in: ['queued', 'sending'] } } }),
    ])
    out.push({
      id: s.id,
      name: s.name,
      campaignId: s.campaignId,
      // Rows created before merchant audiences existed have no audience — they
      // are all sheet sequences.
      audience: (s.audience as any) || { source: 'sheet' },
      fu1Days: s.fu1Days,
      fu2Days: s.fu2Days,
      status: s.status,
      batchSize: s.batchSize,
      gapDays: s.gapDays,
      sendHour: s.sendHour,
      currentCycle: s.currentCycle,
      totalCycles: s.totalBatches + 2,
      totalBatches: s.totalBatches,
      nextRunAt: s.nextRunAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
      stats: { total, finished, opened, replied, sent, failed, queued },
    })
  }
  return NextResponse.json(out)
}

// POST /api/sequences — create a sequence from a campaign's contacts.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    // A merchant sequence has no source sheet, so campaignId is only required
    // for the sheet flow.
    const merchants = b.audience?.source === 'merchants'
    const required = ['name', 'freshTemplateId', 'freshSubject', 'fu1TemplateId', 'fu1Subject', 'fu2TemplateId', 'fu2Subject']
    // Batching only applies to sheet sequences; a merchant sequence is paced by
    // its per-contact follow-up delays instead.
    if (merchants) required.push('fu1Days', 'fu2Days')
    else required.unshift('campaignId', 'batchSize', 'gapDays')
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || String(b[f]).trim() === '') {
        return NextResponse.json({ error: `${f} is required` }, { status: 400 })
      }
    }
    const res = await createSequence({
      campaignId: merchants ? null : Number(b.campaignId),
      audience: merchants
        ? { source: 'merchants', appId: b.audience?.appId ?? null, trigger: b.audience?.trigger ?? 'install' }
        : { source: 'sheet' },
      fu1Days: Number(b.fu1Days ?? 2),
      fu2Days: Number(b.fu2Days ?? 3),
      name: String(b.name),
      batchSize: Number(b.batchSize ?? 25),
      gapDays: Number(b.gapDays ?? 2),
      sendHour: Number(b.sendHour ?? 10),
      freshTemplateId: Number(b.freshTemplateId),
      freshSubject: String(b.freshSubject),
      fu1TemplateId: Number(b.fu1TemplateId),
      fu1Subject: String(b.fu1Subject),
      fu2TemplateId: Number(b.fu2TemplateId),
      fu2Subject: String(b.fu2Subject),
      senderId: b.senderId ? Number(b.senderId) : null,
      varMap: b.varMap && typeof b.varMap === 'object' ? b.varMap : {},
      startNow: !!b.startNow,
      createdBy: typeof b.createdBy === 'string' ? b.createdBy : null,
    })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true, id: res.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
