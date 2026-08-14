// HTTP client for each app's admin `shop-lookup` endpoint.
//
// Every one of our Shopify apps exposes the same endpoint shape:
//
//   GET <base>/v2/api/admin/shop-lookup?domain=<store>.myshopify.com
//
// returning install/uninstall dates, plan, usage duration and — where the app
// tracks it — the last user who opened the app admin. The Shopify Partner API
// exposes none of this, which is why the per-app endpoint exists at all.
//
// What VARIES per app is only the base URL and the auth scheme (some apps take
// `x-api-key`, others `Authorization: Bearer`), so config is a handful of
// fields — there is no per-app response mapping.
//
// This module is pure I/O + normalisation: it never touches Prisma and never
// throws. It is called from inside the poll cron, so a failure here must not be
// able to kill a tick.

export type FetchStatus =
  | 'ok'           // usable response
  | 'stale'        // app doesn't know about the uninstall yet — retry
  | 'not_found'    // 404 — app has no record of this shop; terminal
  | 'unauthorized' // 401/403 — bad token; terminal, needs an admin fix
  | 'failed'       // timeout / 5xx / malformed; retryable
  | 'no_endpoint'  // nothing configured for this app

/** The endpoint config fields this module needs (subset of AppDataEndpoint). */
export interface EndpointConfig {
  url: string
  authType: string
  authHeader: string | null
  authToken: string | null
  shopParam: string
  timeoutMs: number
}

export interface ShopLookup {
  shopUrl: string | null
  contactName: string | null
  contactEmail: string | null
  planType: string | null
  previousPlan: string | null
  isUninstall: boolean | null
  appStatus: number | null
  installDate: Date | null
  uninstallDate: Date | null
  durationDays: number | null
  durationText: string | null
  lastUserEmail: string | null
  lastUserName: string | null
  lastUserType: string | null
  lastAccessedAt: Date | null
  raw: unknown
}

export interface LookupResult {
  status: FetchStatus
  data: ShopLookup | null
  error?: string
  httpStatus?: number
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ── field readers ─────────────────────────────────────────────────────────
 * The contract is fixed (§2 of the plan), but we accept a small alias set per
 * field so a minor naming slip in one of the remaining apps doesn't need a code
 * change. Anything beyond this gets fixed app-side to match the contract.       */

function pick(obj: Record<string, any>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return null
}

function str(v: unknown, max = 255): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a timestamp strictly. Rejects unparseable values AND bare local
 * datetimes with no timezone ("2026-08-05 10:00:00"), which would otherwise be
 * silently read as server-local time and shift the date by up to a day.
 */
function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  // Date-only ("2026-07-14") is unambiguous — JS parses it as UTC midnight.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)
  if (!dateOnly && !hasZone) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 0/1, true/false, "1"/"0", "true"/"false" → boolean. */
function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes') return true
  if (s === '0' || s === 'false' || s === 'no') return false
  return null
}

/** Map the app's JSON body onto our canonical shape. */
export function normalizeShopLookup(body: Record<string, any>): ShopLookup {
  return {
    shopUrl:        str(pick(body, 'shop_url', 'shop', 'domain', 'shopDomain'), 255),
    contactName:    str(pick(body, 'name', 'shop_name', 'owner_name'), 255),
    contactEmail:   str(pick(body, 'email', 'shop_email', 'owner_email'), 320),
    planType:       str(pick(body, 'plan_type', 'plan', 'planName', 'plan_name'), 128),
    previousPlan:   str(pick(body, 'previous_plan_type', 'previous_plan'), 128),
    isUninstall:    bool(pick(body, 'is_uninstall', 'isUninstall', 'uninstalled')),
    appStatus:      num(pick(body, 'app_status', 'appStatus', 'status')),
    installDate:    date(pick(body, 'install_date', 'installed_at', 'installDate', 'installedAt')),
    uninstallDate:  date(pick(body, 'uninstall_date', 'uninstalled_at', 'uninstallDate', 'uninstalledAt')),
    durationDays:   num(pick(body, 'usage_duration_days', 'duration_days', 'usageDurationDays')),
    durationText:   str(pick(body, 'usage_duration_readable', 'duration_readable', 'usage_duration'), 64),
    lastUserEmail:  str(pick(body, 'last_accessed_email', 'last_user_email', 'lastAccessedEmail'), 320),
    lastUserName:   str(pick(body, 'last_accessed_user_name', 'last_user_name', 'lastAccessedUserName'), 255),
    lastUserType:   str(pick(body, 'last_accessed_user_type', 'last_user_type'), 64),
    lastAccessedAt: date(pick(body, 'last_accessed_at', 'lastAccessedAt')),
    raw:            body,
  }
}

/** Build the request URL with the shop domain appended as the configured param. */
export function buildLookupUrl(cfg: EndpointConfig, domain: string): string {
  const param = cfg.shopParam || 'domain'
  const sep = cfg.url.includes('?') ? '&' : '?'
  return `${cfg.url}${sep}${encodeURIComponent(param)}=${encodeURIComponent(domain)}`
}

/** Auth headers for the configured scheme. */
function authHeaders(cfg: EndpointConfig): Record<string, string> {
  const token = cfg.authToken || ''
  if (!token || cfg.authType === 'none') return {}
  if (cfg.authType === 'bearer') return { Authorization: `Bearer ${token}` }
  if (cfg.authType === 'header') return { [cfg.authHeader || 'x-api-key']: token }
  return {} // 'query' is folded into the URL below
}

/**
 * Look up one shop against one app's endpoint.
 *
 * Never throws — every failure mode comes back as a FetchStatus so the caller
 * (which runs inside the poll cron) can record it and move on. Transient
 * failures are retried in-process; terminal ones (401/404) are not.
 */
export async function fetchShopLookup(
  cfg: EndpointConfig,
  domain: string,
  opts: { attempts?: number } = {},
): Promise<LookupResult> {
  if (!cfg?.url) return { status: 'no_endpoint', data: null, error: 'no endpoint configured' }
  if (!domain) return { status: 'failed', data: null, error: 'no domain supplied' }

  let url = buildLookupUrl(cfg, domain)
  if (cfg.authType === 'query' && cfg.authToken) {
    const key = cfg.authHeader || 'token' // reuse authHeader as the param name
    url += `&${encodeURIComponent(key)}=${encodeURIComponent(cfg.authToken)}`
  }

  const maxAttempts = Math.max(1, opts.attempts ?? 3)
  let lastError = ''
  let lastHttp: number | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(cfg) },
        signal: AbortSignal.timeout(cfg.timeoutMs || 8000),
        redirect: 'follow',
      })
    } catch (e: any) {
      lastError = e?.name === 'TimeoutError' ? 'request timed out' : `network error: ${e?.message || 'unknown'}`
      if (attempt < maxAttempts - 1) await sleep(600 * (attempt + 1))
      continue
    }

    lastHttp = res.status

    // Terminal statuses — never retry, the outcome won't change.
    if (res.status === 401 || res.status === 403) {
      return { status: 'unauthorized', data: null, error: 'endpoint rejected the token (401/403)', httpStatus: res.status }
    }
    if (res.status === 404) {
      return { status: 'not_found', data: null, error: 'app has no record of this shop (404)', httpStatus: 404 }
    }
    if (res.status === 400) {
      return { status: 'failed', data: null, error: 'endpoint rejected the request (400) — check the shop param name', httpStatus: 400 }
    }

    if (TRANSIENT.has(res.status)) {
      lastError = `endpoint returned ${res.status}`
      if (attempt < maxAttempts - 1) await sleep(600 * (attempt + 1))
      continue
    }

    if (!res.ok) {
      return { status: 'failed', data: null, error: `endpoint returned ${res.status}`, httpStatus: res.status }
    }

    // 200 — parse and validate.
    let body: any
    const text = await res.text().catch(() => '')
    try {
      body = JSON.parse(text)
    } catch {
      return { status: 'failed', data: null, error: `non-JSON response: ${text.slice(0, 160)}`, httpStatus: res.status }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 'failed', data: null, error: 'response was not a JSON object', httpStatus: res.status }
    }

    const data = normalizeShopLookup(body)

    // The endpoint echoes the shop back; a mismatch means we'd be attributing
    // one store's data to another. Refuse rather than write the wrong record.
    if (data.shopUrl && data.shopUrl.toLowerCase() !== domain.toLowerCase()) {
      return {
        status: 'failed',
        data: null,
        error: `response is for a different shop (${data.shopUrl})`,
        httpStatus: res.status,
      }
    }

    // The app hasn't processed its own app/uninstalled webhook yet. Its install
    // date and plan are already right, so keep the data but flag for a re-fetch.
    if (data.isUninstall === false) {
      return { status: 'stale', data, error: 'app still reports the shop as installed', httpStatus: res.status }
    }

    return { status: 'ok', data, httpStatus: res.status }
  }

  return { status: 'failed', data: null, error: lastError || 'endpoint unreachable', httpStatus: lastHttp }
}
