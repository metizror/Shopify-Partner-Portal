// Cookie-based scraper for the Shopify Partner Dashboard's internal GraphQL
// endpoint. Pulls per-app install/uninstall events without an API token —
// only the session cookies stored in the partner_cookies table.
//
// Schema notes (discovered via introspection on /api/graphql):
//   Query.app(id: ID!) { title events(first, after, appEventTypes) { edges { node { eventName eventType date shopId shopName details free } pageInfo { hasNextPage endCursor } } }
//   Query.app(id: ID!) { currentInstalls totalNetInstalls }
//
// eventType values seen in the wild:
//   "installed", "uninstalled", "reactivated", "deactivated",
//   "recurring_charge_activated", "recurring_charge_frozen",
//   "recurring_charge_unfrozen", "subscription_charge_activated"
//
// Date format: "May 5, 2026 at 6:11 pm" — must be parsed.

import { partnersWithApps } from '@/services/app-catalog'
import { partnerCookieHeader, checkCookieExpiry } from '@/services/partner-cookies'
import { prisma } from '@/lib/db'
import { istDay, trendFromMap, type TrendPoint } from '@/services/shopify-partner'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0'
const PARTNER_GRAPHQL_PATH = '/api/graphql'

// ── HTTP helpers ──────────────────────────────────────────────────────────

interface GqlContext {
  cookieHeader: string
}

async function fetchCsrfToken(orgId: string, ctx: GqlContext): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(`https://partners.shopify.com/${orgId}/apps`, {
      headers: {
        'User-Agent': UA,
        Cookie: ctx.cookieHeader,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    if (res.url.toLowerCase().includes('login') || res.url.includes('accounts.shopify.com')) {
      throw new Error('PARTNER_COOKIES_EXPIRED')
    }
    const html = await res.text()
    const m = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/)
    if (!m) throw new Error('CSRF token not found in page HTML')
    return m[1]
  } finally {
    clearTimeout(t)
  }
}

async function gql<T = any>(
  orgId: string,
  ctx: GqlContext,
  csrf: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(`https://partners.shopify.com/${orgId}${PARTNER_GRAPHQL_PATH}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: ctx.cookieHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://partners.shopify.com',
        Referer: `https://partners.shopify.com/${orgId}/apps`,
        'X-CSRF-Token': csrf,
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    })
    if (res.status === 401) throw new Error('PARTNER_COOKIES_EXPIRED')
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch {
      throw new Error(`non-JSON response: ${text.slice(0, 200)}`)
    }
    if (parsed.errors?.length) {
      throw new Error(`GraphQL errors: ${parsed.errors.map((e: any) => e.message).join('; ')}`)
    }
    return parsed.data as T
  } finally {
    clearTimeout(t)
  }
}

// ── Event type mapping (internal GraphQL → our existing schema) ───────────

function mapEventType(internal: string): string | null {
  switch (internal.toLowerCase()) {
    case 'installed':
    case 'install':
      return 'RELATIONSHIP_INSTALLED'
    case 'uninstalled':
    case 'uninstall':
      return 'RELATIONSHIP_UNINSTALLED'
    case 'reactivated':
    case 'store_reactivated':
      return 'RELATIONSHIP_REACTIVATED'
    case 'deactivated':
    case 'store_deactivated':
      return 'RELATIONSHIP_DEACTIVATED'
    case 'recurring_charge_activated':
    case 'subscription_charge_activated':
      return 'SUBSCRIPTION_CHARGE_ACTIVATED'
    default:
      return null // freezes / unfreezes etc — we don't track those
  }
}

/** Parse "May 5, 2026 at 6:11 pm" → Date. */
function parsePartnerDate(s: string): Date | null {
  if (!s) return null
  // Normalize "at" out and treat as local time (Partner Dashboard shows
  // dates in the partner's TZ, which is usually fine for ordering).
  const cleaned = s.replace(/\s+at\s+/i, ' ')
  const d = new Date(cleaned)
  if (isNaN(d.getTime())) return null
  return d
}

// ── Public entry: one app worth of events ─────────────────────────────────

const Q_APP_EVENTS = `
query AppEvents($appId: ID!, $after: String, $first: Int!) {
  app(id: $appId) {
    title
    currentInstalls
    events(first: $first, after: $after) {
      edges {
        cursor
        node {
          eventName
          eventType
          date
          shopId
          shopName
          details
          free
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

interface PartnerEventNode {
  eventName: string
  eventType: string
  date: string
  shopId: string
  shopName: string
  details: string | null
  free: boolean | null
}

interface ScrapeAppResult {
  appId: string
  appName: string
  currentInstalls: number
  events: PartnerEventNode[]
  errors: string[]
  truncated?: boolean
}

async function scrapeApp(
  orgId: string,
  appId: string,
  ctx: GqlContext,
  csrf: string,
  maxPages: number,
  delayPerPage = 0,
  budgetMs = Infinity
): Promise<ScrapeAppResult> {
  const events: PartnerEventNode[] = []
  let after: string | null = null
  let pages = 0
  let appName = `App ${appId}`
  let currentInstalls = 0
  let truncated = false
  const errors: string[] = []
  const start = Date.now()

  while (pages < maxPages) {
    if (Date.now() - start > budgetMs) { truncated = true; break }
    pages++
    try {
      const data: any = await gql<any>(orgId, ctx, csrf, Q_APP_EVENTS, {
        appId,
        first: 100,
        after,
      })
      const app = data?.app
      if (!app) break
      // Partner Dashboard sometimes returns titles with trailing whitespace
      // (e.g. "Mebiz Store Finder ", "Metizsoft Date & Time Slot ") — strip
      // it so name-keyed UI lookups don't miss.
      appName = (app.title || appName).trim()
      currentInstalls = app.currentInstalls ?? 0

      const edges = app.events?.edges || []
      for (const e of edges) events.push(e.node)

      const pi = app.events?.pageInfo
      if (pi?.hasNextPage && edges.length > 0) {
        after = pi.endCursor
        if (pages >= maxPages) truncated = true
        if (delayPerPage > 0) await new Promise((r) => setTimeout(r, delayPerPage))
      } else break
    } catch (e: any) {
      errors.push(`page ${pages}: ${e.message || e}`)
      if (e.message === 'PARTNER_COOKIES_EXPIRED') break
      // back off then break — don't hammer on errors
      break
    }
  }

  return { appId, appName, currentInstalls, events, errors, truncated }
}

// ── Shop resolver (shopId -> permanentDomain, country, plan, email) ───────

interface ShopInfo {
  id: string
  name: string
  permanentDomain: string
  country: string | null
  email: string | null
  planName: string | null
}

const Q_SHOP = `
query ShopInfo($id: ID!) {
  shop(id: $id) {
    id name permanentDomain country email planName
  }
}`

async function resolveOneShop(
  orgId: string,
  ctx: GqlContext,
  csrf: string,
  shopId: string
): Promise<ShopInfo | null> {
  try {
    const data: any = await gql<any>(orgId, ctx, csrf, Q_SHOP, { id: shopId })
    const s = data?.shop
    if (!s?.permanentDomain) return null
    return {
      id: s.id,
      name: s.name || '',
      permanentDomain: String(s.permanentDomain).toLowerCase(),
      country: s.country || null,
      email: s.email || null,
      planName: s.planName || null,
    }
  } catch {
    return null
  }
}

/**
 * Resolve unique shopIds → permanentDomain with bounded concurrency, a wall-clock
 * budget and a hard cap so a popular app can't make the request run for minutes.
 */
async function resolveShops(
  orgId: string,
  ctx: GqlContext,
  csrf: string,
  shopIds: string[],
  concurrency = 10,
  budgetMs = Infinity
): Promise<Map<string, ShopInfo>> {
  const out = new Map<string, ShopInfo>()
  let i = 0
  const start = Date.now()
  const workers = Array.from({ length: Math.min(concurrency, shopIds.length) }, async () => {
    while (true) {
      if (Date.now() - start > budgetMs) return
      const idx = i++
      if (idx >= shopIds.length) return
      const id = shopIds[idx]
      const info = await resolveOneShop(orgId, ctx, csrf, id)
      if (info) out.set(id, info)
    }
  })
  await Promise.all(workers)
  return out
}

// ── Persist events into MySQL ─────────────────────────────────────────────

async function persistEvents(
  appId: string,
  orgName: string,
  appName: string,
  scraped: PartnerEventNode[],
  shopInfo: Map<string, ShopInfo>
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0, skipped = 0

  for (const ev of scraped) {
    const mapped = mapEventType(ev.eventType)
    if (!mapped) { skipped++; continue }
    const occ = parsePartnerDate(ev.date)
    if (!occ) { skipped++; continue }

    const info = shopInfo.get(ev.shopId)
    const domain = info?.permanentDomain || `shop-${ev.shopId}`

    const eventId = `${mapped}::${appId}::${domain}::${occ.toISOString()}`

    try {
      await prisma.event.upsert({
        where: { eventId },
        update: {}, // never overwrite — first insert wins
        create: {
          eventId,
          type: mapped,
          appId,
          appName,
          org: orgName,
          storeName: ev.shopName || info?.name || '—',
          storeUrl: domain,
          occurredAt: occ,
          reason: null,
          description: ev.details || null,
          planName: info?.planName || null,
          planAmount: null,
          planCurrency: null,
        },
      })
      inserted++
    } catch (e: any) {
      skipped++
    }
  }
  return { inserted, skipped }
}

/**
 * Backfill the secondary tables (store_countries, store_emails) with the shop
 * info we resolved while scraping events. Free win — it'd otherwise need a
 * separate per-store HTTP scrape.
 */
async function persistShopInfo(shopInfo: Map<string, ShopInfo>): Promise<void> {
  for (const info of shopInfo.values()) {
    if (!info.permanentDomain) continue
    if (info.country) {
      try {
        await prisma.storeCountry.upsert({
          where: { domain: info.permanentDomain },
          create: { domain: info.permanentDomain, country: info.country, status: 200 },
          update: { country: info.country, status: 200 },
        })
      } catch { /* ignore */ }
    }
    if (info.email) {
      try {
        await prisma.storeEmail.upsert({
          where: { domain: info.permanentDomain },
          create: { domain: info.permanentDomain, email: info.email },
          update: { email: info.email },
        })
      } catch { /* ignore */ }
    }
  }
}

// ── Authoritative per-app users (matches the Partner panel) ───────────────
// Uses the cookie-auth Partner Dashboard internal API, which exposes the
// authoritative `currentInstalls` count and a far deeper event history than the
// token API. Folds events per shop into install status and resolves domains.

export interface CookieAppUser {
  domain: string
  name: string
  status: 'installed' | 'uninstalled'
  installedAt?: string
  uninstalledAt?: string
  uninstallReason?: string       // not exposed by the Partner Dashboard scrape (always undefined)
  uninstallDescription?: string  // merchant's free-text feedback (the event's `details`)
}

export interface CookieAppUsersResult {
  appName: string
  currentInstalls: number // authoritative — matches the Partner panel
  users: CookieAppUser[]
  installed: number
  uninstalled: number
  trend: TrendPoint[]
  partial: boolean
}

export async function fetchAppUsersViaCookies(
  orgId: string,
  appId: string,
  opts: { maxPages?: number; scrapeBudgetMs?: number; resolveBudgetMs?: number; resolveCap?: number } = {},
): Promise<CookieAppUsersResult> {
  const cookieHeader = await partnerCookieHeader()
  if (!cookieHeader) throw new Error('PARTNER_COOKIES_MISSING')

  const ctx: GqlContext = { cookieHeader }
  const csrf = await fetchCsrfToken(orgId, ctx) // throws PARTNER_COOKIES_EXPIRED on login redirect

  // The internal events API is slow (~1.5s/page) and low-throughput, so bound
  // the scrape by wall-clock. `currentInstalls` is authoritative regardless of
  // how many event pages we manage to read.
  const maxPages = opts.maxPages ?? 80
  const scrapeBudgetMs = opts.scrapeBudgetMs ?? 45_000
  const resolveBudgetMs = opts.resolveBudgetMs ?? 30_000
  const resolveCap = opts.resolveCap ?? 400

  const scraped = await scrapeApp(orgId, appId, ctx, csrf, maxPages, 0, scrapeBudgetMs)

  // Fold events per shop (status) and per IST day (trend) — no network needed.
  type Agg = { name: string; firstInstalledAt?: number; lastActiveAt?: number; lastInactiveAt?: number; uninstallDescription?: string }
  const byShop = new Map<string, Agg>()
  const trendMap = new Map<string, { installs: number; uninstalls: number }>()
  for (const ev of scraped.events) {
    const mapped = mapEventType(ev.eventType)
    if (!mapped) continue
    const d = parsePartnerDate(ev.date)
    if (!d) continue
    const t = d.getTime()
    const cur: Agg = byShop.get(ev.shopId) || { name: ev.shopName || '' }
    if (ev.shopName) cur.name = ev.shopName
    if (mapped === 'RELATIONSHIP_INSTALLED') {
      if (cur.firstInstalledAt == null || t < cur.firstInstalledAt) cur.firstInstalledAt = t
      if (cur.lastActiveAt == null || t > cur.lastActiveAt) cur.lastActiveAt = t
    } else if (mapped === 'RELATIONSHIP_REACTIVATED') {
      if (cur.lastActiveAt == null || t > cur.lastActiveAt) cur.lastActiveAt = t
    } else if (mapped === 'RELATIONSHIP_UNINSTALLED' || mapped === 'RELATIONSHIP_DEACTIVATED') {
      if (cur.lastInactiveAt == null || t > cur.lastInactiveAt) {
        cur.lastInactiveAt = t
        // The scrape exposes free-text feedback as `details` (uninstall only).
        cur.uninstallDescription = mapped === 'RELATIONSHIP_UNINSTALLED' ? (ev.details || undefined) : undefined
      }
    }
    byShop.set(ev.shopId, cur)

    // Trend: raw installs vs uninstalls per IST day.
    if (mapped === 'RELATIONSHIP_INSTALLED' || mapped === 'RELATIONSHIP_UNINSTALLED') {
      const day = istDay(d)
      const tr = trendMap.get(day) || { installs: 0, uninstalls: 0 }
      if (mapped === 'RELATIONSHIP_INSTALLED') tr.installs++
      else tr.uninstalls++
      trendMap.set(day, tr)
    }
  }

  // Status per shop.
  const shopStatus = (v: Agg) => v.lastActiveAt != null && (v.lastInactiveAt == null || v.lastActiveAt >= v.lastInactiveAt)

  // Only the *installed* stores are shown in the UI, so resolve domains for
  // those (newest install first), capped + time-budgeted. Everything else keeps
  // its store name and is skipped — this is what keeps the request fast.
  const installedShopIds = [...byShop.entries()]
    .filter(([, v]) => shopStatus(v))
    .sort((a, b) => (b[1].firstInstalledAt ?? 0) - (a[1].firstInstalledAt ?? 0))
    .map(([id]) => id)
    .slice(0, resolveCap)
  const resolved = await resolveShops(orgId, ctx, csrf, installedShopIds, 10, resolveBudgetMs)

  const users: CookieAppUser[] = [...byShop.entries()].map(([shopId, v]) => {
    const info = resolved.get(shopId)
    const domain = info?.permanentDomain || `shop-${shopId}`
    return {
      domain,
      name: v.name || info?.name || domain,
      status: shopStatus(v) ? 'installed' : 'uninstalled',
      installedAt: v.firstInstalledAt != null ? new Date(v.firstInstalledAt).toISOString() : undefined,
      uninstalledAt: v.lastInactiveAt != null ? new Date(v.lastInactiveAt).toISOString() : undefined,
      uninstallDescription: shopStatus(v) ? undefined : v.uninstallDescription,
    }
  })

  users.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'installed' ? -1 : 1
    const at = a.installedAt || a.uninstalledAt || ''
    const bt = b.installedAt || b.uninstalledAt || ''
    return bt.localeCompare(at)
  })

  return {
    appName: scraped.appName,
    currentInstalls: scraped.currentInstalls,
    users,
    installed: users.filter((u) => u.status === 'installed').length,
    uninstalled: users.filter((u) => u.status === 'uninstalled').length,
    trend: trendFromMap(trendMap),
    partial: !!scraped.truncated || scraped.errors.length > 0,
  }
}

// ── Lightweight scheduled sync of recent install/uninstall counts ─────────
// Pulls only the most recent event pages per connected app (fast) and merges
// the per-day install/uninstall trend into each app's cached meta doc
// (app_users_meta:<appId>). Keeps "installs/uninstalls today" current on the
// Partners page and app detail without a full 50s scrape or any app changes.

function mergeTrend(oldT: TrendPoint[], recentT: TrendPoint[]): TrendPoint[] {
  const map = new Map(oldT.map((t) => [t.date, t]))
  for (const r of recentT) map.set(r.date, r) // fresh recent days win (events are newest-first → complete)
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface SyncRecentResult {
  apps: number
  updated: number
  errors: string[]
}

export async function syncRecentEventCounts(
  opts: { maxPagesPerApp?: number } = {},
): Promise<SyncRecentResult> {
  const cookieHeader = await partnerCookieHeader()
  if (!cookieHeader) throw new Error('PARTNER_COOKIES_MISSING')
  const ctx: GqlContext = { cookieHeader }
  const maxPages = opts.maxPagesPerApp ?? 3

  const apps = await prisma.shopifyApp.findMany({ select: { appId: true, partnerId: true } })
  const byOrg = new Map<string, string[]>()
  for (const a of apps) {
    const list = byOrg.get(a.partnerId) || []
    list.push(a.appId)
    byOrg.set(a.partnerId, list)
  }

  const result: SyncRecentResult = { apps: 0, updated: 0, errors: [] }

  for (const [orgId, appIds] of byOrg) {
    let csrf: string
    try {
      csrf = await fetchCsrfToken(orgId, ctx)
    } catch (e: any) {
      result.errors.push(`${orgId}: ${e?.message || 'csrf failed'}`)
      continue
    }

    for (const appId of appIds) {
      result.apps++
      try {
        const scraped = await scrapeApp(orgId, appId, ctx, csrf, maxPages, 0, 15_000)

        const trendMap = new Map<string, { installs: number; uninstalls: number }>()
        for (const ev of scraped.events) {
          const m = mapEventType(ev.eventType)
          if (m !== 'RELATIONSHIP_INSTALLED' && m !== 'RELATIONSHIP_UNINSTALLED') continue
          const d = parsePartnerDate(ev.date)
          if (!d) continue
          const day = istDay(d)
          const t = trendMap.get(day) || { installs: 0, uninstalls: 0 }
          if (m === 'RELATIONSHIP_INSTALLED') t.installs++
          else t.uninstalls++
          trendMap.set(day, t)
        }
        const recent = trendFromMap(trendMap)

        const metaKey = `app_users_meta:${appId}`
        const existing = await prisma.state.findUnique({ where: { id: metaKey } })
        const prev = (existing?.value as any) || {}
        const value = {
          ...prev,
          source: prev.source || 'partner_dashboard',
          currentInstalls: scraped.currentInstalls ?? prev.currentInstalls ?? null,
          trend: mergeTrend((prev.trend as TrendPoint[]) || [], recent),
          partial: prev.partial ?? true,
          syncedAt: new Date().toISOString(),
        }
        await prisma.state.upsert({
          where: { id: metaKey },
          create: { id: metaKey, value: value as any },
          update: { value: value as any },
        })
        result.updated++
      } catch (e: any) {
        result.errors.push(`${appId}: ${e?.message || 'sync failed'}`)
      }
    }
  }

  return result
}

// ── Top-level entry ────────────────────────────────────────────────────────

export interface PartnerScrapeOptions {
  /** Max paginated pages per app. Default 30 → up to 3,000 events per app. */
  maxPagesPerApp?: number
  /** If true, only scrape one org (for testing). */
  onlyOrgId?: string
  /** Delay in ms between apps to avoid rate limiting. Default 2000. */
  delayBetweenApps?: number
  /** Delay in ms between pages within a single app scrape. Default 0. */
  delayPerPage?: number
}

export interface PartnerScrapeResult {
  apps_scraped: number
  events_inserted: number
  events_skipped: number
  current_installs_by_app: Record<string, { app_name: string; current_installs: number }>
  errors: string[]
}

// Minimal query: just the authoritative install count, no event history.
const Q_APP_INSTALLS = `query AppInstalls($appId: ID!) { app(id: $appId) { title currentInstalls } }`

export interface InstallCountsResult {
  updated: number
  counts: Record<string, { app_name: string; current_installs: number }>
  errors: string[]
}

/**
 * Fast cookie-based refresh of every app's authoritative install count — the
 * exact "Installs" number shown on the Partner Dashboard apps list — via the
 * internal `app(id){ currentInstalls }` field. One lightweight request per app
 * (no event pagination), so it comfortably fits a 60s cron. Writes the value to
 * `app_stats:<appId>`, which the cards read as the exact installed total.
 * Throws PARTNER_COOKIES_MISSING if no partner session cookie is stored.
 */
export async function scrapeInstallCounts(opts: { onlyOrgId?: string } = {}): Promise<InstallCountsResult> {
  await checkCookieExpiry()
  const cookieHeader = await partnerCookieHeader()
  if (!cookieHeader) throw new Error('PARTNER_COOKIES_MISSING')
  const ctx: GqlContext = { cookieHeader }
  const result: InstallCountsResult = { updated: 0, counts: {}, errors: [] }

  for (const org of await partnersWithApps()) {
    if (opts.onlyOrgId && org.partnerId !== opts.onlyOrgId) continue
    let csrf: string
    try {
      csrf = await fetchCsrfToken(org.partnerId, ctx)
    } catch (e: any) {
      result.errors.push(`${org.org}: csrf failed: ${e.message || e}`)
      if (e.message === 'PARTNER_COOKIES_EXPIRED') break
      continue
    }
    for (const appId of org.apps) {
      try {
        const data: any = await gql<any>(org.partnerId, ctx, csrf, Q_APP_INSTALLS, { appId })
        const app = data?.app
        if (!app) { result.errors.push(`${appId}: no app data`); continue }
        const appName = (app.title || `App ${appId}`).trim()
        const currentInstalls = app.currentInstalls ?? 0
        result.counts[appId] = { app_name: appName, current_installs: currentInstalls }
        // Never overwrite a good value with a suspicious 0 (rate-limited/failed).
        if (currentInstalls > 0) {
          const value = { app_name: appName, current_installs: currentInstalls, updated_at: new Date().toISOString() }
          await prisma.state.upsert({
            where: { id: `app_stats:${appId}` },
            create: { id: `app_stats:${appId}`, value },
            update: { value },
          })
          result.updated++
        }
      } catch (e: any) {
        result.errors.push(`${appId}: ${e.message || e}`)
        if (e.message === 'PARTNER_COOKIES_EXPIRED') break
      }
    }
  }
  return result
}

export async function scrapePartnerDashboard(
  opts: PartnerScrapeOptions = {}
): Promise<PartnerScrapeResult> {
  await checkCookieExpiry()
  const cookieHeader = await partnerCookieHeader()
  if (!cookieHeader) {
    throw new Error('No partner cookies stored. Upload them via POST /api/cookies.')
  }

  const ctx: GqlContext = { cookieHeader }
  const maxPages = opts.maxPagesPerApp ?? 30
  const delayMs = opts.delayBetweenApps ?? 0
  const delayPerPage = opts.delayPerPage ?? 0
  const result: PartnerScrapeResult = {
    apps_scraped: 0,
    events_inserted: 0,
    events_skipped: 0,
    current_installs_by_app: {},
    errors: [],
  }

  for (const org of await partnersWithApps()) {
    if (opts.onlyOrgId && org.partnerId !== opts.onlyOrgId) continue
    let csrf: string
    try {
      csrf = await fetchCsrfToken(org.partnerId, ctx)
    } catch (e: any) {
      result.errors.push(`${org.org}: csrf fetch failed: ${e.message}`)
      if (e.message === 'PARTNER_COOKIES_EXPIRED') break
      continue
    }

    for (const appId of org.apps) {
      try {
        const scraped = await scrapeApp(org.partnerId, appId, ctx, csrf, maxPages, delayPerPage)

        // Resolve unique shopIds in this app's events to their permanent
        // myshopify domain. We cache resolved shops in MySQL so subsequent
        // syncs skip re-querying — bounded by 6 in-flight HTTP calls.
        const uniqShopIds = Array.from(new Set(scraped.events.map((e) => e.shopId).filter(Boolean)))
        const cached = await prisma.storeCountry.findMany({
          where: { domain: { in: uniqShopIds.map((id) => `shop-${id}`) } },
          select: { domain: true },
        })
        void cached // (placeholder — current cache is keyed by domain, not shopId)
        const resolved = await resolveShops(org.partnerId, ctx, csrf, uniqShopIds)
        await persistShopInfo(resolved)
        console.log(
          `[partner-scrape] ${org.org}/${appId}: resolved ${resolved.size}/${uniqShopIds.length} shop domains`
        )

        const persisted = await persistEvents(appId, org.org, scraped.appName, scraped.events, resolved)
        result.apps_scraped++
        result.events_inserted += persisted.inserted
        result.events_skipped += persisted.skipped
        result.current_installs_by_app[appId] = {
          app_name: scraped.appName,
          current_installs: scraped.currentInstalls,
        }
        // Only save authoritative current-installs when we actually got a
        // valid count (>0 or no errors). A 0 with errors means rate-limited
        // or failed — never overwrite a previously saved good value with 0.
        if (scraped.currentInstalls > 0 || scraped.errors.length === 0) {
          const stateValue = {
            app_name: scraped.appName,
            current_installs: scraped.currentInstalls,
            updated_at: new Date().toISOString(),
          }
          await prisma.state.upsert({
            where: { id: `app_stats:${appId}` },
            create: { id: `app_stats:${appId}`, value: stateValue },
            update: { value: stateValue },
          })
        }
        if (scraped.errors.length) {
          result.errors.push(`${org.org}/${appId}: ${scraped.errors.join('; ')}`)
        }
        console.log(
          `[partner-scrape] ${org.org}/${appId} (${scraped.appName}): ` +
          `${scraped.events.length} events from API, ${persisted.inserted} new in DB, ` +
          `currentInstalls=${scraped.currentInstalls}`
        )
      } catch (e: any) {
        result.errors.push(`${org.org}/${appId}: ${e.message || e}`)
      }
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  return result
}
