// Shared install/uninstall notification logic: persists an event to the
// ShopifyAppEvent table (idempotent, for live counts) and sends the Brevo
// welcome + alert emails. Used by BOTH the inbound webhook route
// (/api/partner-webhook) and the token-based event poller
// (services/partner-event-poller.ts), so the two paths behave identically.

import { prisma } from '@/lib/db'
import { alertsSender, merchantSender, brandName, bookingUrl } from '@/services/brand'
import { appInfo, resolvePartnerId } from '@/services/app-catalog'
import { deliverEmail } from '@/services/email-provider'
import { formatDateTime } from '@/lib/tz'
import { getNotifyRecipients } from '@/services/notify-recipients'

// Kept as a re-export: callers imported it from here before it moved.
export { resolvePartnerId }

/**
 * Name + organisation for an app, for email subjects and alert bodies.
 *
 * This was a hardcoded twelve-entry map of one company's app IDs, consulted
 * as a fallback when the DB lookup missed. The map is gone — the ShopifyApp
 * row is the only source now, and an unknown ID renders as "App <id>".
 */
export async function appInfoForAsync(appId: string): Promise<{ name: string; org: string }> {
  const { name, org } = await appInfo(appId)
  return { name, org }
}

// Record one install/uninstall event for live counting. Idempotent on retries
// via a deterministic event_key. Returns true if this was a NEW row (i.e. the
// event had not been seen before), false if it already existed.
export async function persistAppEvent(
  type: 'installed' | 'uninstalled',
  appId: string,
  storeDomain: string,
  storeName: string,
  occurredAtIso: string,
  source: 'webhook' | 'poller' | 'seed' = 'poller',
): Promise<boolean> {
  if (!appId) return false
  const partnerId = await resolvePartnerId(appId)
  const occurredAt = new Date(occurredAtIso)
  const eventKey = `${type}:${appId}:${storeDomain || '-'}:${occurredAt.toISOString()}`
  const existing = await prisma.shopifyAppEvent.findUnique({ where: { eventKey }, select: { id: true } })
  if (existing) return false
  try {
    await prisma.shopifyAppEvent.create({
      data: {
        eventKey,
        partnerId,
        appId,
        type,
        storeDomain: storeDomain || null,
        storeName: storeName || null,
        occurredAt,
        source,
      },
    })
    return true
  } catch {
    // Unique-constraint race: another delivery inserted it first.
    return false
  }
}

const PREFERRED_PREFIXES = ['care@', 'support@', 'info@', 'hello@', 'contact@', 'help@', 'admin@', 'sales@']
const JUNK_HINTS = ['example.com', 'sentry.io', 'noreply', '.png', '.jpg', '.svg', '.js']

/**
 * Domains never accepted as a merchant's contact address when scraping their
 * storefront. Platform and freemail domains, plus this installation's own —
 * a storefront running our app often has our support address in the page, and
 * picking it would make us mail ourselves instead of the merchant.
 */
async function excludedDomains(): Promise<string[]> {
  // Our own domains are whatever we send as — the sender rows from
  // Settings → Email, since the env vars that used to name them are gone.
  const rows = await prisma.emailSender.findMany({ select: { email: true } })
  const own = rows
    .map((r) => r.email.split('@').pop()?.toLowerCase().trim() || '')
    .filter(Boolean)
  return ['shopify.com', 'gmail.com', 'github.com', ...own]
}

/** Send and return WHY it failed (status + message) instead of a bare boolean,
 *  so failures are diagnosable in the flow run log and the pm2 logs.
 *
 *  The transport — Brevo API or SMTP — is chosen by services/email-provider.ts
 *  from what is saved under Settings → Email. The name is kept for the dozen
 *  call sites that predate SMTP support; only the delivery path moved. */
export async function sendBrevoDetailed(
  to: string[],
  subject: string,
  html: string,
  sender: string,
  senderName: string,
): Promise<{ ok: boolean; detail: string; messageId?: string }> {
  return deliverEmail(to, subject, html, sender, senderName)
}

export async function sendBrevo(
  to: string[],
  subject: string,
  html: string,
  sender: string,
  senderName: string,
): Promise<boolean> {
  return (await sendBrevoDetailed(to, subject, html, sender, senderName)).ok
}

export async function fetchStoreEmail(domain: string): Promise<string> {
  const urls = [
    `https://${domain}`,
    `https://${domain}/policies/contact-information`,
    `https://${domain}/policies/privacy-policy`,
    `https://${domain}/pages/contact`,
  ]
  const found = new Set<string>()
  const excluded = await excludedDomains()
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: ctrl.signal,
        redirect: 'follow',
      })
      clearTimeout(t)
      if (!resp.ok) continue
      const text = await resp.text()
      const matches = text.match(emailRe) || []
      for (let e of matches) {
        const lc = e.toLowerCase()
        if (JUNK_HINTS.some((h) => lc.includes(h))) continue
        if (lc.startsWith('u003e')) e = e.slice(5)
        const emailDomain = e.split('@').pop()?.toLowerCase() || ''
        if (excluded.includes(emailDomain)) continue
        found.add(e)
      }
    } catch { continue }
  }
  if (found.size === 0) return ''
  const preferred = Array.from(found).filter((e) => PREFERRED_PREFIXES.some((p) => e.toLowerCase().startsWith(p)))
  return (preferred.sort((a, b) => a.length - b.length)[0] || Array.from(found).sort((a, b) => a.length - b.length)[0]) || ''
}

function installAlertHtml(appName: string, org: string, storeName: string, storeUrl: string, email: string, welcomeStatus: string, time: string) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#ecfdf5;border:2px solid #059669;border-radius:12px;padding:20px;margin-bottom:20px">
    <h2 style="color:#059669;margin:0 0 4px">New App Install</h2>
    <p style="color:#6b7280;margin:0;font-size:12px">${time}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold;width:140px">App Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${appName}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Organisation</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${org}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${storeName}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store URL</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb"><a href="https://${storeUrl}" style="color:#1d4ed8">${storeUrl}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Email</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${email || '<span style="color:#9ca3af">Not available</span>'}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Welcome Email</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${welcomeStatus}</td></tr>
  </table>
  ${bookingUrl() ? `<div style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0">
    <h3 style="color:#1e40af;margin:0 0 8px;font-size:15px">Action: Send Demo Invitation</h3>
    <div style="text-align:center">
      <a href="${bookingUrl()}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:13px">Book a Demo</a>
    </div>
  </div>` : ''}
  <p style="color:#6b7280;font-size:11px">Instant alert · Shopify Partner API</p>
</body></html>`
}

function uninstallAlertHtml(appName: string, org: string, storeName: string, storeUrl: string, time: string) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:20px">
    <h2 style="color:#dc2626;margin:0 0 4px">App Uninstalled</h2>
    <p style="color:#6b7280;margin:0;font-size:12px">${time}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold;width:140px">App Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${appName}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Organisation</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${org}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${storeName}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store URL</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb"><a href="https://${storeUrl}" style="color:#1d4ed8">${storeUrl}</a></td></tr>
  </table>
  <p style="color:#6b7280;font-size:11px">Instant alert · Shopify Partner API</p>
</body></html>`
}

function welcomeHtml(appName: string) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:20px">
<p>Hello,</p>
<p>Welcome onboard! We are excited to have you with us.</p>
<p>Thank you for choosing our <b>${appName}</b>. To help you get started smoothly and make the most of all available features, we would be happy to walk you through a quick demo of the setup and functionality.</p>
${bookingUrl() ? `<p style="margin:24px 0">
  <a href="${bookingUrl()}" style="background:#1d4ed8;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Book a Free Demo</a>
</p>` : ''}
<p>Best regards,<br>${brandName()}<br>Shopify App Partner</p>
</body></html>`
}

// Kept as a named wrapper because the call sites read better than the import.
function istTime(occurredAtIso: string): string {
  return formatDateTime(occurredAtIso)
}

// Who gets the internal alerts. Managed under Email → Settings, not in .env —
// see services/notify-recipients.ts.
const EMAIL_TO = () => getNotifyRecipients()

export interface NotifyResult { emailFound?: boolean; welcomeSent?: boolean; alertSent: boolean }

// Built-in per-event alert emails (the automatic "New Install —" / "Uninstall —"
// mails to the team, plus the merchant welcome mail). TEMPORARILY DISABLED at the
// user's request (2026-07-06): these fire on every install/uninstall regardless of
// Flows and were noisy during testing. The full implementation below is kept
// intact — to bring them back, set BUILTIN_APP_ALERTS_ENABLED=true (or delete this
// guard). Flow-driven emails are unaffected.
const builtinAlertsEnabled = () => process.env.BUILTIN_APP_ALERTS_ENABLED === 'true'

/** Send the store welcome email (if an email can be found) + the internal
 *  install alert. Does NOT persist — caller persists separately. */
export async function sendInstallEmails(appId: string, storeDomain: string, storeName: string, occurredAtIso: string): Promise<NotifyResult> {
  if (!builtinAlertsEnabled()) return { emailFound: false, welcomeSent: false, alertSent: false }
  const info = await appInfoForAsync(appId)
  const time = istTime(occurredAtIso)
  const email = storeDomain ? await fetchStoreEmail(storeDomain) : ''
  let welcomeStatus = '<span style="color:#9ca3af">Skipped — store email not available</span>'
  let welcomeSent = false
  const hello = await merchantSender()
  if (email && !hello) {
    welcomeStatus = '<span style="color:#dc2626">Skipped — no sender configured</span>'
  } else if (email && hello) {
    const subject = bookingUrl()
      ? `Welcome to ${info.name} - Book a Free Demo`
      : `Welcome to ${info.name}`
    welcomeSent = await sendBrevo([email], subject, welcomeHtml(info.name), hello.email, hello.name)
    welcomeStatus = welcomeSent
      ? `<span style="color:#059669;font-weight:bold">Sent</span> to ${email}`
      : `<span style="color:#dc2626">Failed</span> — Brevo error`
  }
  const alerts = await alertsSender()
  const alertSent = alerts ? await sendBrevo(await EMAIL_TO(),
    `New Install — ${info.name} — ${storeName}`,
    installAlertHtml(info.name, info.org, storeName, storeDomain, email, welcomeStatus, time),
    alerts.email, alerts.name) : false
  return { emailFound: !!email, welcomeSent, alertSent }
}

/** Send the internal uninstall alert. Does NOT persist. */
export async function sendUninstallEmails(appId: string, storeDomain: string, storeName: string, occurredAtIso: string): Promise<NotifyResult> {
  if (!builtinAlertsEnabled()) return { alertSent: false }
  const info = await appInfoForAsync(appId)
  const time = istTime(occurredAtIso)
  const alerts = await alertsSender()
  const alertSent = alerts ? await sendBrevo(await EMAIL_TO(),
    `Uninstall — ${info.name} — ${storeName}`,
    uninstallAlertHtml(info.name, info.org, storeName, storeDomain, time),
    alerts.email, alerts.name) : false
  return { alertSent }
}
