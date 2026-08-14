// Which Partner organisations this installation tracks, and which apps belong
// to them.
//
// This used to be a hardcoded ORGS array in config/index.ts: three organisation
// IDs, twelve app IDs, their display names and App Store handles, and one env
// var per organisation for the API token. That made the repo unusable by anyone
// else — a clone came preconfigured for somebody else's apps — and it drifted,
// because apps get added in the Shopify Partner Dashboard and nobody remembers
// to edit a TypeScript file.
//
// The `shopify_partners` and `shopify_apps` tables already held the same facts,
// populated through Shopify → Partners in the UI and refreshed by the app sync.
// They are now the only source. Adding an organisation is a UI action, not a
// code change.
//
// Everything here reads two small tables (tens of rows), so callers that need
// many lookups should take a catalog Map once via appCatalog() and index into
// it, rather than calling appInfo() in a loop.

import { prisma } from '@/lib/db'

export interface CatalogApp {
  appId: string
  name: string
  /** App Store handle, e.g. "easy-shipping-bar". Null when not synced/known. */
  handle: string | null
  partnerId: string
  /** Organisation display name, or '' when the partner row has gone missing. */
  org: string
}

export interface CatalogPartner {
  partnerId: string
  org: string
  apiToken: string
}

/** Every connected partner organisation, including its API token. */
export async function listPartners(): Promise<CatalogPartner[]> {
  const rows = await prisma.shopifyPartner.findMany({
    select: { partnerId: true, orgName: true, apiToken: true },
    orderBy: { id: 'asc' },
  })
  return rows.map((r) => ({ partnerId: r.partnerId, org: r.orgName, apiToken: r.apiToken }))
}

/**
 * Partners that can actually be called: those with a token. Every Partner API
 * caller wants this rather than listPartners() — a partner row with an empty
 * token is a half-finished UI entry, not a sync target.
 */
export async function partnersWithToken(): Promise<CatalogPartner[]> {
  return (await listPartners()).filter((p) => p.partnerId && p.apiToken)
}

export interface PartnerWithApps extends CatalogPartner {
  /** App IDs belonging to this organisation. Empty until the app sync runs. */
  apps: string[]
}

/**
 * Partners together with their app IDs — the shape the old ORGS array had, for
 * the callers that iterate organisations and then their apps. Organisations
 * with no synced apps are included, so a caller can report "connected but not
 * synced" rather than silently skipping them.
 */
export async function partnersWithApps(): Promise<PartnerWithApps[]> {
  const [partners, apps] = await Promise.all([
    listPartners(),
    prisma.shopifyApp.findMany({ select: { partnerId: true, appId: true }, orderBy: { appId: 'asc' } }),
  ])
  const byPartner = new Map<string, string[]>()
  for (const a of apps) {
    const list = byPartner.get(a.partnerId)
    if (list) list.push(a.appId)
    else byPartner.set(a.partnerId, [a.appId])
  }
  return partners.map((p) => ({ ...p, apps: byPartner.get(p.partnerId) || [] }))
}

/**
 * All known apps keyed by appId, each carrying its organisation name. One query
 * per table; call it once and reuse the Map when resolving many apps.
 */
export async function appCatalog(): Promise<Map<string, CatalogApp>> {
  const [apps, partners] = await Promise.all([
    prisma.shopifyApp.findMany({ select: { appId: true, name: true, handle: true, partnerId: true } }),
    prisma.shopifyPartner.findMany({ select: { partnerId: true, orgName: true } }),
  ])
  const orgOf = new Map(partners.map((p) => [p.partnerId, p.orgName]))
  return new Map(
    apps.map((a) => [
      a.appId,
      { appId: a.appId, name: a.name, handle: a.handle, partnerId: a.partnerId, org: orgOf.get(a.partnerId) || '' },
    ]),
  )
}

/**
 * Display name for an app, given a preloaded catalog. Prefers an explicit name
 * the caller already has (from an event row, say), then the catalog, then a
 * readable placeholder — never an empty string, because these land in email
 * subjects.
 */
export function appNameFrom(catalog: Map<string, CatalogApp>, appId: string, fallback?: string | null): string {
  return fallback?.trim() || catalog.get(appId)?.name || `App ${appId}`
}

/** Organisation an app belongs to, given a preloaded catalog. */
export function appOrgFrom(catalog: Map<string, CatalogApp>, appId: string): string {
  return catalog.get(appId)?.org || 'Unknown'
}

/** Name + organisation for a single app. For loops, use appCatalog() instead. */
export async function appInfo(appId: string): Promise<{ name: string; org: string; handle: string | null }> {
  try {
    const app = await prisma.shopifyApp.findFirst({
      where: { appId },
      select: { name: true, handle: true, partnerId: true },
    })
    if (app?.name) {
      const partner = await prisma.shopifyPartner.findFirst({
        where: { partnerId: app.partnerId },
        select: { orgName: true },
      })
      return { name: app.name, org: partner?.orgName || 'Unknown', handle: app.handle }
    }
  } catch {
    // A DB hiccup must not stop an install notification going out — the email
    // is still useful with a placeholder name in it.
  }
  return { name: `App ${appId}`, org: 'Unknown', handle: null }
}

/** Partner/org id owning an app, or 'unknown' if it isn't in the catalog. */
export async function resolvePartnerId(appId: string): Promise<string> {
  const row = await prisma.shopifyApp.findFirst({ where: { appId }, select: { partnerId: true } })
  return row?.partnerId || 'unknown'
}
