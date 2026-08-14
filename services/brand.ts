// Who this installation says it is in outgoing email.
//
// Everything here used to be hardcoded to one company — the from-addresses,
// the sender names, and the "book a demo" link. That is fine for a single
// deployment and wrong for every other one: a fresh clone with its own Brevo
// key would mail its own merchants signed as a company it has never heard of.
//
// The from-address comes from Settings → Email and nowhere else: the row
// marked default under Email → Senders, else any sender row, else null (and
// callers skip the send — mailing a merchant from whatever address happened to
// be compiled in is worse than not mailing them).
//
// There used to be an env layer in front of that — EMAIL_FROM_ALERTS /
// EMAIL_FROM_HELLO — for installs that wanted to pin an address without
// touching the UI. It was removed because it silently won: an address pinned
// in .env kept being used no matter what anyone chose in the UI, and when that
// address was one the configured SMTP account may not send as, every message
// died at MAIL FROM with "553 Sender is not allowed to relay" while the
// settings page cheerfully showed the address someone had picked. One source
// of truth, and it is the one with a screen attached.
//
// Imports prisma only, deliberately: services/email.ts imports sendBrevo from
// services/partner-notify.ts, so anything both of them need has to sit below
// them or the cycle comes back.

import { prisma } from '@/lib/db'

export interface SenderInfo { email: string; name: string }

/** Display name for this installation — email signatures, sender names. */
export function brandName(): string {
  return (process.env.BRAND_NAME || '').trim() || 'Support'
}

/**
 * Demo/booking link for merchant-facing email, or null when unset.
 * Null means the button is omitted entirely rather than rendered dead — a
 * "Book a Free Demo" button pointing at someone else's Calendly is worse
 * than no button.
 */
export function bookingUrl(): string | null {
  const u = (process.env.BOOKING_URL || '').trim()
  return u || null
}

/** Default sender row: the one marked default, else any. */
async function dbSender(): Promise<SenderInfo | null> {
  const s = (await prisma.emailSender.findFirst({ where: { isDefault: true } }))
    ?? (await prisma.emailSender.findFirst())
  return s ? { email: s.email, name: s.name } : null
}

/**
 * From-address for internal alerts (install/uninstall notices to the team).
 *
 * Same row as the merchant sender. They were once separately pinnable through
 * env vars; now both follow the address configured in Settings → Email, and a
 * setup that genuinely wants two identities pins one per flow/campaign via
 * senderId instead, which is visible in the UI.
 */
export async function alertsSender(): Promise<SenderInfo | null> {
  return dbSender()
}

/** From-address for merchant-facing mail (welcome, campaigns, sequences). */
export async function merchantSender(): Promise<SenderInfo | null> {
  return dbSender()
}

/**
 * Address the "Unsubscribe" link in bulk email mails. Defaults to the
 * merchant-facing sender, since that is an address this installation
 * demonstrably owns; EMAIL_UNSUBSCRIBE overrides it for setups that route
 * opt-outs somewhere separate. Null only when no sender exists at all, in
 * which case callers render the notice without a link rather than point
 * recipients at an address that bounces.
 */
export async function unsubscribeAddress(): Promise<string | null> {
  const env = (process.env.EMAIL_UNSUBSCRIBE || '').trim()
  if (env) return env
  return (await merchantSender())?.email ?? null
}
