import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/campaigns/[id]/cancel — cancel a pending scheduled/queued send.
// Reverts not-yet-sent recipients (queued) back to pending and moves the
// campaign to draft, so it drops off the scheduled list. Already-sent
// recipients are left as-is.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const id = Number((await params).id)
  const c = await prisma.campaign.findUnique({ where: { id } })
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const reverted = await prisma.campaignRecipient.updateMany({
    where: { campaignId: id, status: 'queued' },
    data: { status: 'pending', selected: false, sendAt: null },
  })
  const anySent = await prisma.campaignRecipient.count({ where: { campaignId: id, status: 'sent' } })
  await prisma.campaign.update({
    where: { id },
    data: { status: anySent > 0 ? 'sent' : 'draft', scheduledAt: null },
  })
  return NextResponse.json({ ok: true, cancelled: reverted.count })
}
