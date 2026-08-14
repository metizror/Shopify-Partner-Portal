// Scrapes the list of partner-managed stores from the Shopify Partner Dashboard.
// Uses the same cookie-based internal GraphQL endpoint as partner-dashboard-scraper.ts.
// Results are stored in the partner_managed_stores MySQL table, which is then
// served as partner_managed_stores.json via /api/static/partner_managed_stores.json.

import { SHOPIFY_PARTNER_API_VERSION } from '@/config'
import { listPartners } from '@/services/app-catalog'
import { prisma } from '@/lib/db'
import { partnerCookieHeader } from '@/services/partner-cookies'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0'

// ── Helpers shared with partner-dashboard-scraper ─────────────────────────

async function fetchCsrfToken(orgId: string, cookieHeader: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(`https://partners.shopify.com/${orgId}/stores`, {
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeader,
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

async function gqlInternal<T = any>(
  orgId: string,
  cookieHeader: string,
  csrf: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(`https://partners.shopify.com/${orgId}/api/graphql`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://partners.shopify.com',
        Referer: `https://partners.shopify.com/${orgId}/stores`,
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
      throw new Error(`GraphQL: ${parsed.errors.map((e: any) => e.message).join('; ')}`)
    }
    return parsed.data as T
  } finally {
    clearTimeout(t)
  }
}

// ── Partner API (token-based) fallback ────────────────────────────────────

// Internal Partner Dashboard GraphQL (cookie-based).
// Fields discovered via __type introspection — "stores" query uses page-number
// cursors (1, 2, 3…) as endCursor / after values.
const Q_MANAGED_STORES_INTERNAL = `
query ManagedStores($first: Int!, $after: String) {
  stores(first: $first, after: $after) {
    edges {
      cursor
      node {
        shopId
        shopName
        permanentDomain
        plan
        typeTranslated
        state
        relationshipStartedAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

interface RawStore {
  shopId?: string
  shopName?: string
  permanentDomain?: string
  plan?: string
  typeTranslated?: string
  state?: string
  relationshipStartedAt?: string
}

function normaliseStore(raw: RawStore, orgId: string) {
  const domain = (raw.permanentDomain || '').toLowerCase()
  const plan = raw.plan || ''
  const access = raw.typeTranslated || 'Managed'
  const state = raw.state || 'active'
  // "June 23, 2025" → "2025-06-23"
  const startedDate = raw.relationshipStartedAt
    ? (() => { const d = new Date(raw.relationshipStartedAt!); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) })()
    : ''
  return {
    orgId,
    shopId: raw.shopId || null,
    name: raw.shopName || domain,
    domain,
    url: domain ? `https://${domain}` : '',
    plan,
    access,
    state,
    started: startedDate,
  }
}

export interface PartnerStoresScrapeResult {
  stores_found: number
  stores_upserted: number
  errors: string[]
  source: string
}

export async function runPartnerManagedStoresOnce(): Promise<PartnerStoresScrapeResult> {
  const result: PartnerStoresScrapeResult = {
    stores_found: 0,
    stores_upserted: 0,
    errors: [],
    source: 'none',
  }

  // Try cookie-based internal API first (most complete data)
  const cookieHdr = await partnerCookieHeader()
  if (cookieHdr) {
    result.source = 'cookies'
    for (const org of await listPartners()) {
      let csrf: string
      try {
        csrf = await fetchCsrfToken(org.partnerId, cookieHdr)
      } catch (e: any) {
        result.errors.push(`${org.org}: csrf: ${e.message}`)
        if (e.message === 'PARTNER_COOKIES_EXPIRED') break
        continue
      }

      let after: string | null = null
      let pages = 0
      while (pages < 50) {
        pages++
        try {
          const data: any = await gqlInternal(org.partnerId, cookieHdr, csrf, Q_MANAGED_STORES_INTERNAL, {
            first: 100,
            after,
          })
          const edges = data?.stores?.edges || []
          for (const edge of edges) {
            const raw: RawStore = edge.node || {}
            if (!raw.permanentDomain) continue
            const norm = normaliseStore(raw, org.partnerId)
            result.stores_found++
            try {
              await prisma.partnerManagedStore.upsert({
                where: { domain: norm.domain },
                create: norm,
                update: { name: norm.name, plan: norm.plan, access: norm.access, state: norm.state, started: norm.started, orgId: norm.orgId, shopId: norm.shopId },
              })
              result.stores_upserted++
            } catch (e: any) {
              result.errors.push(`upsert ${norm.domain}: ${e.message}`)
            }
          }
          const pi = data?.stores?.pageInfo
          if (pi?.hasNextPage && edges.length > 0) {
            after = edges[edges.length - 1].cursor
          } else break
        } catch (e: any) {
          result.errors.push(`${org.org} page ${pages}: ${e.message}`)
          break
        }
      }
    }
    return result
  }

  // No cookies — try Partner API tokens
  result.source = 'token'
  result.errors.push('No partner cookies stored. Upload them via POST /api/cookies to enable managed stores scraping.')
  console.log('[partner-stores] no cookies available — cannot fetch managed stores')
  return result
}
