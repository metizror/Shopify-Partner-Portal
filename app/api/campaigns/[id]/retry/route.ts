import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { drainCampaignSends, refreshCampaignCounts } from '@/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/campaigns/[id]/retry — re-queue this campaign's failed recipients
// (send now) and kick the drainer once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number((await params).id)
    const r = await prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: 'failed' },
      data: { status: 'queued', selected: true, sendAt: new Date(), error: null },
    })
    if (r.count === 0) return NextResponse.json({ ok: true, requeued: 0 })
    await prisma.campaign.update({ where: { id }, data: { status: 'sending' } })
    const d = await drainCampaignSends({ deadlineMs: 45_000 })
    await refreshCampaignCounts(id)
    return NextResponse.json({ ok: true, requeued: r.count, sent: d.sent, failed: d.failed, held: d.skipped })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
