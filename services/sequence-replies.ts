// Auto-detect sequence replies by polling the Zoho mailbox.
//
// Brevo can't see replies (they go to the reply-to inbox, never to Brevo), so
// the only way to auto-mark 'replied' is to read the inbox and match incoming
// senders against sequence contacts. Runs on the cron heartbeat via
// pollPartnerEvents; no-ops entirely when Zoho isn't configured.

import { prisma } from '@/lib/db'
import { zohoConfigured, listRecentInbox } from '@/services/zoho-mail'
import { markContactEngagement } from '@/services/sequences'

const STATE_ID = 'zoho_reply_poll'

/**
 * Poll the inbox once and mark any contact whose email replied.
 * Only considers contacts that (a) belong to a running/paused sequence,
 * (b) are still engaged='none', and (c) have actually been sent an email —
 * so an inbound mail from a stranger, or a reply before we ever wrote them,
 * never flips anyone.
 */
export async function pollSequenceReplies(): Promise<{ skipped?: boolean; marked: number }> {
  if (!zohoConfigured()) return { skipped: true, marked: 0 }

  // Watermark: only act on mail newer than the last poll. First run watches
  // forward from now (we don't retro-scan the whole mailbox).
  const now = Date.now()
  const st = await prisma.state.findUnique({ where: { id: STATE_ID } })
  const lastCheck = Number((st?.value as any)?.at) || now

  // Candidate contacts, keyed by lowercased email → [contactId,…].
  const candidates = await prisma.sequenceContact.findMany({
    where: {
      engaged: 'none',
      sequence: { status: { in: ['running', 'paused'] } },
      emails: { some: { status: 'sent' } },
    },
    select: { id: true, email: true },
  })
  if (candidates.length === 0) {
    await writeWatermark(now)
    return { marked: 0 }
  }
  const byEmail = new Map<string, number[]>()
  for (const c of candidates) {
    const key = c.email.trim().toLowerCase()
    const arr = byEmail.get(key) || []
    arr.push(c.id)
    byEmail.set(key, arr)
  }

  let messages
  try {
    messages = await listRecentInbox(50)
  } catch (e) {
    console.error('[sequence-replies] inbox read failed:', e)
    return { marked: 0 } // don't advance the watermark — retry these next tick
  }

  let marked = 0
  let newest = lastCheck
  for (const m of messages) {
    if (m.receivedTime > newest) newest = m.receivedTime
    if (m.receivedTime <= lastCheck) continue // already seen in a prior poll
    const ids = byEmail.get(m.from)
    if (!ids) continue
    for (const id of ids) {
      const res = await markContactEngagement(id, 'replied')
      if (res.ok) marked++
    }
  }

  await writeWatermark(Math.max(newest, now))
  return { marked }
}

async function writeWatermark(at: number) {
  await prisma.state.upsert({
    where: { id: STATE_ID },
    create: { id: STATE_ID, value: { at } },
    update: { value: { at } },
  })
}
