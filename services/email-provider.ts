// How mail actually leaves this installation.
//
// Two providers, one live at a time (EmailConfig.provider):
//   brevo — the HTTP API at api.brevo.com/v3/smtp/email
//   smtp  — any SMTP server, via nodemailer
//
// Everything that sends email goes through deliverEmail() so there is exactly
// one place that knows which provider is active. Callers pass a from-address
// they resolved themselves (services/brand.ts, services/email.ts) — this module
// decides the transport, never the identity.
//
// Configuration lives in the database rather than the environment so a new
// install can be finished from Settings → Email without shell access. The old
// BREVO_API_KEY env var is still honoured when no row has been saved, which is
// what lets an existing deployment upgrade without touching its .env.
//
// nodemailer is imported lazily, inside the SMTP branch only. This file is
// reachable from instrumentation.ts (flows and sequences send from cron), and a
// top-level import would pull a Node-only package into the edge bundle Next
// also builds from that entrypoint.

import { prisma } from '@/lib/db'

export type EmailProviderKind = 'brevo' | 'smtp'

export interface ResolvedEmailConfig {
  provider: EmailProviderKind
  brevoApiKey: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpSecure: boolean
  /** True when the active provider has everything it needs to send. */
  configured: boolean
  /** Where the active provider's credentials came from, for the UI to explain. */
  source: 'database' | 'env' | 'none'
}

export interface SendResult {
  ok: boolean
  /** Why it failed, verbatim from the provider where possible — this ends up in
   *  the flow run log, and "brevo 401: Key not found" is worth ten "false"s. */
  detail: string
  messageId?: string
}

const BREVO_API = 'https://api.brevo.com/v3'

/** The saved row, with the environment filling in anything it doesn't set. */
export async function getEmailConfig(): Promise<ResolvedEmailConfig> {
  let row: Awaited<ReturnType<typeof prisma.emailConfig.findUnique>> = null
  try {
    row = await prisma.emailConfig.findUnique({ where: { id: 1 } })
  } catch {
    // Table missing (migration not applied yet) — fall through to env so an
    // un-migrated deploy keeps sending instead of hard-failing every flow.
  }

  const envKey = (process.env.BREVO_API_KEY || '').trim()
  const provider: EmailProviderKind = row?.provider === 'smtp' ? 'smtp' : 'brevo'

  const brevoApiKey = (row?.brevoApiKey || '').trim() || envKey
  const smtpHost = (row?.smtpHost || '').trim()
  const smtpPort = row?.smtpPort ?? 587
  const smtpUser = (row?.smtpUser || '').trim()
  const smtpPassword = row?.smtpPassword || ''
  const smtpSecure = row?.smtpSecure ?? false

  const configured = provider === 'brevo' ? !!brevoApiKey : !!smtpHost
  const source: ResolvedEmailConfig['source'] = !configured
    ? 'none'
    : provider === 'brevo' && !row?.brevoApiKey && envKey
      ? 'env'
      : 'database'

  return { provider, brevoApiKey, smtpHost, smtpPort, smtpUser, smtpPassword, smtpSecure, configured, source }
}

/** True when a send would actually go out. The UI uses this to show the
 *  "email isn't configured" banner, and the drainers to decide whether to
 *  leave a queue untouched rather than burn through it failing. */
export async function isEmailConfigured(): Promise<boolean> {
  return (await getEmailConfig()).configured
}

/** Last 4 characters, so the UI can prove a secret is saved without showing it. */
export function maskSecret(secret: string | null | undefined): string {
  const s = (secret || '').trim()
  if (!s) return ''
  return s.length <= 4 ? '••••' : `••••••••${s.slice(-4)}`
}

// ── Sending ──────────────────────────────────────────────────────────────────

async function sendViaBrevo(
  cfg: ResolvedEmailConfig,
  to: string[],
  subject: string,
  html: string,
  fromEmail: string,
  fromName: string,
): Promise<SendResult> {
  try {
    const resp = await fetch(`${BREVO_API}/smtp/email`, {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': cfg.brevoApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: to.map((e) => ({ email: e })),
        subject,
        htmlContent: html,
      }),
    })
    if (resp.ok) {
      // Brevo returns { messageId: "<...@smtp-relay.mailin.fr>" } — the join key
      // used to match webhook open/click/bounce events back to this send.
      let messageId: string | undefined
      try {
        const j = await resp.json()
        messageId = j?.messageId || undefined
      } catch {}
      return { ok: true, detail: `sent to ${to.length}`, messageId }
    }
    const body = await resp.text().catch(() => '')
    let msg = body.slice(0, 160)
    try {
      const j = JSON.parse(body)
      msg = j.message || j.code || msg
    } catch {}
    const detail = `brevo ${resp.status}${msg ? `: ${msg}` : ''}`
    console.error('[email]', detail, '| from:', fromEmail, '| to:', to.join(','))
    return { ok: false, detail }
  } catch (e: any) {
    const detail = `brevo network error: ${e?.message || 'unknown'}`
    console.error('[email]', detail)
    return { ok: false, detail }
  }
}

async function smtpTransport(cfg: ResolvedEmailConfig) {
  const nodemailer = await import('nodemailer')
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    // `secure` means implicit TLS from the first byte (port 465). On 587 it
    // must be false, and nodemailer upgrades via STARTTLS on its own.
    secure: cfg.smtpSecure,
    // A server that wants no credentials (a local relay) must not be sent an
    // empty user, or authentication fails before the message is offered.
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPassword } : undefined,
  })
}

async function sendViaSmtp(
  cfg: ResolvedEmailConfig,
  to: string[],
  subject: string,
  html: string,
  fromEmail: string,
  fromName: string,
): Promise<SendResult> {
  try {
    const transport = await smtpTransport(cfg)
    const info = await transport.sendMail({
      from: { address: fromEmail, name: fromName },
      to: to.join(', '),
      subject,
      html,
    })
    // Some servers accept the envelope but reject individual recipients.
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      return { ok: false, detail: `smtp rejected: ${info.rejected.join(', ')}` }
    }
    return { ok: true, detail: `sent to ${to.length}`, messageId: info.messageId }
  } catch (e: any) {
    // nodemailer puts the useful part in .response (the server's reply line);
    // .message alone is often just "Invalid login".
    const detail = `smtp error: ${e?.response || e?.message || 'unknown'}`.slice(0, 200)
    console.error('[email]', detail, '| from:', fromEmail)
    return { ok: false, detail }
  }
}

/**
 * Development safety net: send everything to one address instead of the real
 * recipients.
 *
 * A dev machine points at a copy of production data, so a flow that fires by
 * accident mails real merchants from a laptop. Setting EMAIL_REDIRECT_TO makes
 * every send go to that address and nowhere else, with the intended recipients
 * moved into the subject line so a test is still readable.
 *
 * Redirecting rather than dropping is deliberate — you can only verify a
 * template renders if the message actually arrives somewhere.
 *
 * MUST be empty in production, or nobody receives their mail. It is logged on
 * every send for exactly that reason.
 */
function applyRedirect(recipients: string[], subject: string): { to: string[]; subject: string } {
  const redirect = (process.env.EMAIL_REDIRECT_TO || '').trim()
  if (!redirect) return { to: recipients, subject }
  console.log(`[email] redirect active — ${recipients.join(',')} → ${redirect}`)
  return { to: [redirect], subject: `[to: ${recipients.join(', ')}] ${subject}` }
}

/**
 * Send one message through whichever provider is active.
 *
 * Never throws: a failed send returns ok:false with a reason, because every
 * caller is either a cron job or a queue drainer where one bad address must not
 * take down the run.
 */
export async function deliverEmail(
  to: string[],
  subject: string,
  html: string,
  fromEmail: string,
  fromName: string,
): Promise<SendResult> {
  const intended = to.map((e) => (e || '').trim()).filter(Boolean)
  if (intended.length === 0) return { ok: false, detail: 'no recipients' }

  const redirected = applyRedirect(intended, subject)
  const recipients = redirected.to
  subject = redirected.subject

  const cfg = await getEmailConfig()
  if (!cfg.configured) {
    return {
      ok: false,
      detail:
        cfg.provider === 'smtp'
          ? 'SMTP is not configured — set a host under Settings → Email'
          : 'no Brevo API key — add one under Settings → Email',
    }
  }

  return cfg.provider === 'smtp'
    ? sendViaSmtp(cfg, recipients, subject, html, fromEmail, fromName)
    : sendViaBrevo(cfg, recipients, subject, html, fromEmail, fromName)
}

// ── Provider introspection ───────────────────────────────────────────────────

export interface ProviderSender {
  email: string
  name: string
  verified: boolean
}

/**
 * The from-addresses the active provider will accept.
 *
 * Brevo knows the answer and returns it from /v3/senders, so the UI can offer a
 * real dropdown instead of asking someone to retype an address they already
 * registered — and can show which ones Brevo has actually verified, since an
 * unverified sender is accepted at save time and rejected at send time.
 *
 * SMTP has no equivalent endpoint — a server sends as whatever the authenticated
 * account is allowed to, and that is not enumerable. The username is offered
 * instead: it is an address, it is the one the account is certain to be allowed
 * to send as, and having it in the dropdown beats making someone retype it.
 * Anything else (an alias, a shared mailbox) still gets added by hand under
 * Email → Senders.
 */
export async function listProviderSenders(): Promise<{ ok: boolean; senders: ProviderSender[]; error?: string }> {
  const cfg = await getEmailConfig()

  if (cfg.provider === 'smtp') {
    if (!cfg.smtpUser.includes('@')) {
      return {
        ok: false,
        senders: [],
        error: 'This SMTP account has no email address as its username, so there is nothing to list — add your from-addresses under Email → Senders.',
      }
    }
    // Unverifiable rather than unverified: SMTP has nothing to ask. Reporting
    // it as false would grey it out in the UI for no reason.
    return { ok: true, senders: [{ email: cfg.smtpUser, name: cfg.smtpUser.split('@')[0], verified: true }] }
  }
  if (!cfg.brevoApiKey) return { ok: false, senders: [], error: 'no Brevo API key saved' }

  try {
    const resp = await fetch(`${BREVO_API}/senders`, {
      headers: { accept: 'application/json', 'api-key': cfg.brevoApiKey },
      cache: 'no-store',
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      let msg = body.slice(0, 160)
      try {
        const j = JSON.parse(body)
        msg = j.message || j.code || msg
      } catch {}
      return { ok: false, senders: [], error: `brevo ${resp.status}${msg ? `: ${msg}` : ''}` }
    }
    const j = await resp.json()
    const senders: ProviderSender[] = (Array.isArray(j?.senders) ? j.senders : [])
      .filter((s: any) => s?.email)
      .map((s: any) => ({
        email: String(s.email),
        name: String(s.name || s.email),
        // Brevo reports this as `active`. Treat a missing field as verified
        // rather than not — an account with no domain restrictions omits it,
        // and flagging every sender as unverified there is just noise.
        verified: s.active !== false,
      }))
    return { ok: true, senders }
  } catch (e: any) {
    return { ok: false, senders: [], error: `brevo network error: ${e?.message || 'unknown'}` }
  }
}

/**
 * Make the configured provider's addresses available as from-addresses, without
 * anyone having to add them by hand.
 *
 * The whole point of configuring SMTP or a Brevo key is that mail goes out as
 * that account, so its address should already be in every Sender dropdown by
 * the time you look. This upserts each one into email_senders — the table the
 * flow, campaign, sequence and template pickers all read — and, when nothing is
 * marked default yet, promotes the first one so "Default sender" resolves to a
 * working address instead of whatever row happened to be created first.
 *
 * Additive on purpose: rows added by hand are left alone. An address from a
 * provider you no longer use stays until someone deletes it under
 * Email → Senders, because it may be the only record of a from-address that
 * years of sent mail was signed with.
 *
 * Never throws — it runs on the read path of a list endpoint, so a provider
 * outage must degrade to "you see the saved rows" rather than an error page.
 */
export async function syncProviderSenders(): Promise<void> {
  try {
    const live = await listProviderSenders()
    if (!live.ok) return

    for (const s of live.senders) {
      if (!s.verified) continue
      const email = s.email.trim().toLowerCase()
      if (!email) continue
      await prisma.emailSender.upsert({
        where: { email },
        create: { email: email.slice(0, 255), name: (s.name || email.split('@')[0]).slice(0, 128), verified: true },
        // Deliberately does not overwrite `name`: a display name edited here is
        // a local choice, and the provider's own label is often just the inbox.
        update: { verified: true },
      })
    }

    // Seed a default when there is none, so a fresh installation can send the
    // moment a provider is configured.
    //
    // It deliberately stops there. An address someone picked by hand is never
    // taken off them just because the provider cannot enumerate it — plenty of
    // valid setups send as an address the provider will not list (a domain-wide
    // relay, an authorised alias, a transactional host that accepts any
    // verified domain). Where the From really is one the server refuses, the
    // settings page says so and the send fails loudly, which is better than
    // silently mailing from an address nobody chose.
    const first = live.senders.find((s) => s.verified)?.email.trim().toLowerCase()
    if (first) {
      const current = await prisma.emailSender.findFirst({ where: { isDefault: true } })
      if (!current) {
        await prisma.emailSender.updateMany({ where: { email: first }, data: { isDefault: true } })
      }
    }
  } catch {
    // Provider unreachable, or email_config not migrated yet. Either way the
    // saved rows are still perfectly usable.
  }
}

/**
 * Check the saved credentials without sending anything.
 *
 * Brevo: /v3/account is the cheapest authenticated call.
 * SMTP:  nodemailer's verify() opens the connection and authenticates, which
 *        catches the usual wrong-port / wrong-password / TLS-mismatch cases.
 */
export async function testEmailProvider(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getEmailConfig()
  if (!cfg.configured) return { ok: false, detail: 'nothing configured yet' }

  if (cfg.provider === 'brevo') {
    try {
      const resp = await fetch(`${BREVO_API}/account`, {
        headers: { accept: 'application/json', 'api-key': cfg.brevoApiKey },
        cache: 'no-store',
      })
      if (resp.ok) {
        const j = await resp.json().catch(() => null)
        const who = j?.email ? ` (${j.email})` : ''
        return { ok: true, detail: `Brevo key accepted${who}` }
      }
      const body = await resp.text().catch(() => '')
      let msg = body.slice(0, 160)
      try {
        const p = JSON.parse(body)
        msg = p.message || p.code || msg
      } catch {}
      return { ok: false, detail: `brevo ${resp.status}${msg ? `: ${msg}` : ''}` }
    } catch (e: any) {
      return { ok: false, detail: `brevo network error: ${e?.message || 'unknown'}` }
    }
  }

  try {
    const transport = await smtpTransport(cfg)
    await transport.verify()
    return { ok: true, detail: `Connected to ${cfg.smtpHost}:${cfg.smtpPort}` }
  } catch (e: any) {
    return { ok: false, detail: `smtp error: ${e?.response || e?.message || 'unknown'}`.slice(0, 200) }
  }
}

/**
 * Send one real message, from the address the app would actually use.
 *
 * testEmailProvider() above only authenticates. That is not enough: a server
 * accepts the login and *then* refuses the envelope, which is what
 * "553 Sender is not allowed to relay" is. Only a real send exercises the
 * From — so this is the check that reproduces a failing install alert without
 * waiting for an install.
 *
 * Goes through deliverEmail() rather than talking to the transport directly,
 * so it is the same code path, the same sender resolution, and the same
 * EMAIL_REDIRECT_TO behaviour as every other email the app sends.
 */
export async function sendProviderTestEmail(to: string): Promise<{ ok: boolean; detail: string }> {
  const address = (to || '').trim()
  if (!/.+@.+\..+/.test(address)) return { ok: false, detail: 'a valid recipient address is required' }

  // The alerts identity, because install/uninstall mail is what people are
  // debugging when they press this — the same default sender every other
  // message uses.
  const { alertsSender } = await import('@/services/brand')
  const sender = await alertsSender()
  if (!sender) return { ok: false, detail: 'no default from-address set — pick one above first' }

  const cfg = await getEmailConfig()
  const via = cfg.provider === 'smtp' ? `${cfg.smtpHost}:${cfg.smtpPort} as ${cfg.smtpUser}` : 'the Brevo API'
  const html = `<p>This is a test from your dashboard's email settings.</p>
<p style="color:#6b7280;font-size:12px">Sent from <strong>${sender.name} &lt;${sender.email}&gt;</strong> via ${via}.
If this arrived, install and uninstall alerts will send too.</p>`

  const r = await deliverEmail([address], 'Dashboard email test', html, sender.email, sender.name)
  return {
    ok: r.ok,
    // On success name the From, because "it worked" is only useful alongside
    // which identity it worked as.
    detail: r.ok ? `Sent to ${address} from ${sender.email}` : (r.detail || 'send failed'),
  }
}
