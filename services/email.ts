// Email rendering: turns an EmailTemplate (+ optional layout) and a set of merge
// variables into a ready-to-send { subject, html }, and resolves the from-sender.
// Shared by the Email "send test" endpoint and the Flow "Send email" action.

import { prisma } from '@/lib/db'
import { sendBrevo } from '@/services/partner-notify'
import { applyVars, composeEmailHtml } from '@/lib/email-html'
import { merchantSender, type SenderInfo } from '@/services/brand'

// applyVars / SAMPLE_VARS now live in lib/email-html.ts so the Preview pane can
// import them too — re-exported here so existing importers keep working.
export { applyVars, SAMPLE_VARS } from '@/lib/email-html'

export interface RenderedEmail { subject: string; html: string }

/** Render a template (wrapped in its layout, with vars applied). Uses the same
 *  composeEmailHtml() the Preview pane uses — preview === what we actually send. */
export async function renderEmailTemplate(
  templateId: number,
  vars: Record<string, string> = {},
): Promise<RenderedEmail | null> {
  const t = await prisma.emailTemplate.findUnique({ where: { id: templateId } })
  if (!t) return null
  let header = ''
  let footer = ''
  if (t.layoutId) {
    const layout = await prisma.emailLayout.findUnique({ where: { id: t.layoutId } })
    if (layout) { header = layout.headerHtml; footer = layout.footerHtml }
  }
  return {
    subject: applyVars(t.subject, vars),
    html: composeEmailHtml({ header, body: t.bodyHtml, footer, vars }),
  }
}

export type { SenderInfo } from '@/services/brand'

/**
 * Resolve the from-address for a merchant-facing send: the sender explicitly
 * picked on the campaign/sequence/flow step, else whatever this installation
 * is configured to send as (services/brand.ts).
 *
 * Returns null when nothing is configured, and callers must then skip the
 * send — there is no safe default address to fall back to. Add one under
 * Email → Senders.
 */
export async function resolveSender(senderId?: number | null): Promise<SenderInfo | null> {
  if (senderId) {
    const picked = await prisma.emailSender.findUnique({ where: { id: senderId } })
    if (picked) return { email: picked.email, name: picked.name }
  }
  return merchantSender()
}

/** Message shown when a send is skipped for want of a configured sender. */
export const NO_SENDER = 'no sender configured — add one under Email → Senders'

/** Render + send a template to one address (the Email "Send test" button). */
export async function sendTemplateEmail(
  templateId: number,
  to: string,
  vars: Record<string, string> = {},
  senderId?: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const rendered = await renderEmailTemplate(templateId, vars)
  if (!rendered) return { ok: false, error: 'template not found' }
  const sender = await resolveSender(senderId)
  if (!sender) return { ok: false, error: NO_SENDER }
  const ok = await sendBrevo([to], rendered.subject, rendered.html, sender.email, sender.name)
  return { ok, error: ok ? undefined : 'send failed (check BREVO_API_KEY / verified sender)' }
}

// Moved to its own module so partner-notify.ts can read the list without
// importing this file (which imports partner-notify). Re-exported because the
// existing call sites read better as "from @/services/email".
export { getNotifyRecipients, setNotifyRecipients } from '@/services/notify-recipients'

