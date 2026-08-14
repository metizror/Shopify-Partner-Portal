import { SHOPIFY_PARTNER_API_VERSION } from '@/config'
import { calendarDay } from '@/lib/tz'

// 1:1 port of the GraphQL query from notify_email.py
const QUERY = `
query($appId: ID!, $after: String) {
  app(id: $appId) {
    name
    events(first: 50, after: $after, types: [RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED, SUBSCRIPTION_CHARGE_ACTIVATED]) {
      edges {
        node {
          ... on RelationshipInstalled   { type occurredAt shop { myshopifyDomain name } }
          ... on RelationshipUninstalled { type occurredAt reason description shop { myshopifyDomain name } }
          ... on SubscriptionChargeActivated {
            type occurredAt
            shop { myshopifyDomain }
            charge { name amount { amount currencyCode } }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}
`

export interface PartnerEvent {
  type: 'RELATIONSHIP_INSTALLED' | 'RELATIONSHIP_UNINSTALLED' | 'SUBSCRIPTION_CHARGE_ACTIVATED'
  occurredAt: string
  reason?: string
  description?: string
  shop?: { myshopifyDomain?: string; name?: string }
  charge?: { name?: string; amount?: { amount?: string; currencyCode?: string } }
}

export interface FetchEventsResult {
  appName: string
  events: PartnerEvent[]
}

/**
 * Verify that a Partner ID (org id) + API token can reach the Shopify Partner
 * API. Returns { ok: true } on success, or { ok: false, error } with a
 * human-readable reason. Used before persisting a new partner connection.
 */
export async function verifyPartnerConnection(
  orgId: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return { ok: false, error: 'Could not reach the Shopify Partner API. Check your network and try again.' }
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Invalid API token for this Partner organisation.' }
  }
  if (res.status === 404) {
    return { ok: false, error: 'Partner ID not found. Check the Shopify Partner ID.' }
  }
  if (!res.ok) {
    return { ok: false, error: `Shopify Partner API error (${res.status}).` }
  }

  let body: any
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: 'Unexpected response from the Shopify Partner API.' }
  }
  if (body?.errors?.length) {
    return { ok: false, error: body.errors[0]?.message || 'Shopify Partner API rejected the request.' }
  }
  if (!body?.data) {
    return { ok: false, error: 'Could not authenticate with the Shopify Partner API.' }
  }
  return { ok: true }
}

export interface PartnerApp {
  appId: string
  name: string
}

export interface FetchPartnerAppsResult {
  apps: PartnerApp[]
  partial: boolean // true if we stopped early (time budget / transient failure)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * Discover a partner org's (published) apps via the Partner API. The API has no
 * `apps` list field, so we paginate the `transactions` connection and collect
 * the distinct apps referenced by app-sale transactions.
 *
 * Notes:
 *  - Transient gateway errors (429/5xx) are retried with backoff, so a single
 *    502 no longer fails the whole sync.
 *  - Bounded by a wall-clock budget; on timeout or repeated transient failure
 *    we return whatever was found so far with `partial: true`.
 *  - Deleted apps (name "DELETED_APP") are skipped.
 *  - Apps that never had a transaction cannot be discovered through this API.
 */
export async function fetchPartnerApps(
  orgId: string,
  token: string,
  opts: { budgetMs?: number } = {},
): Promise<FetchPartnerAppsResult> {
  const budgetMs = opts.budgetMs ?? 150_000
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const APP_FRAGMENTS = `
    ... on AppOneTimeSale     { app { id name } }
    ... on AppSaleAdjustment  { app { id name } }
    ... on AppSaleCredit      { app { id name } }
    ... on AppSubscriptionSale { app { id name } }
    ... on AppUsageSale       { app { id name } }
  `
  const query = `query($after: String) {
    transactions(first: 100, after: $after) {
      edges { cursor node { __typename ${APP_FRAGMENTS} } }
      pageInfo { hasNextPage }
    }
  }`

  const apps = new Map<string, PartnerApp>()
  let after: string | null = null
  let partial = false
  let sawAnyPage = false
  const start = Date.now()

  while (Date.now() - start < budgetMs) {
    // Fetch one page with retry/backoff on transient errors.
    let body: any = null
    let lastErr = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { after } }),
          signal: AbortSignal.timeout(20_000),
        })
      } catch {
        lastErr = 'network error'
        await sleep(500 * (attempt + 1))
        continue
      }
      if (res.status === 200) { body = await res.json(); break }
      if (res.status === 401 || res.status === 403) throw new Error('Invalid API token for this Partner organisation.')
      if (TRANSIENT_STATUS.has(res.status)) {
        lastErr = `Shopify Partner API ${res.status}`
        await sleep(500 * (attempt + 1)) // 0.5s, 1s, 1.5s, 2s…
        continue
      }
      // Non-transient hard error — surface a clean message (never raw HTML).
      throw new Error(`Shopify Partner API error (${res.status}).`)
    }

    if (!body) {
      // Retries exhausted for this page. Keep what we have so far.
      if (!sawAnyPage) throw new Error(lastErr ? `${lastErr}. Please try again.` : 'Could not reach the Shopify Partner API.')
      partial = true
      break
    }
    if (body?.errors?.length) {
      throw new Error(body.errors[0]?.message || 'Shopify Partner API error while listing apps.')
    }

    sawAnyPage = true
    const conn = body?.data?.transactions
    const edges: any[] = conn?.edges || []
    for (const e of edges) {
      const app = e?.node?.app
      if (app?.id) {
        const appId = String(app.id).split('/').pop() as string
        const name: string = app.name || `App ${appId}`
        if (name === 'DELETED_APP') continue // skip deleted apps
        if (!apps.has(appId)) apps.set(appId, { appId, name })
      }
    }
    if (!conn?.pageInfo?.hasNextPage || edges.length === 0) break
    after = edges[edges.length - 1]?.cursor ?? null
    if (!after) break
  }

  // Hit the wall-clock budget without finishing.
  if (Date.now() - start >= budgetMs) partial = true

  return {
    apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)),
    partial,
  }
}

/**
 * Look up a single app by its numeric ID via the Partner API. Works even for
 * apps with zero transactions (which `fetchPartnerApps` cannot discover).
 * Returns null if the app does not exist in this partner org.
 */
export async function fetchAppById(
  orgId: string,
  appId: string,
  token: string,
): Promise<PartnerApp | null> {
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const gid = `gid://partners/App/${appId}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query($id: ID!) { app(id: $id) { id name } }`, variables: { id: gid } }),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403) throw new Error('Invalid API token for this Partner organisation.')
  if (!res.ok) throw new Error(`Shopify Partner API error (${res.status}).`)
  const body: any = await res.json()
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Shopify Partner API error.')
  const app = body?.data?.app
  if (!app?.id) return null
  const id = String(app.id).split('/').pop() as string
  return { appId: id, name: (app.name || `App ${id}`).trim() }
}

export interface AppUser {
  domain: string
  name: string
  status: 'installed' | 'uninstalled'
  installedAt?: string
  uninstalledAt?: string
  uninstallReason?: string       // Shopify's categorized churn reason (latest uninstall)
  uninstallDescription?: string  // merchant's free-text feedback (latest uninstall)
}

// One day's install/uninstall counts for the trend chart (date = IST YYYY-MM-DD).
export interface TrendPoint {
  date: string
  installs: number
  uninstalls: number
}

export interface FetchAppUsersResult {
  appName: string
  users: AppUser[]
  installed: number
  uninstalled: number
  trend: TrendPoint[]
  partial: boolean // true if we stopped early (time budget / transient failure)
}

/** Calendar day in the configured display timezone (TZ_DISPLAY) as YYYY-MM-DD. */
export function istDay(d: Date): string {
  return calendarDay(d)
}

/** Fold a {day → {installs,uninstalls}} map into a sorted TrendPoint[]. */
export function trendFromMap(map: Map<string, { installs: number; uninstalls: number }>): TrendPoint[] {
  return [...map.entries()]
    .map(([date, v]) => ({ date, installs: v.installs, uninstalls: v.uninstalls }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Fetch the list of stores (merchants/"users") that have ever installed an app,
 * with their current install status. Paginates the app's install/uninstall
 * events and folds them per shop domain: a store counts as currently installed
 * if its most recent event is an install.
 *
 * Bounded by a wall-clock budget; transient gateway errors (429/5xx) are
 * retried with backoff. On timeout/exhaustion we return what we have with
 * `partial: true`.
 */
export async function fetchAppUsers(
  orgId: string,
  appId: string,
  token: string,
  opts: { budgetMs?: number } = {},
): Promise<FetchAppUsersResult> {
  const budgetMs = opts.budgetMs ?? 150_000
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const gid = `gid://partners/App/${appId}`
  const query = `query($appId: ID!, $after: String) {
    app(id: $appId) {
      name
      events(first: 100, after: $after, types: [RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED, RELATIONSHIP_DEACTIVATED, RELATIONSHIP_REACTIVATED]) {
        edges {
          cursor
          node {
            ... on RelationshipInstalled   { type occurredAt shop { myshopifyDomain name } }
            ... on RelationshipUninstalled { type occurredAt reason description shop { myshopifyDomain name } }
            ... on RelationshipDeactivated { type occurredAt shop { myshopifyDomain name } }
            ... on RelationshipReactivated { type occurredAt shop { myshopifyDomain name } }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }`

  // Per domain we keep: first install, the latest "active" event
  // (install/reactivate) and the latest "inactive" event (uninstall/deactivate).
  // A store is currently installed when its latest active event is newer than
  // its latest inactive event — matching the main dashboard's logic.
  type DomainAgg = { name: string; firstInstalledAt?: string; lastActiveAt?: string; lastInactiveAt?: string; uninstallReason?: string; uninstallDescription?: string }
  const byDomain = new Map<string, DomainAgg>()
  const trendMap = new Map<string, { installs: number; uninstalls: number }>()
  let appName = `App ${appId}`
  let after: string | null = null
  let partial = false
  let sawAnyPage = false
  const start = Date.now()

  while (Date.now() - start < budgetMs) {
    let body: any = null
    let lastErr = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { appId: gid, after } }),
          signal: AbortSignal.timeout(20_000),
        })
      } catch {
        lastErr = 'network error'
        await sleep(500 * (attempt + 1))
        continue
      }
      if (res.status === 200) { body = await res.json(); break }
      if (res.status === 401 || res.status === 403) throw new Error('Invalid API token for this Partner organisation.')
      if (TRANSIENT_STATUS.has(res.status)) {
        lastErr = `Shopify Partner API ${res.status}`
        await sleep(500 * (attempt + 1))
        continue
      }
      throw new Error(`Shopify Partner API error (${res.status}).`)
    }

    if (!body) {
      if (!sawAnyPage) throw new Error(lastErr ? `${lastErr}. Please try again.` : 'Could not reach the Shopify Partner API.')
      partial = true
      break
    }
    if (body?.errors?.length) {
      throw new Error(body.errors[0]?.message || 'Shopify Partner API error while listing users.')
    }

    sawAnyPage = true
    const app = body?.data?.app
    if (!app) throw new Error(`Partner API returned no app data for ${appId}`)
    if (app.name) appName = app.name
    const conn = app.events
    const edges: any[] = conn?.edges || []
    for (const e of edges) {
      const node = e?.node
      const domain: string | undefined = node?.shop?.myshopifyDomain
      if (!domain) continue
      const cur: DomainAgg = byDomain.get(domain) || { name: node?.shop?.name || domain }
      if (node?.shop?.name) cur.name = node.shop.name
      const when: string = node.occurredAt
      if (node.type === 'RELATIONSHIP_INSTALLED') {
        if (!cur.firstInstalledAt || when < cur.firstInstalledAt) cur.firstInstalledAt = when
        if (!cur.lastActiveAt || when > cur.lastActiveAt) cur.lastActiveAt = when
      } else if (node.type === 'RELATIONSHIP_REACTIVATED') {
        if (!cur.lastActiveAt || when > cur.lastActiveAt) cur.lastActiveAt = when
      } else if (node.type === 'RELATIONSHIP_UNINSTALLED' || node.type === 'RELATIONSHIP_DEACTIVATED') {
        if (!cur.lastInactiveAt || when > cur.lastInactiveAt) {
          cur.lastInactiveAt = when
          // Reason/description only exist on uninstall events; clear if the
          // latest inactive event is a deactivation (which carries neither).
          cur.uninstallReason = node.type === 'RELATIONSHIP_UNINSTALLED' ? (node.reason || undefined) : undefined
          cur.uninstallDescription = node.type === 'RELATIONSHIP_UNINSTALLED' ? (node.description || undefined) : undefined
        }
      }
      byDomain.set(domain, cur)

      // Trend: count raw installs vs uninstalls per IST day.
      if (node.type === 'RELATIONSHIP_INSTALLED' || node.type === 'RELATIONSHIP_UNINSTALLED') {
        const day = istDay(new Date(when))
        const t = trendMap.get(day) || { installs: 0, uninstalls: 0 }
        if (node.type === 'RELATIONSHIP_INSTALLED') t.installs++
        else t.uninstalls++
        trendMap.set(day, t)
      }
    }
    if (!conn?.pageInfo?.hasNextPage || edges.length === 0) break
    after = edges[edges.length - 1]?.cursor ?? null
    if (!after) break
  }

  if (Date.now() - start >= budgetMs) partial = true

  const users: AppUser[] = [...byDomain.entries()].map(([domain, v]) => {
    const installed = !!v.lastActiveAt && (!v.lastInactiveAt || v.lastActiveAt >= v.lastInactiveAt)
    return {
      domain,
      name: v.name || domain,
      status: installed ? 'installed' : 'uninstalled',
      installedAt: v.firstInstalledAt,
      uninstalledAt: v.lastInactiveAt,
      // Only surface the reason for stores that are currently uninstalled.
      uninstallReason: installed ? undefined : v.uninstallReason,
      uninstallDescription: installed ? undefined : v.uninstallDescription,
    }
  })

  // Installed first, then by most recent activity.
  users.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'installed' ? -1 : 1
    const at = a.installedAt || a.uninstalledAt || ''
    const bt = b.installedAt || b.uninstalledAt || ''
    return bt.localeCompare(at)
  })

  return {
    appName,
    users,
    installed: users.filter((u) => u.status === 'installed').length,
    uninstalled: users.filter((u) => u.status === 'uninstalled').length,
    trend: trendFromMap(trendMap),
    partial,
  }
}

export async function fetchAppEvents(
  orgId: string,
  appId: string,
  token: string
): Promise<FetchEventsResult> {
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const gid = `gid://partners/App/${appId}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { appId: gid, after: null } }),
  })

  if (!res.ok) {
    throw new Error(`Partner API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const body: any = await res.json()
  const app = body?.data?.app
  if (!app) {
    throw new Error(`Partner API returned no app data for ${appId}`)
  }

  const appName: string = app.name || `App ${appId}`
  const edges: Array<{ node: PartnerEvent }> = app.events?.edges || []
  return { appName, events: edges.map((e) => e.node) }
}
