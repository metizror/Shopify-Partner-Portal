// Campaign send service. Persists an imported sheet as a Campaign + recipients,
// enqueues a selected subset for sending, and drains the queue in batches from
// the poll-events cron (respecting a deadline + Brevo rate limits).
//
// Local-machine safety: when BREVO_API_KEY is unset (as on dev machines), the
// drainer no-ops and leaves recipients queued — only the live server actually
// sends. Consistent with the "no email from local" rule.

import { prisma } from '@/lib/db'
import { resolveSender, NO_SENDER } from '@/services/email'
import { unsubscribeAddress, type SenderInfo } from '@/services/brand'
import { sendBrevoDetailed } from '@/services/partner-notify'
import { isEmailConfigured } from '@/services/email-provider'
import { applyVars, composeEmailHtml } from '@/lib/email-html'
import { buildRecipientVars, isValidEmail } from '@/lib/campaign'

const BATCH = 40 // recipients per cron tick — under the 60s timeout + Brevo rate

interface CreateInput {
  name: string
  fileName: string
  sheetName?: string
  headers: string[]
  emailColumn?: string | null
  rows: Record<string, any>[]
  createdBy?: string | null
}

/** Create a campaign and its recipient rows from a parsed sheet. Rows without a
 *  valid address land as status='skipped' so counts stay honest. */
export async function createCampaign(input: CreateInput) {
  const headers = (input.headers || []).map((h) => String(h))
  const emailColumn = input.emailColumn || null
  const campaign = await prisma.campaign.create({
    data: {
      name: input.name.slice(0, 255),
      fileName: input.fileName.slice(0, 255),
      sheetName: input.sheetName?.slice(0, 255) || null,
      headers: headers as any,
      emailColumn,
      status: 'draft',
      totalCount: input.rows.length,
      createdBy: input.createdBy || null,
    },
  })

  if (input.rows.length) {
    // Dedupe on email within this sheet; keep the first occurrence.
    const seen = new Set<string>()
    const data = input.rows.map((row) => {
      const email = emailColumn ? String(row[emailColumn] ?? '').trim() : ''
      const valid = isValidEmail(email) && !seen.has(email.toLowerCase())
      if (valid) seen.add(email.toLowerCase())
      return {
        campaignId: campaign.id,
        email: (email || `row-${Math.random().toString(36).slice(2)}@invalid.local`).slice(0, 320),
        vars: row as any,
        status: valid ? 'pending' : 'skipped',
      }
    })
    // createMany skips the unique [campaignId,email] collisions we already filtered.
    await prisma.campaignRecipient.createMany({ data, skipDuplicates: true })
  }
  return campaign
}

export interface Selection {
  mode: 'all' | 'ids' | 'random'
  ids?: number[]     // for mode='ids'
  n?: number         // for mode='random'
}

/**
 * Enqueue a selection of a campaign's recipients for sending now. Marks the
 * chosen recipients selected + queued with sendAt=now; everything else is
 * de-selected. Returns how many are queued.
 */
export async function queueCampaign(
  campaignId: number,
  opts: { templateId: number; subject: string; senderId?: number | null; varMap?: Record<string, string>; selection: Selection; scheduledAt?: Date | null },
): Promise<{ ok: boolean; queued: number; error?: string }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) return { ok: false, queued: 0, error: 'campaign not found' }
  if (!opts.templateId) return { ok: false, queued: 0, error: 'templateId required' }
  if (!opts.subject || !opts.subject.trim()) return { ok: false, queued: 0, error: 'subject is required' }

  // Eligible = has a valid address (status not 'skipped').
  const eligible = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { not: 'skipped' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const eligibleIds = eligible.map((r) => r.id)

  let chosen: number[]
  if (opts.selection.mode === 'ids') {
    const set = new Set(opts.selection.ids || [])
    chosen = eligibleIds.filter((id) => set.has(id))
  } else if (opts.selection.mode === 'random') {
    const n = Math.max(0, Math.min(opts.selection.n ?? 0, eligibleIds.length))
    chosen = shuffle(eligibleIds).slice(0, n)
  } else {
    chosen = eligibleIds
  }
  if (chosen.length === 0) return { ok: false, queued: 0, error: 'no eligible recipients selected' }

  const sendAt = opts.scheduledAt || new Date()

  // Persist the chosen template/sender/mapping on the campaign.
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      templateId: opts.templateId,
      subject: opts.subject.trim().slice(0, 255),
      senderId: opts.senderId ?? null,
      varMap: (opts.varMap || {}) as any,
      status: opts.scheduledAt ? 'scheduled' : 'sending',
      scheduledAt: opts.scheduledAt || null,
      sentCount: 0,
      failedCount: 0,
    },
  })

  // Reset selection, then queue the chosen ones.
  await prisma.campaignRecipient.updateMany({ where: { campaignId }, data: { selected: false } })
  await prisma.campaignRecipient.updateMany({
    where: { id: { in: chosen } },
    data: { selected: true, status: 'queued', sendAt, sentAt: null, error: null },
  })

  return { ok: true, queued: chosen.length }
}

/** The unsubscribe block appended to every campaign email's footer. Rendered as
 *  the last row of the email card via composeEmailHtml's footer slot. */
async function unsubscribeInner(email: string): Promise<string> {
  const to = await unsubscribeAddress()
  const href = to
    ? `mailto:${to}?subject=${encodeURIComponent('Unsubscribe')}&body=${encodeURIComponent('Please unsubscribe ' + email)}`
    : ''
  // No address configured — say so plainly rather than link somewhere that bounces.
  const link = href
    ? `<a href="${href}" style="color:#98a2b3;text-decoration:underline;">Unsubscribe</a>`
    : 'Reply to this email to unsubscribe.'
  return `<div style="padding:14px 24px;border-top:1px solid #eef0f2;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:#98a2b3;text-align:center;">
You received this email because you are on our contact list.
${link}
</div>`
}

/** Render a campaign email: the template body wrapped in its layout, with the
 *  unsubscribe block folded into the footer, personalized with this row. The
 *  subject is the campaign's own subject (falling back to the template's). Uses
 *  the same composeEmailHtml() the preview pane uses — preview === delivered. */
async function renderCampaignEmail(templateId: number, vars: Record<string, string>, email: string, subject?: string | null) {
  const t = await prisma.emailTemplate.findUnique({ where: { id: templateId } })
  if (!t) return null
  let header = ''
  let footer = ''
  if (t.layoutId) {
    const layout = await prisma.emailLayout.findUnique({ where: { id: t.layoutId } })
    if (layout) { header = layout.headerHtml; footer = layout.footerHtml }
  }
  return {
    subject: applyVars(subject && subject.trim() ? subject : t.subject, vars),
    html: composeEmailHtml({ header, body: t.bodyHtml, footer: `${footer}${await unsubscribeInner(email)}`, vars }),
  }
}

/**
 * Drain due campaign sends in one batch. Picks up to BATCH recipients that are
 * queued and past their sendAt, renders + sends each, and updates counts.
 * No-ops when BREVO_API_KEY is unset (dev machines) so the queue waits for the
 * live server. Safe to call every cron tick.
 */
export async function drainCampaignSends(
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!(await isEmailConfigured())) return { sent: 0, failed: 0, skipped: true }
  const limit = opts.limit ?? BATCH
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000)

  const due = await prisma.campaignRecipient.findMany({
    where: { status: 'queued', sendAt: { lte: new Date() } },
    orderBy: { sendAt: 'asc' },
    take: limit,
  })
  if (due.length === 0) return { sent: 0, failed: 0, skipped: false }

  // Cache campaign config + sender per campaign across the batch.
  const campaignCache = new Map<number, { templateId: number | null; subject: string | null; varMap: any; sender: SenderInfo | null }>()
  const getCfg = async (campaignId: number) => {
    const hit = campaignCache.get(campaignId)
    if (hit) return hit
    const c = await prisma.campaign.findUnique({ where: { id: campaignId } })
    const sender = await resolveSender(c?.senderId ?? null)
    const cfg = { templateId: c?.templateId ?? null, subject: c?.subject ?? null, varMap: c?.varMap ?? {}, sender }
    campaignCache.set(campaignId, cfg)
    return cfg
  }

  let sent = 0
  let failed = 0
  const touchedCampaigns = new Set<number>()

  for (const r of due) {
    if (Date.now() >= deadline) break
    touchedCampaigns.add(r.campaignId)
    const cfg = await getCfg(r.campaignId)
    if (!cfg.templateId) {
      await mark(r.id, 'failed', 'no template on campaign')
      failed++
      continue
    }
    // Claim the row first (queued → sending) so a concurrent tick can't double-send.
    const claimed = await prisma.campaignRecipient.updateMany({
      where: { id: r.id, status: 'queued' },
      data: { status: 'sending' },
    })
    if (claimed.count === 0) continue // another tick grabbed it

    try {
      const vars = buildRecipientVars(r.vars as Record<string, any>, cfg.varMap, r.email)
      const rendered = await renderCampaignEmail(cfg.templateId, vars, r.email, cfg.subject)
      if (!rendered) { await mark(r.id, 'failed', 'template not found'); failed++; continue }
      // No configured from-address — fail visibly rather than send as whatever
      // address happened to be compiled in. Fix it in Email → Senders and requeue.
      if (!cfg.sender) { await mark(r.id, 'failed', NO_SENDER); failed++; continue }
      const res = await sendBrevoDetailed([r.email], rendered.subject, rendered.html, cfg.sender.email, cfg.sender.name)
      if (res.ok) {
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'sent', sentAt: new Date(), error: null } })
        sent++
      } else {
        await mark(r.id, 'failed', res.detail || 'send failed')
        failed++
      }
    } catch (e: any) {
      await mark(r.id, 'failed', e?.message || 'send error')
      failed++
    }
  }

  // Refresh per-campaign counts + flip to 'sent' when the queue is empty.
  for (const cid of touchedCampaigns) await refreshCampaignCounts(cid)

  return { sent, failed, skipped: false }
}

async function mark(id: number, status: string, error?: string) {
  await prisma.campaignRecipient.update({ where: { id }, data: { status, error: error?.slice(0, 2000) || null } })
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Recompute a campaign's sent/failed counts and finalize its status. */
export async function refreshCampaignCounts(campaignId: number) {
  const [sent, failed, remaining] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: 'sent' } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: 'failed' } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: { in: ['queued', 'sending'] } } }),
  ])
  const c = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } })
  let status = c?.status || 'draft'
  // A scheduled campaign starts sending once its due recipients begin going out,
  // and both 'scheduled' and 'sending' finalize to 'sent' when the queue empties.
  if (remaining === 0 && sent + failed > 0) status = 'sent'
  else if (status === 'scheduled' && sent + failed > 0) status = 'sending'
  const data: any = { sentCount: sent, failedCount: failed, status }
  if (status === 'sent') data.scheduledAt = null // it's delivered — no longer scheduled
  await prisma.campaign.update({ where: { id: campaignId }, data })
}
