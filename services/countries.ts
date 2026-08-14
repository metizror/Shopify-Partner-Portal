// 1:1 port of fetch_store_countries.py.
// Scrapes Partner Dashboard store pages for country + phone using session cookies.

import { prisma } from '@/lib/db'
import { partnerCookieHeader, checkCookieExpiry } from '@/services/partner-cookies'
import { listPartners } from '@/services/app-catalog'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0'
const TIMEOUT_MS = 10_000
const CONCURRENCY = 6
const DB_WRITE_CONCURRENCY = 8


const KNOWN_COUNTRIES = new Set([
  'United States', 'Canada', 'United Kingdom', 'Australia', 'New Zealand',
  'India', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium',
  'Sweden', 'Norway', 'Denmark', 'Finland', 'Ireland', 'Portugal',
  'Switzerland', 'Austria', 'Poland', 'Czech Republic', 'Greece',
  'Turkey', 'Russia', 'Ukraine', 'Japan', 'South Korea', 'China',
  'Hong Kong', 'Taiwan', 'Singapore', 'Malaysia', 'Indonesia', 'Thailand',
  'Vietnam', 'Philippines', 'UAE', 'United Arab Emirates', 'Saudi Arabia',
  'Israel', 'Egypt', 'South Africa', 'Nigeria', 'Kenya', 'Ghana',
  'Brazil', 'Argentina', 'Chile', 'Colombia', 'Mexico', 'Peru', 'Uruguay',
  'Romania', 'Hungary', 'Bulgaria', 'Croatia', 'Slovenia', 'Slovakia',
  'Estonia', 'Latvia', 'Lithuania', 'Iceland', 'Malta', 'Cyprus',
  'Luxembourg', 'Pakistan', 'Bangladesh', 'Sri Lanka',
])

const COUNTRY_RE = /<p>\s*([A-Z][A-Za-z ]{2,40})\s*<\/p>/gm
const PHONE_RE = /<p>\s*(\+?\d[\d\s\-()]{6,20})\s*<\/p>/gm
const COUNTRY_JSON_RE = /"country"\s*:\s*"([^"]+)"/

function extractCountry(html: string): string {
  for (const m of html.matchAll(COUNTRY_RE)) {
    const v = m[1].trim()
    if (KNOWN_COUNTRIES.has(v)) return v
  }
  const j = html.match(COUNTRY_JSON_RE)
  return j?.[1] || ''
}

function extractPhone(html: string): string {
  for (const m of html.matchAll(PHONE_RE)) {
    const v = m[1].trim()
    if ((v.match(/\d/g) || []).length >= 6) return v
  }
  return ''
}

interface CountryResult {
  domain: string
  country?: string
  phone?: string
  status?: number
  error?: string
}

// A shop is only visible under the organisation that manages it, and the store
// page 404s under the others — so every connected org is tried in turn. This
// list used to be three hardcoded ids belonging to one Partner account.
async function fetchOne(domain: string, shopId: string, cookieHdr: string, orgIds: string[]): Promise<CountryResult> {
  for (const orgId of orgIds) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`https://partners.shopify.com/${orgId}/stores/${shopId}`, {
        headers: { 'User-Agent': USER_AGENT, Cookie: cookieHdr },
        signal: ctrl.signal,
        redirect: 'follow',
      })
      if (res.status === 404) continue
      if (!res.ok) {
        return { domain, status: res.status, country: '', phone: '' }
      }
      const html = await res.text()
      return {
        domain,
        country: extractCountry(html),
        phone: extractPhone(html),
        status: 200,
      }
    } catch (e: any) {
      return { domain, error: String(e.message || e).slice(0, 100), country: '', phone: '' }
    } finally {
      clearTimeout(t)
    }
  }
  return { domain, status: 404, country: '', phone: '' }
}

async function pMapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      try { out[idx] = await fn(items[idx]) } catch { out[idx] = null as any }
    }
  })
  await Promise.all(workers)
  return out
}

export async function runCountriesOnce(opts: { batchSize?: number } = {}): Promise<{
  total_stores: number
  with_shop_id: number
  pending: number
  processed: number
  distribution: Record<string, number>
}> {
  await checkCookieExpiry()
  const cookieHdr = await partnerCookieHeader()
  const batchSize = opts.batchSize ?? 150

  if (!cookieHdr) {
    throw new Error('No partner cookies stored. Upload them via the dashboard Settings page.')
  }

  // Build shopid_map from two sources:
  // 1. One-time JSON upload stored in partner_cookies table (legacy)
  // 2. partner_managed_stores table (populated by the partner-stores job)
  const mapDoc = await prisma.partnerCookie.findUnique({ where: { id: 'shopid_map' } })
  const uploadedMap: Record<string, string> = (mapDoc?.value as { map?: Record<string, string> } | null)?.map || {}
  const managedRows = await prisma.partnerManagedStore.findMany({ select: { domain: true, shopId: true } })
  const shopidMap: Record<string, string> = { ...uploadedMap }
  for (const r of managedRows) {
    if (r.domain && r.shopId) shopidMap[r.domain.toLowerCase()] = r.shopId
  }

  // Collect domains from events table (active installs only)
  const installRows = await prisma.event.findMany({
    where: { type: 'RELATIONSHIP_INSTALLED' },
    distinct: ['storeUrl'],
    select: { storeUrl: true },
  })
  const uninstallRows = await prisma.event.findMany({
    where: { type: 'RELATIONSHIP_UNINSTALLED' },
    distinct: ['storeUrl'],
    select: { storeUrl: true },
  })
  const uninstalls = new Set<string>(
    uninstallRows.map((r) => r.storeUrl).filter((d): d is string => !!d)
  )
  const eventDomains: string[] = installRows
    .map((r) => r.storeUrl)
    .filter((d): d is string => !!d && d !== '—' && !uninstalls.has(d))
    .map((d) => d.toLowerCase())

  // Also include managed stores (already have shopIds)
  const managedDomains = managedRows
    .map((r) => r.domain?.toLowerCase())
    .filter((d): d is string => !!d && !!shopidMap[d])
  const domains: string[] = Array.from(new Set([...eventDomains, ...managedDomains]))

  const cached = await prisma.storeCountry.findMany({
    select: { domain: true },
  })
  const cachedSet = new Set<string>(cached.map((c) => c.domain))

  const withShopId = domains.filter((d) => shopidMap[d])
  const pending = withShopId.filter((d) => !cachedSet.has(d))
  const batch = pending.slice(0, batchSize)

  const tuples = batch.map((d) => ({ domain: d, shopId: shopidMap[d] }))
  const orgIds = (await listPartners()).map((p) => p.partnerId).filter(Boolean)
  const results = await pMapLimit(tuples, CONCURRENCY, (t) => fetchOne(t.domain, t.shopId, cookieHdr, orgIds))

  const persistTargets = results.filter((r): r is CountryResult => !!r && !!r.domain)
  await pMapLimit(persistTargets, DB_WRITE_CONCURRENCY, async (r) => {
    const data = {
      country: r.country ?? null,
      phone: r.phone ?? null,
      status: r.status ?? null,
      error: r.error ?? null,
    }
    await prisma.storeCountry.upsert({
      where: { domain: r.domain },
      create: { domain: r.domain, ...data },
      update: data,
    })
  })

  const grouped = await prisma.storeCountry.groupBy({
    by: ['country'],
    _count: { _all: true },
  })
  const distribution: Record<string, number> = {}
  for (const g of grouped) {
    const k = g.country || 'Unknown'
    distribution[k] = g._count._all
  }

  return {
    total_stores: domains.length,
    with_shop_id: withShopId.length,
    pending: pending.length,
    processed: batch.length,
    distribution,
  }
}
