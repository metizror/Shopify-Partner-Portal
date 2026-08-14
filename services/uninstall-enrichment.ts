// Captures what we know about a store at the moment it uninstalls, so a Flow
// email can report install date, plan, how long they used the app, and who last
// opened it.
//
// WHY THIS RUNS AT INGEST AND NOT AT SEND TIME
// A Flow's "Send email" step can carry a delay of days, and a scheduled flow
// batches its events to the next run — up to a week later. Meanwhile Shopify's
// shop/redact fires 48h after uninstall and most app backends drop the shop on
// app/uninstalled. So if we called the app's API when the email was about to
// go out, the data would frequently be gone. We fetch the instant the uninstall
// is first seen, persist it, and Flows read the stored snapshot.
//
// Everything here is best-effort: an uninstall email must still send when the
// app's endpoint is missing, slow or broken — just with blank fields.

import { prisma } from '@/lib/db'
import { fetchShopLookup, type EndpointConfig, type FetchStatus, type ShopLookup } from '@/services/app-data-api'

const DAY_MS = 24 * 3_600_000
const MAX_ATTEMPTS = 6
const RETRY_WINDOW_MS = 7 * DAY_MS

/** Statuses worth trying again — the rest are terminal. */
const RETRYABLE: ReadonlySet<string> = new Set(['pending', 'failed', 'stale', 'no_endpoint'])

export interface CaptureInput {
  appId: string
  domain: string
  occurredAt: string | Date // the Partner uninstall event time
  // The uninstall survey, when the ingest route has it to hand. Omitted on
  // retries — fallbackReason() recovers it from the stored event instead.
  reason?: string | null
  description?: string | null
}

/** Render a day count the way the apps do ("3 years 8 months", "10 days"). */
export function humanDuration(days: number | null): string | null {
  if (days === null || days < 0) return null
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 365) {
    const m = Math.floor(days / 30)
    const d = days % 30
    return d ? `${m} month${m === 1 ? '' : 's'} ${d} day${d === 1 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`
  }
  const y = Math.floor(days / 365)
  const m = Math.floor((days % 365) / 30)
  return m ? `${y} year${y === 1 ? '' : 's'} ${m} month${m === 1 ? '' : 's'}` : `${y} year${y === 1 ? '' : 's'}`
}

/** Load an app's endpoint config, or null when none is set up / it's disabled. */
async function endpointFor(appId: string): Promise<EndpointConfig | null> {
  const row = await prisma.appDataEndpoint.findUnique({ where: { appId } })
  if (!row || !row.enabled || !row.url) return null
  return {
    url: row.url,
    authType: row.authType,
    authHeader: row.authHeader,
    authToken: row.authToken,
    shopParam: row.shopParam,
    timeoutMs: row.timeoutMs,
  }
}

/* ── DB fallbacks ──────────────────────────────────────────────────────────
 * Used when the app's endpoint has no answer (or none is configured), so the
 * email still carries whatever we can source ourselves. */

/** Earliest install we ever recorded for this store+app. */
async function fallbackInstalledAt(appId: string, domain: string): Promise<Date | null> {
  const ev = await prisma.shopifyAppEvent.findFirst({
    where: { appId, storeDomain: domain, type: 'installed' },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  })
  if (ev) return ev.occurredAt

  const appUser = await prisma.shopifyAppUser.findFirst({
    where: { appId, domain },
    select: { installedAt: true },
  })
  if (appUser?.installedAt) return appUser.installedAt

  const cust = await prisma.customer.findUnique({ where: { domain }, select: { firstSeen: true } })
  return cust?.firstSeen ?? null
}

/** Last plan name we saw on a subscription charge event for this store. */
async function fallbackPlan(domain: string): Promise<string | null> {
  const ev = await prisma.event.findFirst({
    where: { storeUrl: domain, type: 'SUBSCRIPTION_CHARGE_ACTIVATED', planName: { not: null } },
    orderBy: { occurredAt: 'desc' },
    select: { planName: true },
  })
  return ev?.planName ?? null
}

/**
 * The uninstall survey for this store+app, from the event the full sync wrote.
 * Matched within a day of the uninstall so a store that installed and left more
 * than once doesn't inherit an older exit's reason. Only needed when the caller
 * didn't pass one — i.e. on retries and on snapshots taken before we started
 * carrying the reason through.
 */
async function fallbackReason(
  appId: string,
  domain: string,
  uninstalledAt: Date,
): Promise<{ reason: string | null; description: string | null }> {
  const ev = await prisma.event.findFirst({
    where: {
      appId,
      storeUrl: domain,
      type: { contains: 'UNINSTALL' },
      occurredAt: {
        gte: new Date(uninstalledAt.getTime() - DAY_MS),
        lte: new Date(uninstalledAt.getTime() + DAY_MS),
      },
      OR: [{ reason: { not: null } }, { description: { not: null } }],
    },
    orderBy: { occurredAt: 'desc' },
    select: { reason: true, description: true },
  })
  return { reason: ev?.reason || null, description: ev?.description || null }
}

/** Store contact address — NOT the last app user. Kept as a separate field. */
async function fallbackContactEmail(domain: string): Promise<string | null> {
  const se = await prisma.storeEmail.findUnique({ where: { domain }, select: { email: true } })
  if (se?.email) return se.email
  const cust = await prisma.customer.findUnique({ where: { domain }, select: { email: true } })
  return cust?.email ?? null
}

/**
 * Fetch (if an endpoint exists), merge over DB fallbacks, and upsert the
 * snapshot. Unique on (appId, domain), so a reinstall→uninstall cycle overwrites
 * rather than accumulating rows.
 */
export async function captureUninstallSnapshot(input: CaptureInput): Promise<FetchStatus> {
  const { appId, domain } = input
  if (!appId || !domain) return 'failed'

  // Our Partner event is the system of record for WHEN the relationship ended;
  // the app's clock may differ, so we never let it override this.
  const uninstalledAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt)

  const cfg = await endpointFor(appId)
  let status: FetchStatus = 'no_endpoint'
  let data: ShopLookup | null = null
  let error: string | null = null

  if (cfg) {
    const res = await fetchShopLookup(cfg, domain)
    status = res.status
    data = res.data
    error = res.error ?? null

    // Track endpoint health so the admin UI can show which apps are misconfigured.
    await prisma.appDataEndpoint
      .update({
        where: { appId },
        data:
          res.status === 'ok' || res.status === 'stale'
            ? { lastOkAt: new Date(), lastError: null }
            : { lastError: `${res.status}: ${res.error || ''}`.slice(0, 1000) },
      })
      .catch(() => {})
  } else {
    error = 'no endpoint configured for this app'
  }

  // ── Merge: app API first, our own data second ──────────────────────────
  const installedAt = data?.installDate ?? (await fallbackInstalledAt(appId, domain))
  const planType = data?.planType ?? (await fallbackPlan(domain))
  const contactEmail = data?.contactEmail ?? (await fallbackContactEmail(domain))

  // Prefer the app's own duration (it already formats it); otherwise derive it.
  let durationDays = data?.durationDays ?? null
  if (durationDays === null && installedAt) {
    durationDays = Math.max(0, Math.floor((uninstalledAt.getTime() - installedAt.getTime()) / DAY_MS))
  }
  const durationText = data?.durationText ?? humanDuration(durationDays)

  // Why they left. Ours alone — the app's API never sees the Shopify survey.
  let uninstallReason = input.reason?.trim() || null
  let reasonDetail = input.description?.trim() || null
  if (!uninstallReason && !reasonDetail) {
    const fb = await fallbackReason(appId, domain, uninstalledAt)
    uninstallReason = fb.reason
    reasonDetail = fb.description
  }

  const now = new Date()
  const existing = await prisma.uninstallSnapshot.findUnique({
    where: { appId_domain: { appId, domain } },
    select: { attempts: true },
  })

  const payload = {
    uninstalledAt,
    installedAt,
    durationDays,
    durationText,
    planType,
    previousPlan: data?.previousPlan ?? null,
    // Deliberately NOT falling back to the store contact — see plan §6. A
    // storefront/contact address is not "the last user who opened the app", and
    // presenting it as one would send the team after the wrong person.
    lastUserEmail: data?.lastUserEmail ?? null,
    lastUserName: data?.lastUserName ?? null,
    lastUserType: data?.lastUserType ?? null,
    lastAccessedAt: data?.lastAccessedAt ?? null,
    contactEmail,
    contactName: data?.contactName ?? null,
    appStatus: data?.appStatus ?? null,
    uninstallReason,
    reasonDetail,
    fetchStatus: status,
    fetchError: error ? error.slice(0, 1000) : null,
    attempts: (existing?.attempts ?? 0) + 1,
    fetchedAt: now,
    raw: (data?.raw ?? null) as any,
  }

  await prisma.uninstallSnapshot.upsert({
    where: { appId_domain: { appId, domain } },
    create: { appId, domain, ...payload },
    update: payload,
  })

  return status
}

/** Read a stored snapshot. Used by the Flow engine when building merge tags. */
export async function loadUninstallSnapshot(appId: string, domain: string) {
  if (!appId || !domain) return null
  return prisma.uninstallSnapshot.findUnique({ where: { appId_domain: { appId, domain } } })
}

/**
 * Re-attempt snapshots that didn't land cleanly — the app was down, or hadn't
 * yet processed its own uninstall webhook ('stale'), or had no endpoint
 * configured when the uninstall happened (so configuring one backfills recent
 * churn). Bounded by attempt count and age, since the app eventually purges the
 * shop and further tries are pointless. Called from the poll cron.
 */
export async function retryPendingSnapshots(
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<{ retried: number; ok: number }> {
  const limit = opts.limit ?? 20
  const deadline = Date.now() + (opts.deadlineMs ?? 15_000)
  const since = new Date(Date.now() - RETRY_WINDOW_MS)

  const rows = await prisma.uninstallSnapshot.findMany({
    where: {
      fetchStatus: { in: [...RETRYABLE] },
      attempts: { lt: MAX_ATTEMPTS },
      uninstalledAt: { gte: since },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { appId: true, domain: true, uninstalledAt: true },
  })

  let retried = 0
  let ok = 0
  for (const row of rows) {
    if (Date.now() >= deadline) break
    retried++
    try {
      const status = await captureUninstallSnapshot({
        appId: row.appId,
        domain: row.domain,
        occurredAt: row.uninstalledAt,
      })
      if (status === 'ok') ok++
    } catch {
      /* best-effort — the attempt counter still advanced */
    }
  }
  return { retried, ok }
}
