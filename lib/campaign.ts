// Shared campaign helpers used by BOTH the Campaign UI (client) and the send
// service (server). Client-safe: no prisma, no node imports.

import { MERGE_TAGS } from '@/lib/email-html'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isValidEmail = (v: unknown): boolean => EMAIL_RE.test(String(v || '').trim())

// Merge tags a campaign can fill from sheet columns. Includes every template
// merge tag plus a couple campaign-only extras.
export const CAMPAIGN_MERGE_TAGS = Array.from(new Set([...MERGE_TAGS, 'unsubscribe'])) as string[]

/** Guess which header holds the email address (email / e-mail / mail / …). */
export function detectEmailColumn(headers: string[]): string | null {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')
  const exact = headers.find((h) => ['email', 'emailaddress', 'mail', 'e', 'emailid'].includes(norm(h)))
  if (exact) return exact
  const contains = headers.find((h) => norm(h).includes('email') || norm(h).includes('mail'))
  return contains || null
}

/** Auto-map template merge tags to same-named sheet columns (case-insensitive).
 *  e.g. a "Name" column maps to {{name}}. User can override in the UI. */
export function autoVarMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const byNorm = new Map(headers.map((h) => [h.toLowerCase().replace(/[^a-z]/g, ''), h]))
  for (const tag of CAMPAIGN_MERGE_TAGS) {
    const hit = byNorm.get(tag.toLowerCase())
    if (hit) map[tag] = hit
  }
  return map
}

/**
 * Build the per-recipient merge variables for one row. Every sheet column is
 * exposed under its own header name ({{ColumnName}}), the mapped merge tags are
 * filled from their columns ({{name}} etc.), and `email` is always set.
 */
export function buildRecipientVars(
  row: Record<string, any>,
  varMap: Record<string, string> | null | undefined,
  email: string,
): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, val] of Object.entries(row || {})) vars[k] = String(val ?? '')
  for (const [tag, col] of Object.entries(varMap || {})) {
    if (col && col in (row || {})) vars[tag] = String((row as any)[col] ?? '')
  }
  vars.email = email
  return vars
}

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'scheduled' | 'paused' | 'cancelled'
export type RecipientStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
