// The Flows execution engine. Given a trigger that just fired (an install /
// uninstall / subscription event), it finds every active flow that matches the
// trigger + app scope, evaluates each flow's condition/action steps against the
// customer, performs the actions (immediately, or enqueued when a delay is set),
// and records a FlowRun for the Overview KPIs.

import { prisma } from '@/lib/db'
import { sendBrevoDetailed, appInfoForAsync } from '@/services/partner-notify'
import { renderEmailTemplate, resolveSender, getNotifyRecipients, NO_SENDER } from '@/services/email'
import { alertsSender } from '@/services/brand'
import { composeEmailHtml } from '@/lib/email-html'
import { addDays, calendarDay, formatDateTime, weekdayOf, zonedInstant } from '@/lib/tz'
import { eventEmailKind, type FlowStep } from '@/services/flow-constants'
import { buildInstallEmail, buildUninstallEmail } from '@/services/email-templates'
import { appInfo } from '@/services/app-catalog'
import { loadUninstallSnapshot } from '@/services/uninstall-enrichment'


export interface TriggerInput {
  trigger: string
  appId?: string | null
  domain?: string | null
  storeName?: string | null
  occurredAt?: string
}

export interface FlowContext {
  trigger: string
  occurredAt: string | null
  domain: string | null
  appId: string | null
  appName: string
  org: string
  storeName: string
  email: string | null
  country: string | null
  plan: string | null
  mrr: number
  ltv: number
  tags: string[]
  accountOwner: string | null
  extra?: Record<string, string> // extra merge vars (e.g. scheduled-digest {{installs}}, {{summary}})
}

const DAY_MS = 24 * 3_600_000
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)

/** Dates in emails use TZ_DISPLAY, matching the rest of the dashboard. */
const fmtIST = formatDateTime

/** Fill {{placeholders}} from the context. */
function tmpl(str: string, ctx: FlowContext): string {
  if (!str) return ''
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    switch (key) {
      case 'name': case 'store': case 'storeName': return ctx.storeName || ctx.domain || ''
      case 'domain': return ctx.domain || ''
      case 'app': case 'appName': return ctx.appName || ''
      case 'country': return ctx.country || ''
      case 'plan': return ctx.plan || ''
      case 'mrr': return String(ctx.mrr)
      case 'ltv': return String(ctx.ltv)
      case 'email': return ctx.email || ''
      default: return ctx.extra && key in ctx.extra ? ctx.extra[key] : ''
    }
  })
}

/** Flatten a context into the {{merge}} variable map used by email templates. */
function ctxVars(ctx: FlowContext): Record<string, string> {
  return {
    name: ctx.storeName || ctx.domain || '', store: ctx.storeName || ctx.domain || '',
    storeName: ctx.storeName || ctx.domain || '', domain: ctx.domain || '',
    app: ctx.appName, appName: ctx.appName, country: ctx.country || '', plan: ctx.plan || '',
    mrr: String(ctx.mrr), ltv: String(ctx.ltv), email: ctx.email || '',
    ...(ctx.extra || {}),
  }
}

// Exported so triggered sequences (services/sequences.ts) enrol merchants with
// exactly the merge vars a flow would have had for the same event — including
// the uninstall snapshot fields.
export async function buildContext(input: TriggerInput): Promise<FlowContext> {
  const domain = input.domain || null
  const appId = input.appId || null
  const info = appId ? await appInfoForAsync(appId) : { name: '', org: '' }
  const ctx: FlowContext = {
    trigger: input.trigger, occurredAt: input.occurredAt || null,
    domain, appId, appName: info.name, org: info.org, storeName: input.storeName || domain || '',
    email: null, country: null, plan: null, mrr: 0, ltv: 0, tags: [], accountOwner: null,
  }
  if (domain) {
    const cust = await prisma.customer.findUnique({ where: { domain } })
    if (cust) {
      ctx.email = cust.email
      ctx.country = cust.country
      ctx.plan = cust.plan
      ctx.mrr = cust.mrr
      ctx.ltv = cust.ltv
      ctx.tags = Array.isArray(cust.tags) ? (cust.tags as string[]) : []
      ctx.accountOwner = cust.accountOwner
      if (cust.name) ctx.storeName = cust.name
    }
    if (!ctx.email) {
      const se = await prisma.storeEmail.findUnique({ where: { domain } })
      if (se) ctx.email = se.email
    }
    if (!ctx.country) {
      const sc = await prisma.storeCountry.findUnique({ where: { domain } })
      if (sc) ctx.country = sc.country
    }
  }

  // Uninstall enrichment — install/uninstall dates, plan, usage duration and
  // the last app user, captured from the app's own API when the store
  // uninstalled (services/uninstall-enrichment.ts).
  //
  // Deliberately NOT gated on `input.trigger`: drainFlowTasks() rebuilds a
  // delayed action's context with trigger:'' (the trigger is lost when the task
  // is queued), so gating would silently blank every DELAYED uninstall email —
  // exactly the case this data exists for.
  if (domain && appId) {
    const snap = await loadUninstallSnapshot(appId, domain).catch(() => null)
    if (snap) {
      if (snap.planType) ctx.plan = snap.planType
      ctx.extra = {
        ...(ctx.extra || {}),
        install_date: fmtIST(snap.installedAt),
        uninstall_date: fmtIST(snap.uninstalledAt),
        usage_duration: snap.durationText || '',
        usage_duration_days: snap.durationDays != null ? String(snap.durationDays) : '',
        previous_plan: snap.previousPlan || '',
        uninstall_reason: snap.uninstallReason || '',
        uninstall_reason_detail: snap.reasonDetail || '',
        last_user_email: snap.lastUserEmail || '',
        last_user_name: snap.lastUserName || '',
        last_user_at: fmtIST(snap.lastAccessedAt),
        shop_contact_email: snap.contactEmail || '',
        shop_contact_name: snap.contactName || '',
      }
      // Last resort for the recipient address. Most churned stores have no
      // Customer/StoreEmail row — the shop-lookup snapshot is often the ONLY
      // place we hold their address, so without this fallback a "send to the
      // merchant" flow step and every triggered sequence silently skip the
      // store. Shop contact first, then the last app user.
      if (!ctx.email) ctx.email = snap.contactEmail || snap.lastUserEmail || null
    }
  }
  return ctx
}

/** Scheduled-digest context: adds {{installs}} {{uninstalls}} {{net}} {{summary}}
 *  {{period}} for the install/uninstall activity since this flow's last run. */
async function buildDigestContext(flow: any): Promise<FlowContext> {
  const ctx = await buildContext({ trigger: 'scheduled', storeName: 'Scheduled digest' })
  const appId = flow.appScope && flow.appScope !== 'all' ? String(flow.appScope) : null
  const since = flow.lastEventAt ? new Date(flow.lastEventAt) : new Date(Date.now() - DAY_MS)
  const events = await prisma.shopifyAppEvent.findMany({
    where: { ...(appId ? { appId } : {}), occurredAt: { gt: since } },
    orderBy: { occurredAt: 'asc' }, take: 500,
  })
  const installs = events.filter((e) => e.type === 'installed')
  const uninstalls = events.filter((e) => e.type === 'uninstalled')
  const nameByApp = new Map<string, string>()
  for (const id of new Set(events.map((e) => e.appId))) nameByApp.set(id, (await appInfoForAsync(id)).name)
  const row = (e: (typeof events)[number]) => {
    const badge = e.type === 'installed' ? '🟢 Installed' : '🔴 Uninstalled'
    const store = e.storeName || e.storeDomain || 'store'
    return `<li>${badge}: <b>${store}</b>${appId ? '' : ` — ${nameByApp.get(e.appId) || e.appId}`}</li>`
  }
  const summary = events.length
    ? `<ul style="padding-left:18px;margin:8px 0">${events.map(row).join('')}</ul>`
    : '<p style="color:#6b7280">No install/uninstall activity in this period.</p>'
  ctx.extra = {
    installs: String(installs.length),
    uninstalls: String(uninstalls.length),
    net: String(installs.length - uninstalls.length),
    summary,
    period: `since ${formatDateTime(since)}`,
  }
  return ctx
}

function evalRule(rule: { field?: string; op?: string; value?: any }, ctx: FlowContext): boolean {
  const { field, op, value } = rule
  let actual: any
  switch (field) {
    case 'country': actual = ctx.country; break
    case 'plan': actual = ctx.plan; break
    case 'mrr': actual = ctx.mrr; break
    case 'ltv': actual = ctx.ltv; break
    case 'appId': actual = ctx.appId; break
    case 'tag': actual = ctx.tags; break
    default: return true // unknown field → don't block
  }
  const strA = String(actual ?? '').toLowerCase()
  const strV = String(value ?? '').toLowerCase()
  switch (op) {
    case 'eq': return field === 'tag' ? ctx.tags.map((t) => t.toLowerCase()).includes(strV) : strA === strV
    case 'neq': return field === 'tag' ? !ctx.tags.map((t) => t.toLowerCase()).includes(strV) : strA !== strV
    case 'contains': return field === 'tag' ? ctx.tags.some((t) => t.toLowerCase().includes(strV)) : strA.includes(strV)
    case 'gt': return Number(actual) > Number(value)
    case 'lt': return Number(actual) < Number(value)
    default: return true
  }
}

// A condition node holds one or more rules combined with ALL (AND) or ANY (OR).
// Back-compatible with the old single-rule shape { field, op, value }.
function evalCondition(config: any, ctx: FlowContext): boolean {
  const rules: any[] = Array.isArray(config?.rules) ? config.rules : (config?.field ? [config] : [])
  if (rules.length === 0) return true
  const match = config?.match === 'any' ? 'any' : 'all'
  return match === 'any' ? rules.some((r) => evalRule(r, ctx)) : rules.every((r) => evalRule(r, ctx))
}

/** Ensure a Customer row exists so tag/owner columns have somewhere to live. */
async function ensureCustomer(ctx: FlowContext) {
  if (!ctx.domain) return
  await prisma.customer.upsert({
    where: { domain: ctx.domain },
    create: {
      domain: ctx.domain, name: ctx.storeName || ctx.domain, status: 'installed',
      country: ctx.country, email: ctx.email, tags: ctx.tags as any,
    },
    update: {}, // don't touch projected fields here
  })
}

export interface ActionResult { ok: boolean; detail: string }

/** Perform a single action's side effect immediately. */
export async function performAction(type: string, config: Record<string, any>, ctx: FlowContext): Promise<ActionResult> {
  switch (type) {
    case 'add_tag': {
      const tag = tmpl(String(config.tag || ''), ctx).trim()
      if (!tag || !ctx.domain) return { ok: false, detail: 'no tag/domain' }
      await ensureCustomer(ctx)
      if (!ctx.tags.includes(tag)) {
        ctx.tags = [...ctx.tags, tag]
        await prisma.customer.update({ where: { domain: ctx.domain }, data: { tags: ctx.tags as any } })
      }
      return { ok: true, detail: `tagged "${tag}"` }
    }
    case 'remove_tag': {
      const tag = tmpl(String(config.tag || ''), ctx).trim()
      if (!tag || !ctx.domain) return { ok: false, detail: 'no tag/domain' }
      if (ctx.tags.includes(tag)) {
        ctx.tags = ctx.tags.filter((t) => t !== tag)
        await prisma.customer.update({ where: { domain: ctx.domain }, data: { tags: ctx.tags as any } }).catch(() => {})
      }
      return { ok: true, detail: `removed "${tag}"` }
    }
    case 'add_timeline_comment': {
      const body = tmpl(String(config.comment || ''), ctx).trim()
      if (!body || !ctx.domain) return { ok: false, detail: 'no comment/domain' }
      await prisma.timelineComment.create({ data: { domain: ctx.domain, body, author: 'Flow' } })
      return { ok: true, detail: 'comment posted' }
    }
    case 'assign_account_owner': {
      const owner = tmpl(String(config.owner || ''), ctx).trim()
      if (!ctx.domain) return { ok: false, detail: 'no domain' }
      await ensureCustomer(ctx)
      await prisma.customer.update({ where: { domain: ctx.domain }, data: { accountOwner: owner || null } })
      return { ok: true, detail: `owner=${owner || 'cleared'}` }
    }
    case 'add_custom_field': {
      const label = String(config.field || '').trim()
      const key = slug(label)
      if (!key || !ctx.domain) return { ok: false, detail: 'no field/domain' }
      await prisma.customFieldDef.upsert({ where: { key }, create: { key, label, type: 'text' }, update: {} })
      const value = tmpl(String(config.value ?? ''), ctx)
      await prisma.customFieldValue.upsert({
        where: { domain_fieldKey: { domain: ctx.domain, fieldKey: key } },
        create: { domain: ctx.domain, fieldKey: key, value },
        update: { value },
      })
      return { ok: true, detail: `${key}=${value}` }
    }
    case 'create_task': {
      const title = tmpl(String(config.title || ''), ctx).trim()
      if (!title) return { ok: false, detail: 'no title' }
      await prisma.task.create({
        data: { title, domain: ctx.domain, assignee: config.assignee ? String(config.assignee) : null, source: 'flow' },
      })
      return { ok: true, detail: `task "${title}"` }
    }
    case 'send_email': {
      // Who receives it:
      //   'recipients' (default) → the team list from Email → Settings (never the merchant)
      //   'specific'             → the addresses typed in the To field
      //   'merchant'             → the store's own email
      const mode: string = config.sendTo || (config.to ? 'specific' : 'recipients')
      let recipients: string[] = []
      if (mode === 'merchant') {
        recipients = ctx.email ? [ctx.email] : []
      } else if (mode === 'specific') {
        const explicit = tmpl(String(config.to || ''), ctx)
        recipients = explicit.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e))
      } else {
        recipients = await getNotifyRecipients()
      }
      recipients = Array.from(new Set(recipients))
      if (recipients.length === 0) {
        const why = mode === 'merchant' ? 'the store has no email on file'
          : mode === 'specific' ? 'no valid To address'
          : 'no notification recipients set (add them in Email → Settings)'
        return { ok: false, detail: why }
      }
      const sender = await resolveSender(config.senderId ? Number(config.senderId) : null)
      // Nothing configured to send as — refuse rather than mail a merchant from
      // some address baked into the source. Shows up in the flow run log.
      if (!sender) return { ok: false, detail: NO_SENDER }

      // What builds the email — mirrors the "Email content" picker in FlowBuilder:
      //   builtin  → our standard styled install/uninstall alert (event triggers only)
      //   template → a saved Email → Templates row
      //   custom   → the inline subject/body on this step
      // Old flows have no emailSource: they keep their previous behaviour (a
      // selected templateId wins, else built-in for install/uninstall, else custom).
      const kind = eventEmailKind(ctx.trigger)
      const stored = config.emailSource
      const source: 'builtin' | 'template' | 'custom' =
        stored === 'builtin' || stored === 'template' || stored === 'custom' ? stored
          : config.templateId ? 'template'
          : kind ? 'builtin'
          : 'custom'

      if (source === 'template') {
        if (!config.templateId) return { ok: false, detail: 'no email template selected on this step' }
        const rendered = await renderEmailTemplate(Number(config.templateId), ctxVars(ctx))
        if (!rendered) return { ok: false, detail: `email template ${config.templateId} not found` }
        const r = await sendBrevoDetailed(recipients, rendered.subject, rendered.html, sender.email, sender.name)
        return { ok: r.ok, detail: r.ok ? `emailed ${recipients.length} (template)` : r.detail }
      }

      if (source === 'builtin' && kind) {
        const time = formatDateTime(ctx.occurredAt || Date.now())
        // The App Store link in the built-in templates comes from the app's
        // handle on its ShopifyApp row; no row, no link.
        const handle = ctx.appId ? (await appInfo(ctx.appId)).handle : null
        const base = { app_id: ctx.appId || '', app_name: ctx.appName, org: ctx.org, store_name: ctx.storeName, store_url: ctx.domain || '', email: ctx.email || '', time, app_handle: handle }
        const built = kind === 'install'
          ? buildInstallEmail(base)
          : buildUninstallEmail({ ...base, plan_name: ctx.plan || undefined, plan_amount: ctx.mrr })
        const r = await sendBrevoDetailed(recipients, built.subject, built.html, sender.email, sender.name)
        return { ok: r.ok, detail: r.ok ? `emailed ${recipients.length} (${kind} template)` : r.detail }
      }

      const subject = tmpl(String(config.subject || 'A message from us'), ctx)
      const body = tmpl(String(config.body || ''), ctx)
      const inner = body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br>')}</p>`
      // Same shell as the template editor's preview, so an ad-hoc flow email
      // still looks like the rest of our mail.
      const html = composeEmailHtml({ body: inner })
      const r = await sendBrevoDetailed(recipients, subject, html, sender.email, sender.name)
      return { ok: r.ok, detail: r.ok ? `emailed ${recipients.join(', ').slice(0, 60)}` : r.detail }
    }
    case 'send_team_notification': {
      // Same managed list the "send to my team" email step uses, so both
      // step types follow Email → Settings instead of drifting apart.
      const to = await getNotifyRecipients()
      if (to.length === 0) return { ok: false, detail: 'no team recipients set (add them in Email → Settings)' }
      const rawMessage = String(config.message || '')
      const message = tmpl(rawMessage, ctx)
      // The message is now authored in a rich-text editor, so it's already HTML.
      // Older flows stored plain text — detect that and keep the legacy
      // newline→<br> wrapping so they render the same as before.
      const looksHtml = /<(p|br|div|ul|ol|li|h[1-6]|strong|em|b|i|u|a|span|blockquote|pre|hr)\b/i.test(rawMessage)
      const body = looksHtml ? message : `<p>${message.replace(/\n/g, '<br>')}</p>`
      // Use the step's own subject if set; fall back to the legacy default so
      // existing flows built before this field keep their old subject line.
      const subject = tmpl(String(config.subject || '').trim(), ctx)
        || `Flow alert — ${ctx.storeName || ctx.domain || 'customer'}`
      const html = `${body}<hr><p style="color:#6b7280;font-size:12px">Store: ${ctx.storeName || ctx.domain} · App: ${ctx.appName}</p>`
      const from = await alertsSender()
      if (!from) return { ok: false, detail: NO_SENDER }
      const r = await sendBrevoDetailed(to, subject, html, from.email, from.name)
      return { ok: r.ok, detail: r.ok ? `notified ${to.length}` : r.detail }
    }
    default:
      return { ok: false, detail: `unknown action ${type}` }
  }
}

function delayMs(config: Record<string, any>): number {
  const d = config?.delay
  if (!d || !d.value || Number(d.value) <= 0) return 0
  const v = Number(d.value)
  if (d.unit === 'minutes') return v * 60_000
  if (d.unit === 'days') return v * DAY_MS
  return v * 3_600_000 // hours default
}

export interface RunFlowResult { flowId: number; status: 'success' | 'failed' | 'skipped'; log: any[] }

/** Execute one flow against a prepared context. */
export async function runFlow(
  flow: { id: number; steps: unknown; trigger: string },
  ctx: FlowContext,
): Promise<RunFlowResult> {
  const steps = (Array.isArray(flow.steps) ? flow.steps : []) as (FlowStep & { parentId?: string })[]
  const log: any[] = []
  let status: RunFlowResult['status'] = 'success'
  let ranAnyAction = false

  // Build a children map from parentId (the branch tree). Old flows saved before
  // branching have no parentId → treat them as a single linear chain.
  const children = new Map<string, (FlowStep & { parentId?: string })[]>()
  const push = (parent: string, s: FlowStep & { parentId?: string }) => {
    const arr = children.get(parent); if (arr) arr.push(s); else children.set(parent, [s])
  }
  if (steps.some((s) => s.parentId)) {
    for (const s of steps) push(s.parentId || 'trigger', s)
  } else {
    let prev = 'trigger'; for (const s of steps) { push(prev, s); prev = s.id }
  }

  const visited = new Set<string>()
  const runNode = async (nodeId: string): Promise<void> => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    for (const step of children.get(nodeId) || []) {
      if (step.kind === 'condition') {
        const pass = evalCondition(step.config || {}, ctx)
        log.push({ id: step.id, kind: 'condition', type: step.type, pass })
        if (pass) await runNode(step.id) // else this branch stops here
        continue
      }
      // action
      const wait = delayMs(step.config || {})
      if (wait > 0) {
        await prisma.flowTask.create({
          data: { flowId: flow.id, domain: ctx.domain, appId: ctx.appId, action: { type: step.type, config: step.config } as any, runAt: new Date(Date.now() + wait) },
        })
        log.push({ id: step.id, kind: 'action', type: step.type, deferred: true, runInMs: wait })
      } else {
        const res = await performAction(step.type, step.config || {}, ctx)
        log.push({ id: step.id, kind: 'action', type: step.type, ok: res.ok, detail: res.detail })
        ranAnyAction = true
        if (!res.ok) status = 'failed'
      }
      await runNode(step.id) // continue down this branch
    }
  }

  try {
    await runNode('trigger')
    // Nothing ran and no immediate action executed → the branches were all gated off.
    if (status === 'success' && !ranAnyAction && !log.some((l) => l.deferred)) {
      if (log.some((l) => l.kind === 'condition')) status = 'skipped'
    }
  } catch (e: any) {
    status = 'failed'
    log.push({ error: e?.message || 'run error' })
  }

  const run = await prisma.flowRun.create({
    data: { flowId: flow.id, trigger: flow.trigger, appId: ctx.appId, domain: ctx.domain, status, log: log as any },
  })
  // Backfill runId on any deferred tasks created during this run.
  if (log.some((l) => l.deferred)) {
    await prisma.flowTask.updateMany({
      where: { flowId: flow.id, domain: ctx.domain, runId: null, status: 'pending' },
      data: { runId: run.id },
    })
  }
  return { flowId: flow.id, status, log }
}

/**
 * Entry point: a trigger fired — run every matching active flow. Best-effort and
 * self-contained: never throws (so it can be called from the event pipeline
 * without risking the caller).
 */
export async function runFlowsForTrigger(input: TriggerInput): Promise<{ ran: number }> {
  try {
    const flows = await prisma.flow.findMany({ where: { trigger: input.trigger, active: true } })
    // Fire immediately only for flows WITHOUT a schedule. A scheduled event-flow
    // batches its matching events to the scheduled time instead (see runDueFlows /
    // processEventBacklog), so we must not also fire it here or it double-runs.
    const matching = flows.filter(
      (f) => (f.appScope === 'all' || f.appScope === (input.appId || '')) && !f.scheduleId && !f.schedule,
    )
    if (matching.length === 0) return { ran: 0 }
    const ctx = await buildContext(input)
    let ran = 0
    for (const flow of matching) {
      await runFlow(flow, ctx).catch(() => {})
      ran++
    }
    return { ran }
  } catch {
    return { ran: 0 }
  }
}

/** Run one flow on demand (the builder's "Test" button). Executes for real
 *  against the given customer, ignoring the active flag / trigger match. */
export async function testFlow(
  flowId: number,
  domain: string | null,
  appId: string | null,
): Promise<RunFlowResult | null> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } })
  if (!flow) return null
  const scopeApp = appId || (flow.appScope !== 'all' ? flow.appScope : null)
  const ctx = await buildContext({ trigger: flow.trigger, domain, appId: scopeApp })
  return runFlow(flow, ctx)
}

/**
 * Next due time (UTC) for a schedule. The hour/minute a user picks is
 * wall-clock time in the display zone (TZ_DISPLAY) — "send at 9am" means 9am
 * where they are, on both sides of a daylight-saving change.
 *
 * This used to add a fixed 5.5 hours, which made every installation's schedules
 * run on Indian time.
 */
export function computeNextRun(schedule: any, from: Date = new Date()): Date {
  const s = schedule || {}
  if (s.freq === 'hourly') return new Date(from.getTime() + 3_600_000)
  const hour = Number.isFinite(s.hour) ? s.hour : 9
  const minute = Number.isFinite(s.minute) ? s.minute : 0

  // Candidate: the target time today, in the display zone.
  let day = calendarDay(from)
  if (s.freq === 'weekly') {
    const desired = Number.isFinite(s.weekday) ? s.weekday : 1
    day = addDays(day, (desired - weekdayOf(day) + 7) % 7)
    let at = zonedInstant(day, hour, minute)
    if (at.getTime() <= from.getTime()) at = zonedInstant(addDays(day, 7), hour, minute)
    return at
  }
  const at = zonedInstant(day, hour, minute)
  // Daily: already passed today → tomorrow.
  return at.getTime() > from.getTime() ? at : zonedInstant(addDays(day, 1), hour, minute)
}

/** The effective schedule for a flow: a reusable named schedule if set,
 *  otherwise its inline schedule. */
export async function effectiveSchedule(flow: any): Promise<any | null> {
  if (flow.scheduleId) {
    const s = await prisma.flowSchedule.findUnique({ where: { id: flow.scheduleId } })
    return s ? { freq: s.freq, hour: s.hour, minute: s.minute, weekday: s.weekday } : null
  }
  return flow.schedule || null
}

const DAY_MS_ = 24 * 3_600_000
const eventTypeForTrigger = (t: string) => (t === 'customer_uninstalls' || t === 'subscription_cancelled' ? 'uninstalled' : 'installed')

/** Matching trigger events for a flow that occurred after `since` (oldest-first). */
async function eventsForFlowSince(flow: any, since: Date): Promise<{ domain: string | null; storeName: string; appId: string; occurredAt: Date }[]> {
  const appId = flow.appScope && flow.appScope !== 'all' ? String(flow.appScope) : null
  if (flow.trigger === 'subscription_activated') {
    const cs = await prisma.charge.findMany({ where: { kind: 'subscription', ...(appId ? { appId } : {}), occurredAt: { gt: since } }, orderBy: { occurredAt: 'asc' }, take: 300 })
    return cs.map((c) => ({ domain: c.shopDomain, storeName: c.shopName || c.shopDomain || '', appId: c.appId, occurredAt: c.occurredAt }))
  }
  const type = eventTypeForTrigger(flow.trigger)
  const es = await prisma.shopifyAppEvent.findMany({ where: { type, ...(appId ? { appId } : {}), occurredAt: { gt: since } }, orderBy: { occurredAt: 'asc' }, take: 300 })
  return es.map((e) => ({ domain: e.storeDomain, storeName: e.storeName || e.storeDomain || '', appId: e.appId, occurredAt: e.occurredAt }))
}

/** Run an event flow once PER matching event since its watermark (per customer). */
async function processEventBacklog(flow: any): Promise<{ count: number; last: any }> {
  const since = flow.lastEventAt ? new Date(flow.lastEventAt) : new Date(Date.now() - DAY_MS_)
  const events = await eventsForFlowSince(flow, since)
  if (!events.length) return { count: 0, last: null }
  let last: any = null
  let newest = since
  for (const ev of events) {
    const ctx = await buildContext({ trigger: flow.trigger, appId: ev.appId, domain: ev.domain, storeName: ev.storeName, occurredAt: ev.occurredAt.toISOString() })
    const r = await runFlow(flow, ctx)
    last = { domain: ev.domain, status: r.status, log: r.log }
    if (ev.occurredAt.getTime() > newest.getTime()) newest = ev.occurredAt
  }
  await prisma.flow.update({ where: { id: flow.id }, data: { lastEventAt: newest } as any }).catch(() => {})
  return { count: events.length, last }
}

/** Run every active flow whose SCHEDULE is due. Event flows process the backlog
 *  of matching events since the last run; scheduled-trigger flows run a digest.
 *  Flows with no schedule (nextRunAt = null) never auto-run. */
export async function runDueFlows(): Promise<{ ran: number }> {
  const now = new Date()
  const flows = await prisma.flow.findMany({ where: { active: true, nextRunAt: { not: null, lte: now } } })
  let ran = 0
  for (const f of flows) {
    try {
      if (f.trigger === 'scheduled') {
        await runFlow(f, await buildDigestContext(f))
        await prisma.flow.update({ where: { id: f.id }, data: { lastEventAt: now } as any }).catch(() => {})
      } else {
        await processEventBacklog(f)
      }
      ran++
    } catch { /* best-effort */ }
    const sched = await effectiveSchedule(f)
    await prisma.flow.update({ where: { id: f.id }, data: { nextRunAt: sched ? computeNextRun(sched, now) : null } as any }).catch(() => {})
  }
  return { ran }
}

/** The most recent trigger event for a flow that it hasn't processed yet
 *  (scoped to its app). Uses the live event feeds. Returns null if none. */
async function findLatestTriggerEvent(flow: any): Promise<{ domain: string | null; storeName: string; appId: string; occurredAt: Date } | null> {
  const appId = flow.appScope && flow.appScope !== 'all' ? String(flow.appScope) : null
  const since = flow.lastEventAt ? new Date(flow.lastEventAt) : new Date(0)

  if (flow.trigger === 'subscription_activated') {
    const c = await prisma.charge.findFirst({
      where: { kind: 'subscription', ...(appId ? { appId } : {}), occurredAt: { gt: since } },
      orderBy: { occurredAt: 'desc' },
    })
    return c ? { domain: c.shopDomain, storeName: c.shopName || c.shopDomain || '', appId: c.appId, occurredAt: c.occurredAt } : null
  }

  // install / uninstall / subscription-cancelled → the live install feed.
  const type = flow.trigger === 'customer_uninstalls' || flow.trigger === 'subscription_cancelled' ? 'uninstalled' : 'installed'
  const e = await prisma.shopifyAppEvent.findFirst({
    where: { type, ...(appId ? { appId } : {}), occurredAt: { gt: since } },
    orderBy: { occurredAt: 'desc' },
  })
  return e ? { domain: e.storeDomain, storeName: e.storeName || e.storeDomain || '', appId: e.appId, occurredAt: e.occurredAt } : null
}

/** "Run now": for event flows, run against the latest UNPROCESSED trigger event
 *  (and remember it, so re-running with no new event does nothing). Scheduled
 *  flows just run once. Returns { ran:false } when there's no new event. */
export async function runFlowNow(flowId: number): Promise<any> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } })
  if (!flow) return { error: 'flow not found' }

  if (flow.trigger === 'scheduled') {
    const ctx = await buildDigestContext(flow)
    const r = await runFlow(flow, ctx)
    await prisma.flow.update({ where: { id: flowId }, data: { lastEventAt: new Date() } as any }).catch(() => {})
    return { ran: true, scheduled: true, domain: null, status: r.status, log: r.log }
  }

  const ev = await findLatestTriggerEvent(flow)
  if (!ev) return { ran: false, trigger: flow.trigger }

  const ctx = await buildContext({ trigger: flow.trigger, appId: ev.appId, domain: ev.domain, storeName: ev.storeName, occurredAt: ev.occurredAt.toISOString() })
  const r = await runFlow(flow, ctx)
  // Remember the newest event we processed so a repeat run finds nothing new.
  await prisma.flow.update({ where: { id: flowId }, data: { lastEventAt: ev.occurredAt } as any }).catch(() => {})
  return { ran: true, domain: ev.domain, occurredAt: ev.occurredAt.toISOString(), status: r.status, log: r.log }
}

/** Drain due delayed actions. Called from the poll cron. */
export async function drainFlowTasks(limit = 50): Promise<{ processed: number; ok: number }> {
  const due = await prisma.flowTask.findMany({
    where: { status: 'pending', runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' },
    take: limit,
  })
  let ok = 0
  for (const task of due) {
    const action = task.action as { type: string; config: Record<string, any> }
    try {
      const ctx = await buildContext({ trigger: '', domain: task.domain, appId: task.appId })
      const res = await performAction(action.type, action.config || {}, ctx)
      await prisma.flowTask.update({ where: { id: task.id }, data: { status: res.ok ? 'done' : 'failed' } })
      if (res.ok) ok++
    } catch {
      await prisma.flowTask.update({ where: { id: task.id }, data: { status: 'failed' } }).catch(() => {})
    }
  }
  return { processed: due.length, ok }
}
