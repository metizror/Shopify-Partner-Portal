// Campaign Sequence engine (batched drip: fresh → follow-up 1 → follow-up 2).
//
// A sequence splits a campaign's contacts into batches. Every `gapDays` at
// `sendHour` IST a cycle runs: batch k gets the fresh email, batch k-1 gets
// follow-up 1 (only contacts who haven't opened/replied), batch k-2 gets
// follow-up 2 (same filter). After follow-up 2 a contact is done forever.
//
// Opens are detected by a tracking pixel (/api/track/open?t=<openToken>);
// replies are marked manually in the admin. Either one stops follow-ups.
//
// Local-machine safety: runDueSequences() only ENQUEUES SequenceEmail rows;
// drainSequenceSends() — the part that talks to Brevo — no-ops when
// BREVO_API_KEY is unset, same as the campaign drainer.

/**
 * Random hex token, via Web Crypto rather than node:crypto.
 *
 * This file is reachable from instrumentation.ts, which Next bundles for the
 * edge runtime as well as Node — and importing `crypto` there is a build
 * warning even though the edge copy never runs. getRandomValues is available
 * in both, and these are opaque tracking tokens, so nothing here needs the
 * wider node:crypto surface.
 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
import { prisma } from '@/lib/db'
import { resolveSender, NO_SENDER } from '@/services/email'
import { unsubscribeAddress, type SenderInfo } from '@/services/brand'
import { sendBrevoDetailed } from '@/services/partner-notify'
import { isEmailConfigured } from '@/services/email-provider'
import { applyVars, composeEmailHtml } from '@/lib/email-html'
import { buildRecipientVars, isValidEmail } from '@/lib/campaign'
import { buildContext } from '@/services/flow-engine'

const BATCH = 40 // emails per cron tick, matches the campaign drainer
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // IST is UTC+5:30, no DST

export type EmailKind = 'fresh' | 'fu1' | 'fu2'

/** The moment `date`'s IST calendar day hits `hourIST`:00, as a UTC Date. */
export function atISTHour(date: Date, hourIST: number): Date {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIST, 0, 0) - IST_OFFSET_MS)
}

/** Next occurrence of `hourIST`:00 IST strictly after `from`. */
export function nextISTHour(from: Date, hourIST: number): Date {
  const today = atISTHour(from, hourIST)
  return today > from ? today : new Date(today.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * Who a sequence drips over.
 *   'sheet'     — batched drip over an imported campaign, paced by gapDays.
 *   'merchants' — event-triggered: a store is enrolled the moment it installs
 *                 or uninstalls, gets the fresh email on the next tick, then
 *                 fu1 after fu1Days and fu2 fu2Days after that. No batches.
 */
export interface SequenceAudience {
  source: 'sheet' | 'merchants'
  trigger?: 'install' | 'uninstall' | 'both'
  appId?: string | null // a specific app, or null/'all' for every app
}

/** One resolved contact, ready to be batched. Shape is identical whichever
 *  source produced it, so the drip engine never has to care which it was. */
interface ResolvedContact {
  email: string
  vars: Record<string, any>
}

/** True for a sequence whose contacts arrive from events rather than up front. */
function isTriggered(seq: { audience: unknown }): boolean {
  return (seq.audience as any)?.source === 'merchants'
}

interface CreateSequenceInput {
  campaignId?: number | null
  audience?: SequenceAudience | null
  name: string
  batchSize: number
  gapDays: number
  sendHour: number
  freshTemplateId: number
  freshSubject: string
  fu1TemplateId: number
  fu1Subject: string
  fu2TemplateId: number
  fu2Subject: string
  fu1Days?: number // triggered only: fresh → follow-up 1
  fu2Days?: number // triggered only: follow-up 1 → follow-up 2
  senderId?: number | null
  varMap?: Record<string, string>
  startNow?: boolean // true → cycle 1 fires on the next cron tick
  createdBy?: string | null
}

/**
 * Create a sequence from its audience.
 *   sheet     — a campaign's valid recipients, split into batches in sheet
 *               order; cycle 1 fires now (startNow) or at the next sendHour IST.
 *   merchants — nothing to enrol up front. The sequence sits armed and picks up
 *               stores as they install/uninstall (see enrollTriggeredSequences).
 */
export async function createSequence(input: CreateSequenceInput): Promise<{ ok: boolean; id?: number; error?: string }> {
  const source = input.audience?.source === 'merchants' ? 'merchants' : 'sheet'
  const batchSize = Math.max(1, Math.floor(input.batchSize))
  const gapDays = Math.max(1, Math.floor(input.gapDays))
  const sendHour = Math.min(23, Math.max(0, Math.floor(input.sendHour)))
  const fu1Days = Math.max(1, Math.floor(input.fu1Days ?? 2))
  const fu2Days = Math.max(1, Math.floor(input.fu2Days ?? 3))

  let recipients: ResolvedContact[]
  let audience: SequenceAudience
  let campaignId: number | null = null

  if (source === 'merchants') {
    const appId = input.audience?.appId && input.audience.appId !== 'all' ? input.audience.appId : null
    const t = input.audience?.trigger
    const trigger = t === 'install' || t === 'uninstall' || t === 'both' ? t : 'install'
    // Starts empty on purpose — a triggered sequence enrols a store only when
    // that store actually installs/uninstalls, so nobody gets a "welcome" for
    // an install that happened months ago.
    recipients = []
    audience = { source: 'merchants', trigger, appId }
  } else {
    if (!input.campaignId) return { ok: false, error: 'campaignId is required for a sheet sequence' }
    const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId } })
    if (!campaign) return { ok: false, error: 'campaign not found' }
    const rows = await prisma.campaignRecipient.findMany({
      where: { campaignId: input.campaignId, status: { not: 'skipped' } },
      select: { email: true, vars: true },
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) return { ok: false, error: 'campaign has no valid recipients' }
    recipients = rows.map((r) => ({ email: r.email, vars: (r.vars || {}) as any }))
    audience = { source: 'sheet' }
    campaignId = input.campaignId
  }

  const totalBatches = Math.ceil(recipients.length / batchSize)
  const now = new Date()
  // A triggered sequence has no cycle clock — runDueSequences() picks sequences
  // by nextRunAt, and leaving it null keeps merchant sequences out of that
  // sweep. Their contacts are advanced by nextDueAt instead.
  const nextRunAt = source === 'merchants' ? null : input.startNow ? now : nextISTHour(now, sendHour)

  const seq = await prisma.campaignSequence.create({
    data: {
      campaignId,
      audience: audience as any,
      name: input.name.slice(0, 255),
      batchSize,
      gapDays,
      sendHour,
      fu1Days,
      fu2Days,
      freshTemplateId: input.freshTemplateId,
      freshSubject: input.freshSubject.trim().slice(0, 255),
      fu1TemplateId: input.fu1TemplateId,
      fu1Subject: input.fu1Subject.trim().slice(0, 255),
      fu2TemplateId: input.fu2TemplateId,
      fu2Subject: input.fu2Subject.trim().slice(0, 255),
      senderId: input.senderId ?? null,
      varMap: (input.varMap || {}) as any,
      status: 'running',
      currentCycle: 0,
      totalBatches,
      nextRunAt,
      activity: [] as any,
      createdBy: input.createdBy || null,
    },
  })

  await prisma.sequenceContact.createMany({
    data: recipients.map((r, i) => ({
      sequenceId: seq.id,
      email: r.email,
      vars: r.vars as any,
      batchNo: Math.floor(i / batchSize) + 1,
      openToken: randomHex(24),
    })),
    skipDuplicates: true,
  })

  return { ok: true, id: seq.id }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Enrol a store into every armed merchant sequence matching this event, and
 * queue its fresh email right away.
 *
 * Called from the event poller next to runFlowsForTrigger(), so a sequence
 * reacts to exactly the same events a flow does — and, by reusing the flow
 * engine's context builder, with exactly the same merge vars: {{store_name}}
 * and friends plus the uninstall snapshot ({{uninstall_reason}},
 * {{usage_duration}}, {{install_date}}, …).
 *
 * A store already enrolled in a sequence is not enrolled again — the unique
 * (sequenceId, email) constraint means a reinstall won't restart a drip that is
 * already in flight, and won't re-send a fresh email to someone mid-follow-up.
 */
export async function enrollTriggeredSequences(input: {
  trigger: 'install' | 'uninstall'
  appId?: string | null
  domain?: string | null
  storeName?: string | null
  occurredAt?: string
}): Promise<{ enrolled: number }> {
  const seqs = await prisma.campaignSequence.findMany({ where: { status: 'running' } })
  const armed = seqs.filter((s) => {
    const a = s.audience as any
    if (a?.source !== 'merchants') return false
    if (a.trigger !== 'both' && a.trigger !== input.trigger) return false
    // No appId on the audience means every app.
    return !a.appId || a.appId === 'all' || a.appId === input.appId
  })
  if (armed.length === 0) return { enrolled: 0 }

  // One context for the whole event — every armed sequence sees the same store.
  const ctx = await buildContext({
    trigger: input.trigger === 'uninstall' ? 'customer_uninstalls' : 'customer_installs',
    appId: input.appId, domain: input.domain, storeName: input.storeName, occurredAt: input.occurredAt,
  })
  const email = String(ctx.email || '').trim().toLowerCase()
  // Nothing to send to. The store is still recorded by the poller; it just
  // can't be dripped until an email turns up for it. Logged rather than dropped
  // silently — "0 enrolled" with no explanation is impossible to debug from the UI.
  if (!isValidEmail(email)) {
    const at = new Date().toISOString()
    for (const seq of armed) {
      await logActivity(seq.id, { at, event: input.trigger, domain: ctx.domain, skipped: 'no email on file' }).catch(() => {})
    }
    return { enrolled: 0 }
  }

  const vars: Record<string, string> = {
    name: ctx.storeName || ctx.domain || '',
    store_name: ctx.storeName || ctx.domain || '',
    domain: ctx.domain || '',
    app_name: ctx.appName || '',
    plan: ctx.plan || '',
    country: ctx.country || '',
    mrr: String(ctx.mrr ?? 0),
    ltv: String(ctx.ltv ?? 0),
    ...(ctx.extra || {}),
  }

  const now = new Date()
  let enrolled = 0
  for (const seq of armed) {
    try {
      const contact = await prisma.sequenceContact.create({
        data: {
          sequenceId: seq.id,
          email,
          vars: vars as any,
          batchNo: 0,
          stage: 'fresh_sent',
          // Follow-up 1 is due fu1Days from this event, at the sequence's send
          // hour — the fresh email goes out now, the rest keeps office hours.
          nextDueAt: atISTHour(new Date(now.getTime() + seq.fu1Days * DAY_MS), seq.sendHour),
          openToken: randomHex(24),
        },
      })
      await enqueueKind(seq.id, [contact.id], 'fresh', now)
      await logActivity(seq.id, { at: now.toISOString(), event: input.trigger, domain: ctx.domain, fresh: 1 })
      enrolled++
    } catch {
      // Almost always the unique (sequenceId, email) constraint — this store is
      // already in this sequence. Skip it and carry on with the others.
    }
  }
  return { enrolled }
}

/**
 * Advance triggered contacts whose follow-up has come due. Each contact runs
 * its own clock, so stores are followed up relative to their own event rather
 * than to a shared cycle. Openers/repliers retire instead of being chased,
 * exactly as in the batched flow.
 */
async function runTriggeredFollowUps(): Promise<{ sent: number }> {
  const now = new Date()
  const due = await prisma.sequenceContact.findMany({
    where: {
      nextDueAt: { lte: now },
      stage: { in: ['fresh_sent', 'fu1_sent'] },
      sequence: { status: 'running' },
    },
    select: { id: true, sequenceId: true, stage: true, engaged: true, sequence: { select: { fu2Days: true, sendHour: true } } },
    take: 500,
  })

  let sent = 0
  for (const c of due) {
    // Opened or replied — they've responded, so stop chasing.
    if (c.engaged !== 'none') {
      await prisma.sequenceContact.update({ where: { id: c.id }, data: { stage: 'finished', nextDueAt: null } })
      continue
    }
    if (c.stage === 'fresh_sent') {
      await enqueueKind(c.sequenceId, [c.id], 'fu1', now)
      await prisma.sequenceContact.update({
        where: { id: c.id },
        data: {
          stage: 'fu1_sent',
          nextDueAt: atISTHour(new Date(now.getTime() + c.sequence.fu2Days * DAY_MS), c.sequence.sendHour),
        },
      })
    } else {
      // fu2 is the last email this contact will ever get.
      await enqueueKind(c.sequenceId, [c.id], 'fu2', now)
      await prisma.sequenceContact.update({ where: { id: c.id }, data: { stage: 'fu2_sent', nextDueAt: null } })
    }
    sent++
  }
  return { sent }
}

/** Append one entry to a sequence's admin timeline, newest last. */
async function logActivity(sequenceId: number, entry: Record<string, any>) {
  const seq = await prisma.campaignSequence.findUnique({ where: { id: sequenceId }, select: { activity: true } })
  const activity = Array.isArray(seq?.activity) ? (seq!.activity as any[]) : []
  activity.push(entry)
  // Keep the timeline bounded — a triggered sequence runs forever.
  await prisma.campaignSequence.update({
    where: { id: sequenceId },
    data: { activity: activity.slice(-500) as any },
  })
}

/**
 * Run every due sequence one cycle forward, then advance any triggered contact
 * whose follow-up is due. Called on each cron tick — cheap when nothing is due.
 * Only enqueues; the drainer does the actual sending.
 */
export async function runDueSequences(): Promise<{ ran: number }> {
  const due = await prisma.campaignSequence.findMany({
    where: { status: 'running', nextRunAt: { lte: new Date() } },
  })
  for (const seq of due) {
    try { await runSequenceCycle(seq.id) } catch { /* isolate failures per sequence */ }
  }
  try { await runTriggeredFollowUps() } catch { /* isolate from the batched sweep */ }
  return { ran: due.length }
}

/** Advance one sequence by one cycle: enqueue fresh/fu1/fu2 for the batches
 *  whose turn it is, retire engaged contacts, log activity, schedule the next
 *  cycle (or complete). */
async function runSequenceCycle(sequenceId: number) {
  const seq = await prisma.campaignSequence.findUnique({ where: { id: sequenceId } })
  if (!seq || seq.status !== 'running') return
  const cycle = seq.currentCycle + 1 // 1-based
  const now = new Date()

  // ── Fresh → batch `cycle` ──────────────────────────────────────────────
  let fresh = 0
  if (cycle <= seq.totalBatches) {
    const targets = await prisma.sequenceContact.findMany({
      where: { sequenceId, batchNo: cycle, stage: 'waiting' },
      select: { id: true },
    })
    fresh = await enqueueKind(sequenceId, targets.map((t) => t.id), 'fresh', now)
    await prisma.sequenceContact.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { stage: 'fresh_sent' },
    })
  }

  // ── Follow-up 1 → batch `cycle - 1`, only not-engaged ──────────────────
  let fu1 = 0, fu1Skipped = 0
  if (cycle - 1 >= 1 && cycle - 1 <= seq.totalBatches) {
    const batchNo = cycle - 1
    const targets = await prisma.sequenceContact.findMany({
      where: { sequenceId, batchNo, stage: 'fresh_sent', engaged: 'none' },
      select: { id: true },
    })
    fu1Skipped = await prisma.sequenceContact.count({
      where: { sequenceId, batchNo, stage: 'fresh_sent', engaged: { not: 'none' } },
    })
    fu1 = await enqueueKind(sequenceId, targets.map((t) => t.id), 'fu1', now)
    await prisma.sequenceContact.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { stage: 'fu1_sent' },
    })
    // Engaged contacts exit the journey here.
    await prisma.sequenceContact.updateMany({
      where: { sequenceId, batchNo, stage: 'fresh_sent', engaged: { not: 'none' } },
      data: { stage: 'finished' },
    })
  }

  // ── Follow-up 2 → batch `cycle - 2`, only still-not-engaged ────────────
  let fu2 = 0, fu2Skipped = 0
  if (cycle - 2 >= 1 && cycle - 2 <= seq.totalBatches) {
    const batchNo = cycle - 2
    const targets = await prisma.sequenceContact.findMany({
      where: { sequenceId, batchNo, stage: 'fu1_sent', engaged: 'none' },
      select: { id: true },
    })
    fu2Skipped = await prisma.sequenceContact.count({
      where: { sequenceId, batchNo, stage: 'fu1_sent', engaged: { not: 'none' } },
    })
    fu2 = await enqueueKind(sequenceId, targets.map((t) => t.id), 'fu2', now)
    // fu2 is the last email ever — terminal either way.
    await prisma.sequenceContact.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { stage: 'fu2_sent' },
    })
    await prisma.sequenceContact.updateMany({
      where: { sequenceId, batchNo, stage: 'fu1_sent', engaged: { not: 'none' } },
      data: { stage: 'finished' },
    })
  }

  // ── Log + advance ──────────────────────────────────────────────────────
  const activity = Array.isArray(seq.activity) ? (seq.activity as any[]) : []
  activity.push({ at: now.toISOString(), cycle, fresh, fu1, fu1Skipped, fu2, fu2Skipped })

  const lastCycle = seq.totalBatches + 2 // every batch has had its fu2 turn
  const completed = cycle >= lastCycle
  await prisma.campaignSequence.update({
    where: { id: sequenceId },
    data: {
      currentCycle: cycle,
      status: completed ? 'completed' : 'running',
      // Next cycle fires gapDays later at sendHour IST (anchored to now so a
      // late tick doesn't drift the schedule earlier).
      nextRunAt: completed ? null : atISTHour(new Date(now.getTime() + seq.gapDays * 24 * 60 * 60 * 1000), seq.sendHour),
      activity: activity as any,
    },
  })
}

/** Queue one email of `kind` for each contact id. Returns how many. */
async function enqueueKind(sequenceId: number, contactIds: number[], kind: EmailKind, sendAt: Date): Promise<number> {
  if (contactIds.length === 0) return 0
  await prisma.sequenceEmail.createMany({
    data: contactIds.map((contactId) => ({ sequenceId, contactId, kind, status: 'queued', sendAt })),
  })
  return contactIds.length
}

/** Base URL the tracking pixel points at — the live dashboard. */
function trackBaseUrl(): string {
  return (process.env.DASHBOARD_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/** Same unsubscribe block campaign emails use. */
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

/** Render one sequence email: template of `kind` in its layout, unsubscribe
 *  footer, and the open-tracking pixel injected before </body>. */
async function renderSequenceEmail(
  seq: { freshTemplateId: number; freshSubject: string; fu1TemplateId: number; fu1Subject: string; fu2TemplateId: number; fu2Subject: string; varMap: any },
  kind: EmailKind,
  contact: { email: string; vars: any; openToken: string },
) {
  const templateId = kind === 'fresh' ? seq.freshTemplateId : kind === 'fu1' ? seq.fu1TemplateId : seq.fu2TemplateId
  const subjectRaw = kind === 'fresh' ? seq.freshSubject : kind === 'fu1' ? seq.fu1Subject : seq.fu2Subject
  const t = await prisma.emailTemplate.findUnique({ where: { id: templateId } })
  if (!t) return null
  let header = ''
  let footer = ''
  if (t.layoutId) {
    const layout = await prisma.emailLayout.findUnique({ where: { id: t.layoutId } })
    if (layout) { header = layout.headerHtml; footer = layout.footerHtml }
  }
  const vars = buildRecipientVars(contact.vars as Record<string, any>, seq.varMap || {}, contact.email)
  let html = composeEmailHtml({ header, body: t.bodyHtml, footer: `${footer}${await unsubscribeInner(contact.email)}`, vars })
  const pixel = `<img src="${trackBaseUrl()}/api/track/open?t=${contact.openToken}" width="1" height="1" style="display:none;max-height:1px;max-width:1px;" alt="">`
  html = html.includes('</body>') ? html.replace('</body>', `${pixel}</body>`) : html + pixel
  return { subject: applyVars(subjectRaw && subjectRaw.trim() ? subjectRaw : t.subject, vars), html }
}

/**
 * Drain due sequence emails in one batch (same shape as drainCampaignSends).
 * No-ops without BREVO_API_KEY so dev machines never send.
 */
export async function drainSequenceSends(
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!(await isEmailConfigured())) return { sent: 0, failed: 0, skipped: true }
  const limit = opts.limit ?? BATCH
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000)

  const due = await prisma.sequenceEmail.findMany({
    where: { status: 'queued', sendAt: { lte: new Date() } },
    orderBy: { sendAt: 'asc' },
    take: limit,
    include: { contact: true },
  })
  if (due.length === 0) return { sent: 0, failed: 0, skipped: false }

  // Cache sequence config + sender per sequence across the batch.
  const seqCache = new Map<number, { seq: any; sender: SenderInfo | null }>()
  const getCfg = async (sequenceId: number) => {
    const hit = seqCache.get(sequenceId)
    if (hit) return hit
    const seq = await prisma.campaignSequence.findUnique({ where: { id: sequenceId } })
    const sender = await resolveSender(seq?.senderId ?? null)
    const cfg = { seq, sender }
    seqCache.set(sequenceId, cfg)
    return cfg
  }

  let sent = 0
  let failed = 0
  for (const e of due) {
    if (Date.now() >= deadline) break
    const cfg = await getCfg(e.sequenceId)
    if (!cfg.seq) { await markEmail(e.id, 'failed', 'sequence not found'); failed++; continue }

    // Engagement between enqueue and send still cancels the email.
    if (e.kind !== 'fresh' && e.contact.engaged !== 'none') {
      await prisma.sequenceEmail.update({ where: { id: e.id }, data: { status: 'skipped', error: `contact ${e.contact.engaged}` } })
      continue
    }

    // Claim (queued → sending) so a concurrent tick can't double-send.
    const claimed = await prisma.sequenceEmail.updateMany({
      where: { id: e.id, status: 'queued' },
      data: { status: 'sending' },
    })
    if (claimed.count === 0) continue

    try {
      const rendered = await renderSequenceEmail(cfg.seq, e.kind as EmailKind, e.contact)
      if (!rendered) { await markEmail(e.id, 'failed', 'template not found'); failed++; continue }
      // No configured from-address — fail visibly rather than send as whatever
      // address happened to be compiled in. Fix it in Email → Senders and requeue.
      if (!cfg.sender) { await markEmail(e.id, 'failed', NO_SENDER); failed++; continue }
      const res = await sendBrevoDetailed([e.contact.email], rendered.subject, rendered.html, cfg.sender.email, cfg.sender.name)
      if (res.ok) {
        await prisma.sequenceEmail.update({ where: { id: e.id }, data: { status: 'sent', sentAt: new Date(), messageId: normalizeMessageId(res.messageId), error: null } })
        await prisma.sequenceContact.update({ where: { id: e.contactId }, data: { lastSentAt: new Date(), error: null } })
        sent++
      } else {
        await markEmail(e.id, 'failed', res.detail || 'send failed')
        await prisma.sequenceContact.update({ where: { id: e.contactId }, data: { error: (res.detail || 'send failed').slice(0, 2000) } })
        failed++
      }
    } catch (err: any) {
      await markEmail(e.id, 'failed', err?.message || 'send error')
      failed++
    }
  }
  return { sent, failed, skipped: false }
}

async function markEmail(id: number, status: string, error?: string) {
  await prisma.sequenceEmail.update({ where: { id }, data: { status, error: error?.slice(0, 2000) || null } })
}

/** Stamp a contact as opened via their tracking-pixel token. Idempotent; a
 *  'replied' mark is stronger and never downgraded. */
export async function markOpenedByToken(token: string): Promise<boolean> {
  if (!token || token.length > 64) return false
  const contact = await prisma.sequenceContact.findUnique({ where: { openToken: token } })
  if (!contact) return false
  const data: any = {}
  if (!contact.openedAt) data.openedAt = new Date()
  if (contact.engaged === 'none') data.engaged = 'opened'
  if (Object.keys(data).length) await prisma.sequenceContact.update({ where: { id: contact.id }, data })
  return true
}

/** Normalize a Brevo message-id so the send value and the webhook value join
 *  regardless of angle-bracket / whitespace formatting differences. */
export function normalizeMessageId(raw?: string | null): string | null {
  if (!raw) return null
  const s = String(raw).trim().replace(/^<|>$/g, '').trim()
  return s ? s.slice(0, 255) : null
}

/**
 * Apply one Brevo webhook event to the matching sequence contact.
 * Matches strictly by message-id (the precise send→event join) so an open on
 * sequence A never bleeds into the same person's contact in sequence B.
 *  - opened / click        → engaged 'opened' (never downgrades 'replied')
 *  - unsubscribed          → engaged 'unsubscribed'
 *  - hard_bounce / blocked / invalid_email / spam → engaged 'bounced' (+error), stops follow-ups
 * Returns 'matched' | 'nomatch' | 'ignored'.
 */
export async function applyBrevoEvent(ev: { event?: string; messageId?: string; email?: string; reason?: string }): Promise<'matched' | 'nomatch' | 'ignored'> {
  const event = String(ev.event || '').toLowerCase()
  const mid = normalizeMessageId(ev.messageId)
  if (!mid) return 'nomatch'

  const emailRow = await prisma.sequenceEmail.findFirst({ where: { messageId: mid }, orderBy: { id: 'desc' }, select: { contactId: true } })
  if (!emailRow) return 'nomatch'
  const contact = await prisma.sequenceContact.findUnique({ where: { id: emailRow.contactId } })
  if (!contact) return 'nomatch'

  if (event === 'opened' || event === 'unique_opened' || event === 'click') {
    const data: any = {}
    if (!contact.openedAt) data.openedAt = new Date()
    if (contact.engaged === 'none') data.engaged = 'opened'
    if (Object.keys(data).length) await prisma.sequenceContact.update({ where: { id: contact.id }, data })
    return 'matched'
  }
  if (event === 'unsubscribed') {
    await prisma.sequenceContact.update({ where: { id: contact.id }, data: { engaged: 'unsubscribed' } })
    return 'matched'
  }
  if (event === 'hard_bounce' || event === 'blocked' || event === 'invalid_email' || event === 'spam') {
    const data: any = { error: `brevo ${event}${ev.reason ? ': ' + ev.reason : ''}`.slice(0, 2000) }
    if (contact.engaged === 'none') data.engaged = 'bounced' // stops future follow-ups (filter is engaged='none')
    await prisma.sequenceContact.update({ where: { id: contact.id }, data })
    return 'matched'
  }
  return 'ignored' // delivered / soft_bounce / request / deferred — nothing to do
}

/** Admin mark: replied / opened / unsubscribed / reset to none. */
export async function markContactEngagement(contactId: number, engaged: 'none' | 'opened' | 'replied' | 'unsubscribed'): Promise<{ ok: boolean; error?: string }> {
  const contact = await prisma.sequenceContact.findUnique({ where: { id: contactId } })
  if (!contact) return { ok: false, error: 'contact not found' }
  const data: any = { engaged }
  if (engaged === 'replied') data.repliedAt = contact.repliedAt || new Date()
  if (engaged === 'opened') data.openedAt = contact.openedAt || new Date()
  if (engaged === 'none') { data.repliedAt = null; data.openedAt = null }
  await prisma.sequenceContact.update({ where: { id: contactId }, data })
  return { ok: true }
}
