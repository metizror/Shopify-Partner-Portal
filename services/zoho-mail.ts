// Minimal Zoho Mail API client — just enough to poll the inbox for replies.
//
// Auth uses a Zoho "Self Client" OAuth app (server-to-server), so no interactive
// login: you generate a long-lived refresh_token once and set it as an env var.
// See services/sequence-replies.ts for how this is used.
//
// Required env (all must be set for polling to run — otherwise it no-ops):
//   ZOHO_CLIENT_ID       — from the Self Client in api-console.zoho.com
//   ZOHO_CLIENT_SECRET   — same
//   ZOHO_REFRESH_TOKEN   — generated once with scope ZohoMail.messages.READ
// Optional:
//   ZOHO_ACCOUNT_ID      — skip auto-discovery of the mailbox account id
//   ZOHO_ACCOUNTS_HOST    — default https://accounts.zoho.com (use .in/.eu for that region)
//   ZOHO_MAIL_HOST        — default https://mail.zoho.com   (use .in/.eu for that region)

import { prisma } from '@/lib/db'

export function zohoConfigured(): boolean {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN)
}

const accountsHost = () => (process.env.ZOHO_ACCOUNTS_HOST || 'https://accounts.zoho.com').replace(/\/$/, '')
const mailHost = () => (process.env.ZOHO_MAIL_HOST || 'https://mail.zoho.com').replace(/\/$/, '')

/** Exchange the refresh token for an access token, cached in State until it
 *  nears expiry (Zoho access tokens live ~1h). */
async function getAccessToken(): Promise<string | null> {
  const now = Date.now()
  const cached = await prisma.state.findUnique({ where: { id: 'zoho_oauth' } })
  const cv = cached?.value as any
  if (cv?.accessToken && typeof cv.expiresAt === 'number' && cv.expiresAt > now + 60_000) return cv.accessToken

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    client_id: process.env.ZOHO_CLIENT_ID || '',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  })
  const res = await fetch(`${accountsHost()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const j: any = await res.json().catch(() => ({}))
  if (!j?.access_token) {
    console.error('[zoho] token refresh failed:', JSON.stringify(j).slice(0, 200))
    return null
  }
  const expiresAt = now + (Number(j.expires_in) ? Number(j.expires_in) * 1000 : 3600_000)
  const value = { accessToken: j.access_token, expiresAt }
  await prisma.state.upsert({ where: { id: 'zoho_oauth' }, create: { id: 'zoho_oauth', value }, update: { value } })
  return j.access_token
}

/** Resolve + cache { accountId, inboxFolderId } for the mailbox. */
async function getMeta(token: string): Promise<{ accountId: string; inboxFolderId: string } | null> {
  const cached = await prisma.state.findUnique({ where: { id: 'zoho_mail_meta' } })
  const cv = cached?.value as any
  if (cv?.accountId && cv?.inboxFolderId) return cv

  const auth = { Authorization: `Zoho-oauthtoken ${token}` }

  let accountId = process.env.ZOHO_ACCOUNT_ID || ''
  if (!accountId) {
    const r = await fetch(`${mailHost()}/api/accounts`, { headers: auth })
    const j: any = await r.json().catch(() => ({}))
    accountId = String(j?.data?.[0]?.accountId || '')
  }
  if (!accountId) { console.error('[zoho] could not resolve accountId'); return null }

  const fr = await fetch(`${mailHost()}/api/accounts/${accountId}/folders`, { headers: auth })
  const fj: any = await fr.json().catch(() => ({}))
  const folders: any[] = Array.isArray(fj?.data) ? fj.data : []
  const inbox = folders.find((f) => String(f.folderName || '').toLowerCase() === 'inbox' || String(f.path || '') === '/Inbox')
  const inboxFolderId = String(inbox?.folderId || '')
  if (!inboxFolderId) { console.error('[zoho] could not resolve Inbox folderId'); return null }

  const value = { accountId, inboxFolderId }
  await prisma.state.upsert({ where: { id: 'zoho_mail_meta' }, create: { id: 'zoho_mail_meta', value }, update: { value } })
  return value
}

export interface InboxMessage {
  from: string // lowercased sender email
  receivedTime: number // epoch ms
  subject: string
}

const EMAIL_RE = /<([^>]+)>/

function extractEmail(raw: string): string {
  const s = String(raw || '').trim()
  const m = s.match(EMAIL_RE)
  return (m ? m[1] : s).trim().toLowerCase()
}

/** List the most recent inbox messages (newest first). Caller filters by time. */
export async function listRecentInbox(limit = 50): Promise<InboxMessage[]> {
  if (!zohoConfigured()) return []
  const token = await getAccessToken()
  if (!token) return []
  const meta = await getMeta(token)
  if (!meta) return []

  const url = `${mailHost()}/api/accounts/${meta.accountId}/messages/view?folderId=${meta.inboxFolderId}&limit=${limit}`
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } })
  if (!r.ok) { console.error('[zoho] list messages failed:', r.status); return [] }
  const j: any = await r.json().catch(() => ({}))
  const rows: any[] = Array.isArray(j?.data) ? j.data : []
  return rows
    .map((m) => ({
      from: extractEmail(m.fromAddress || m.sender || ''),
      receivedTime: Number(m.receivedTime || 0),
      subject: String(m.subject || ''),
    }))
    .filter((m) => m.from)
}
