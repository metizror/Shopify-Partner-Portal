// Shared catalog of flow triggers / actions / conditions. Imported by BOTH the
// builder UI (client) and the engine (server), so it must stay free of any
// server-only imports (no prisma, no node APIs).

export interface FieldDef { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'richtext' }

// The merge tags usable in flow email/message bodies (and the rich-text editor's
// "Insert variable" menu). Single source of truth for the placeholder hints too.
//
// `group: 'uninstall'` tags are filled from the app's own shop-lookup API when a
// store uninstalls (services/uninstall-enrichment.ts). They only carry a value
// on uninstall flows, and render as '' everywhere else — safe to leave in a
// shared template.
export interface PlaceholderDef { key: string; label: string; group?: 'uninstall' }

export const FLOW_PLACEHOLDERS: PlaceholderDef[] = [
  { key: 'name', label: 'Store name' },
  { key: 'app', label: 'App' },
  { key: 'domain', label: 'Store domain' },
  { key: 'country', label: 'Country' },
  { key: 'plan', label: 'Plan' },
  { key: 'mrr', label: 'MRR' },
  { key: 'email', label: 'Merchant email' },

  // ── Uninstall details ────────────────────────────────────────────────────
  { key: 'install_date', label: 'Install date', group: 'uninstall' },
  { key: 'uninstall_date', label: 'Uninstall date', group: 'uninstall' },
  { key: 'usage_duration', label: 'Duration used', group: 'uninstall' },
  { key: 'usage_duration_days', label: 'Duration (days)', group: 'uninstall' },
  { key: 'previous_plan', label: 'Previous plan', group: 'uninstall' },
  // The Shopify uninstall survey. Optional for the merchant, so both are often
  // blank — never open a sentence with one.
  { key: 'uninstall_reason', label: 'Uninstall reason', group: 'uninstall' },
  { key: 'uninstall_reason_detail', label: 'Uninstall reason (details)', group: 'uninstall' },
  // The real last person to open the app admin. Blank unless the app tracks it.
  { key: 'last_user_email', label: 'Last app user email', group: 'uninstall' },
  { key: 'last_user_name', label: 'Last app user name', group: 'uninstall' },
  { key: 'last_user_at', label: 'Last accessed at', group: 'uninstall' },
  // The store's contact address — NOT the last app user. Kept separate on
  // purpose so the two are never confused in an email.
  { key: 'shop_contact_email', label: 'Store contact email', group: 'uninstall' },
  { key: 'shop_contact_name', label: 'Store contact name', group: 'uninstall' },
]

/** Merge tags that only resolve on uninstall flows. */
export const UNINSTALL_PLACEHOLDERS = FLOW_PLACEHOLDERS.filter((p) => p.group === 'uninstall')
/** Merge tags available on every trigger. */
export const COMMON_PLACEHOLDERS = FLOW_PLACEHOLDERS.filter((p) => !p.group)

export interface TriggerDef { type: string; label: string; desc: string }
export const TRIGGERS: TriggerDef[] = [
  // No 'customer_reinstalls': a returning store is still an install, and it fired
  // customer_installs too — so a reinstall flow only ever meant a SECOND email on
  // top of the install one. Reinstalls now just run the install flow.
  { type: 'customer_installs', label: 'Customer installs app', desc: 'Triggers when a customer installs (or reinstalls) your app' },
  { type: 'customer_uninstalls', label: 'Customer uninstalls app', desc: 'Triggers when a customer uninstalls your app' },
  { type: 'subscription_activated', label: 'Subscription activated', desc: 'Triggers when a subscription is activated' },
  { type: 'subscription_cancelled', label: 'Subscription cancelled', desc: 'Triggers when a subscription is cancelled' },
  { type: 'scheduled', label: 'Scheduled', desc: 'Runs on a timer — once per scheduled run' },
]

export interface Schedule { freq: 'hourly' | 'daily' | 'weekly'; hour?: number; minute?: number; weekday?: number }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

/** Human summary of a schedule, e.g. "Daily at 09:00 IST". */
export function scheduleLabel(s?: Schedule | null): string {
  if (!s) return 'Not scheduled'
  const t = `${pad(s.hour ?? 9)}:${pad(s.minute ?? 0)} IST`
  if (s.freq === 'hourly') return 'Every hour'
  if (s.freq === 'weekly') return `Weekly · ${WEEKDAYS[s.weekday ?? 1]} at ${t}`
  return `Daily at ${t}`
}

export interface ActionDef { type: string; label: string; desc: string; fields: FieldDef[]; hasDelay?: boolean }
export const ACTIONS: ActionDef[] = [
  { type: 'add_custom_field', label: 'Add Custom Field', desc: 'Action: set a custom field value',
    fields: [{ key: 'field', label: 'Field label', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }] },
  { type: 'add_tag', label: 'Add tag', desc: 'Action: add a tag to the customer',
    fields: [{ key: 'tag', label: 'Tag', type: 'text' }] },
  { type: 'add_timeline_comment', label: 'Add Timeline Comment', desc: 'Action: post a note to the timeline',
    fields: [{ key: 'comment', label: 'Comment', type: 'textarea' }] },
  { type: 'assign_account_owner', label: 'Assign Account Owner', desc: 'Action: set the account owner',
    fields: [{ key: 'owner', label: 'Owner name', type: 'text' }] },
  { type: 'create_task', label: 'Create task', desc: 'Action: create a task assigned to a user',
    fields: [{ key: 'title', label: 'Task title', type: 'text' }, { key: 'assignee', label: 'Assignee', type: 'text' }] },
  { type: 'remove_tag', label: 'Remove tag', desc: 'Action: remove a tag from the customer',
    fields: [{ key: 'tag', label: 'Tag', type: 'text' }] },
  // Body is a rich-text editor (same as the team notification's message), so the
  // merge-tag dropdown is available. The engine accepts both HTML and the plain
  // text older flows stored — see performAction('send_email').
  { type: 'send_email', label: 'Send email', desc: 'Action: send an email to the customer',
    fields: [{ key: 'subject', label: 'Subject', type: 'text' }, { key: 'body', label: 'Body', type: 'richtext' }], hasDelay: true },
  { type: 'send_team_notification', label: 'Send team notification', desc: 'Action: email your team',
    fields: [{ key: 'subject', label: 'Subject', type: 'text' }, { key: 'message', label: 'Message', type: 'richtext' }], hasDelay: true },
]

export interface ConditionFieldDef { key: string; label: string; numeric?: boolean }
export const CONDITION_FIELDS: ConditionFieldDef[] = [
  { key: 'country', label: 'Country' },
  { key: 'plan', label: 'Plan' },
  { key: 'mrr', label: 'MRR', numeric: true },
  { key: 'ltv', label: 'LTV', numeric: true },
  { key: 'tag', label: 'Tag' },
  { key: 'appId', label: 'App' },
]
export const CONDITION_OPS = [
  { op: 'eq', label: 'is' },
  { op: 'neq', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'gt', label: 'greater than' },
  { op: 'lt', label: 'less than' },
]

export const DELAY_UNITS = ['minutes', 'hours', 'days'] as const
export type DelayUnit = (typeof DELAY_UNITS)[number]

// A single step in a flow's `steps` array.
export interface FlowStep {
  id: string
  kind: 'condition' | 'action'
  type: string
  config: Record<string, any>
}

// Prebuilt starter flows shown on the Templates page. `steps` matches Flow.steps.
export interface FlowTemplate {
  id: string
  name: string
  category: 'onboarding' | 'engagement' | 'internal'
  trigger: string
  steps: FlowStep[]
}
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'welcome_mail',
    name: 'Welcome mail',
    category: 'onboarding',
    trigger: 'customer_installs',
    steps: [
      { id: 's1', kind: 'action', type: 'add_tag', config: { tag: 'new-customer' } },
      { id: 's2', kind: 'action', type: 'send_email', config: { subject: 'Welcome to {{app}}!', body: 'Hi {{name}},\n\nThanks for installing {{app}}. We are here if you need anything.', delay: { value: 0, unit: 'hours' } } },
    ],
  },
  {
    id: 'feedback_request',
    name: 'Customer feedback request',
    category: 'engagement',
    trigger: 'customer_installs',
    steps: [
      { id: 's1', kind: 'action', type: 'send_email', config: { subject: 'How is {{app}} working for you?', body: 'Hi {{name}},\n\nWe would love your feedback on {{app}}.', delay: { value: 3, unit: 'days' } } },
      { id: 's2', kind: 'action', type: 'add_timeline_comment', config: { comment: 'Feedback request email sent.' } },
    ],
  },
  {
    id: 'team_notification',
    name: 'Churn alert',
    category: 'internal',
    trigger: 'customer_uninstalls',
    steps: [
      { id: 's1', kind: 'condition', type: 'if', config: { match: 'all', rules: [{ field: 'mrr', op: 'gt', value: 0 }] } },
      { id: 's2', kind: 'action', type: 'send_team_notification', config: { message: 'Paying customer {{name}} ({{domain}}) uninstalled {{app}}.' } },
      { id: 's3', kind: 'action', type: 'create_task', config: { title: 'Win-back outreach: {{name}}', assignee: '' } },
    ],
  },
  {
    id: 'daily_digest',
    name: 'Daily install / uninstall digest',
    category: 'internal',
    trigger: 'scheduled',
    steps: [
      {
        id: 's1', kind: 'action', type: 'send_email',
        config: {
          sendTo: 'recipients',
          subject: 'App activity — {{installs}} installs, {{uninstalls}} uninstalls',
          body: '<p>Activity {{period}}:</p><p>🟢 <b>{{installs}}</b> installs · 🔴 <b>{{uninstalls}}</b> uninstalls · net <b>{{net}}</b></p>{{summary}}',
        },
      },
    ],
  },
]

export const triggerLabel = (t: string) => TRIGGERS.find((x) => x.type === t)?.label || t
export const actionLabel = (t: string) => ACTIONS.find((x) => x.type === t)?.label || t
export const actionDef = (t: string) => ACTIONS.find((x) => x.type === t)

/* ── Built-in event email templates ────────────────────────────────────────────
 * Install / uninstall flows send our standard styled alert template (the same
 * green/red card used by the built-in alerts) — chosen automatically from the
 * trigger, so there's nothing to write or select. See services/email-templates.ts
 * for the actual HTML. Other triggers (scheduled, subscription) use a custom
 * subject/body the user writes. */
export type EventEmailKind = 'install' | 'uninstall'
export const EVENT_EMAIL_LABEL: Record<EventEmailKind, string> = {
  install: 'Install notification',
  uninstall: 'Uninstall notification',
}
/** Which built-in email template a flow trigger maps to, or null if it needs a
 *  custom email (scheduled digests, subscription events, etc.). */
export const eventEmailKind = (trigger: string | null | undefined): EventEmailKind | null => {
  if (trigger === 'customer_uninstalls') return 'uninstall'
  if (trigger === 'customer_installs') return 'install'
  return null
}
