// Query helpers for the Customers CRM: the filtered/sorted/paginated list and
// the single-customer detail (identity + revenue + activity timeline + CRM data).

import { prisma } from '@/lib/db'
import { appCatalog, appNameFrom, appOrgFrom, type CatalogApp } from '@/services/app-catalog'
import type { Prisma } from '@prisma/client'

export interface CustomerListParams {
  search?: string | null
  status?: string | null
  appId?: string | null
  tag?: string | null
  country?: string | null
  minMrr?: number | null
  sort?: string | null
  dir?: 'asc' | 'desc' | null
  page?: number
  pageSize?: number
}

const SORTABLE = new Set(['name', 'mrr', 'ltv', 'firstSeen', 'lastSeen', 'status'])

export async function listCustomers(params: CustomerListParams) {
  const page = Math.max(1, params.page || 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 25))

  const where: Prisma.CustomerWhereInput = {}
  if (params.status === 'installed' || params.status === 'uninstalled') where.status = params.status
  if (params.country) where.country = params.country
  if (params.minMrr != null && params.minMrr > 0) where.mrr = { gte: params.minMrr }
  if (params.appId && params.appId !== 'all') where.appIds = { array_contains: params.appId }
  if (params.tag) where.tags = { array_contains: params.tag }
  if (params.search) {
    const s = params.search.trim()
    where.OR = [{ name: { contains: s } }, { domain: { contains: s } }]
  }

  const sortField = SORTABLE.has(params.sort || '') ? (params.sort as string) : 'mrr'
  const dir: 'asc' | 'desc' = params.dir === 'asc' ? 'asc' : 'desc'
  const orderBy: Prisma.CustomerOrderByWithRelationInput = { [sortField]: dir }

  // One catalog read for the whole page rather than a lookup per row.
  const [rows, total, catalog] = await Promise.all([
    prisma.customer.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.customer.count({ where }),
    appCatalog(),
  ])

  return {
    customers: rows.map((r) => shapeCustomerRow(r, catalog)),
    total,
    page,
    pageSize,
    pages: Math.ceil(total / pageSize),
  }
}

function shapeCustomerRow(
  c: {
    domain: string; name: string; status: string; country: string | null; email: string | null
    plan: string | null; appIds: unknown; ltv: number; mrr: number; firstSeen: Date | null
    tags: unknown; accountOwner: string | null
  },
  catalog: Map<string, CatalogApp>,
) {
  const appIds = Array.isArray(c.appIds) ? (c.appIds as string[]) : []
  return {
    domain: c.domain,
    name: c.name,
    status: c.status,
    country: c.country,
    email: c.email,
    plan: c.plan,
    appIds,
    apps: appIds.map((id) => ({ appId: id, name: appNameFrom(catalog, id) })),
    ltv: c.ltv,
    mrr: c.mrr,
    firstSeen: c.firstSeen ? c.firstSeen.toISOString() : null,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
    accountOwner: c.accountOwner,
  }
}

/** Distinct countries + the app catalog, for the list filters. */
export async function customerFacets() {
  const [countryRows, appRows] = await Promise.all([
    prisma.customer.groupBy({ by: ['country'], where: { country: { not: null } }, _count: { _all: true } }),
    prisma.shopifyApp.findMany({ select: { appId: true, name: true } }),
  ])
  const countries = countryRows
    .map((r) => ({ country: r.country as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count)
  const apps = appRows
    .map((a) => ({ appId: a.appId, name: a.name || `App ${a.appId}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { countries, apps }
}

export interface TimelineItem {
  kind: 'event' | 'comment'
  label: string
  detail?: string
  author?: string
  at: string
}

export async function getCustomerDetail(domain: string) {
  const customer = await prisma.customer.findUnique({ where: { domain } })
  if (!customer) return null

  const [contacts, fieldDefs, fieldValues, comments, events, appUsers, snapshots, catalog] = await Promise.all([
    prisma.contact.findMany({ where: { domain }, orderBy: { createdAt: 'asc' } }),
    prisma.customFieldDef.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.customFieldValue.findMany({ where: { domain } }),
    prisma.timelineComment.findMany({ where: { domain }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.event.findMany({ where: { storeUrl: domain }, orderBy: { occurredAt: 'desc' }, take: 60 }),
    prisma.shopifyAppUser.findMany({ where: { domain } }),
    // What each app's own API told us when this store uninstalled — the source
    // of the {{install_date}} / {{plan}} / {{last_user_email}} merge tags.
    prisma.uninstallSnapshot.findMany({ where: { domain }, orderBy: { uninstalledAt: 'desc' } }),
    appCatalog(),
  ])

  const valueByKey = new Map(fieldValues.map((v) => [v.fieldKey, v.value]))
  const customFields = fieldDefs.map((d) => ({
    key: d.key, label: d.label, type: d.type, value: valueByKey.get(d.key) ?? null,
  }))

  // Build a unified activity timeline: auto Partner events + manual comments.
  const EVENT_LABEL: Record<string, string> = {
    RELATIONSHIP_INSTALLED: 'App installed',
    RELATIONSHIP_UNINSTALLED: 'App uninstalled',
    RELATIONSHIP_REACTIVATED: 'App reactivated',
    RELATIONSHIP_DEACTIVATED: 'App deactivated',
    SUBSCRIPTION_CHARGE_ACTIVATED: 'Subscription charge',
  }
  const timeline: TimelineItem[] = [
    ...events.map((e): TimelineItem => ({
      kind: 'event',
      label: `${EVENT_LABEL[e.type] || e.type}${e.appName ? ` · ${e.appName}` : ''}`,
      detail: e.type === 'SUBSCRIPTION_CHARGE_ACTIVATED' && e.planName
        ? `${e.planName}${e.planAmount ? ` — $${e.planAmount}` : ''}`
        : e.reason || undefined,
      at: e.occurredAt.toISOString(),
    })),
    ...comments.map((c): TimelineItem => ({
      kind: 'comment', label: c.body, author: c.author || undefined, at: c.createdAt.toISOString(),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))

  const appIds = Array.isArray(customer.appIds) ? (customer.appIds as string[]) : []

  return {
    domain: customer.domain,
    name: customer.name,
    status: customer.status,
    country: customer.country,
    email: customer.email,
    plan: customer.plan,
    ltv: customer.ltv,
    mrr: customer.mrr,
    firstSeen: customer.firstSeen ? customer.firstSeen.toISOString() : null,
    lastSeen: customer.lastSeen ? customer.lastSeen.toISOString() : null,
    tags: Array.isArray(customer.tags) ? (customer.tags as string[]) : [],
    notes: customer.notes || '',
    accountOwner: customer.accountOwner,
    apps: appIds.map((id) => ({
      appId: id,
      name: appNameFrom(catalog, id),
      org: appOrgFrom(catalog, id),
      status: appUsers.find((u) => u.appId === id)?.status || 'unknown',
    })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role })),
    customFields,
    timeline,
    uninstallData: snapshots.map((s) => ({
      appId: s.appId,
      appName: appNameFrom(catalog, s.appId),
      uninstalledAt: s.uninstalledAt.toISOString(),
      installedAt: s.installedAt ? s.installedAt.toISOString() : null,
      durationText: s.durationText,
      durationDays: s.durationDays,
      planType: s.planType,
      previousPlan: s.previousPlan,
      lastUserEmail: s.lastUserEmail,
      lastUserName: s.lastUserName,
      lastAccessedAt: s.lastAccessedAt ? s.lastAccessedAt.toISOString() : null,
      contactEmail: s.contactEmail,
      fetchStatus: s.fetchStatus,
      fetchError: s.fetchError,
      fetchedAt: s.fetchedAt ? s.fetchedAt.toISOString() : null,
    })),
  }
}
