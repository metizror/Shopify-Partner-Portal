// Periodic full-history replay of an app's relationship events to compute the
// EXACT currently-active (installed) store count — cookie-free, via the Partner
// API token. This is the only cookie-free source of the true active count,
// because Shopify exposes no count field and the install events for the
// existing base are older than any window-limited source.
//
// A full replay is heavy (tens of thousands of events, minutes per large app),
// so it can't finish in one 60s serverless invocation. This runs it in RESUMABLE
// CHUNKS: each invocation pages through part of the current app's history,
// folding the latest event per store domain into a checkpoint, and saves its
// cursor. When an app finishes, its exact installed count is written as the
// baseline (app_users_meta:<appId>.baselineInstalled, asOf = now) and the job
// advances to the next app. The 5-min poller then keeps that baseline live with
// deltas between full replays. Cycles repeat on a schedule (default weekly).
//
// State is isolated (dedicated keys) so it never touches the shared Event table
// or affects other features.

import { prisma } from '@/lib/db'
import { SHOPIFY_PARTNER_API_VERSION } from '@/config'

const PROGRESS_ID = 'replay:progress'
const accId = (appId: string) => `replay:acc:${appId}`
const metaId = (appId: string) => `app_users_meta:${appId}`
const TRANSIENT = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// latest state per domain: 'I' install, 'U' uninstall, 'R' reactivate, 'D' deactivate
type Acc = Record<string, { t: 'I' | 'U' | 'R' | 'D'; at: number }>

interface Progress {
  phase: 'idle' | 'running'
  queue: string[]              // appIds remaining in the current cycle
  cursor: string | null        // pagination cursor for the current app
  currentAppId: string | null
  eventsThisApp: number
  startedAt: string | null
  lastRunAt: string | null
  lastCycleCompletedAt: string | null
  nextCycleAfter: number       // epoch ms; don't start a new cycle before this
  lastResult: Record<string, number> // appId -> installed, from the last cycle
}

const TYPE_CODE: Record<string, 'I' | 'U' | 'R' | 'D' | undefined> = {
  RELATIONSHIP_INSTALLED: 'I',
  RELATIONSHIP_UNINSTALLED: 'U',
  RELATIONSHIP_REACTIVATED: 'R',
  RELATIONSHIP_DEACTIVATED: 'D',
}

const REPLAY_QUERY = `query($id: ID!, $after: String) {
  app(id: $id) {
    name
    events(first: 100, after: $after, types: [RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED, RELATIONSHIP_REACTIVATED, RELATIONSHIP_DEACTIVATED]) {
      edges {
        cursor
        node {
          ... on RelationshipInstalled   { type occurredAt shop { myshopifyDomain } }
          ... on RelationshipUninstalled { type occurredAt shop { myshopifyDomain } }
          ... on RelationshipReactivated { type occurredAt shop { myshopifyDomain } }
          ... on RelationshipDeactivated { type occurredAt shop { myshopifyDomain } }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`

async function loadProgress(): Promise<Progress> {
  const row = await prisma.state.findUnique({ where: { id: PROGRESS_ID } })
  const v = row?.value as Partial<Progress> | null
  return {
    phase: v?.phase ?? 'idle',
    queue: v?.queue ?? [],
    cursor: v?.cursor ?? null,
    currentAppId: v?.currentAppId ?? null,
    eventsThisApp: v?.eventsThisApp ?? 0,
    startedAt: v?.startedAt ?? null,
    lastRunAt: v?.lastRunAt ?? null,
    lastCycleCompletedAt: v?.lastCycleCompletedAt ?? null,
    nextCycleAfter: v?.nextCycleAfter ?? 0,
    lastResult: v?.lastResult ?? {},
  }
}

async function saveProgress(p: Progress): Promise<void> {
  await prisma.state.upsert({
    where: { id: PROGRESS_ID },
    create: { id: PROGRESS_ID, value: p as any },
    update: { value: p as any },
  })
}

async function loadAcc(appId: string): Promise<Acc> {
  const row = await prisma.state.findUnique({ where: { id: accId(appId) } })
  return (row?.value as Acc | null) || {}
}
async function saveAcc(appId: string, acc: Acc): Promise<void> {
  await prisma.state.upsert({
    where: { id: accId(appId) },
    create: { id: accId(appId), value: acc as any },
    update: { value: acc as any },
  })
}
async function clearAcc(appId: string): Promise<void> {
  await prisma.state.deleteMany({ where: { id: accId(appId) } })
}

// One page of the current app's history. Returns nodes + next cursor.
async function fetchPage(orgId: string, appId: string, token: string, after: string | null) {
  const url = `https://partners.shopify.com/${orgId}/api/${SHOPIFY_PARTNER_API_VERSION}/graphql.json`
  const gid = `gid://partners/App/${appId}`
  let body: any = null
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: REPLAY_QUERY, variables: { id: gid, after } }),
        signal: AbortSignal.timeout(25_000),
      })
    } catch {
      await sleep(700 * (attempt + 1))
      continue
    }
    if (res.status === 200) { body = await res.json(); break }
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API token')
    if (TRANSIENT.has(res.status)) { await sleep(900 * (attempt + 1)); continue }
    throw new Error(`Partner API error ${res.status}`)
  }
  if (!body) throw new Error('Partner API unreachable')
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Partner API error')
  const conn = body?.data?.app?.events
  return {
    edges: (conn?.edges as any[]) || [],
    hasNextPage: !!conn?.pageInfo?.hasNextPage,
  }
}

function installedFromAcc(acc: Acc): number {
  let n = 0
  for (const d in acc) if (acc[d].t === 'I' || acc[d].t === 'R') n++
  return n
}

export interface ReplayChunkResult {
  status: 'waiting' | 'running' | 'cycle-complete'
  currentAppId: string | null
  eventsThisApp: number
  appsRemaining: number
  finishedApp?: { appId: string; installed: number }
  nextCycleAt?: string
}

/**
 * Advance the replay by one time-boxed chunk. Call on a cron. Pages the current
 * app until the deadline or the app completes; on completion writes the exact
 * installed baseline and moves on. Starts a fresh cycle only once `nextCycleAfter`
 * has passed (or when forced).
 */
export async function runReplayChunk(
  opts: { deadlineMs?: number; cycleIntervalMs?: number; force?: boolean; nowMs?: number } = {},
): Promise<ReplayChunkResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000)
  const cycleInterval = opts.cycleIntervalMs ?? 7 * 24 * 3_600_000 // weekly
  const now = opts.nowMs ?? Date.now()
  const nowIso = new Date(now).toISOString()

  const p = await loadProgress()
  p.lastRunAt = nowIso

  // Start a new cycle if idle and it's time (or forced).
  if (p.phase === 'idle') {
    if (!opts.force && now < p.nextCycleAfter) {
      await saveProgress(p)
      return { status: 'waiting', currentAppId: null, eventsThisApp: 0, appsRemaining: 0, nextCycleAt: new Date(p.nextCycleAfter).toISOString() }
    }
    const apps = await prisma.shopifyApp.findMany({ select: { appId: true } })
    p.phase = 'running'
    p.queue = apps.map((a) => a.appId)
    p.cursor = null
    p.currentAppId = p.queue[0] ?? null
    p.eventsThisApp = 0
    p.startedAt = nowIso
    p.lastResult = {}
  }

  // Token lookup for the current app.
  const partners = await prisma.shopifyPartner.findMany({ select: { partnerId: true, apiToken: true } })
  const appRows = await prisma.shopifyApp.findMany({ select: { appId: true, partnerId: true } })
  const partnerOfApp = new Map(appRows.map((a) => [a.appId, a.partnerId]))
  const tokenOfPartner = new Map(partners.map((pp) => [pp.partnerId, pp.apiToken]))

  // Skip any queued apps with no token.
  while (p.queue.length && !tokenOfPartner.get(partnerOfApp.get(p.queue[0]!) || '')) {
    p.queue.shift()
    p.cursor = null
    p.eventsThisApp = 0
  }
  p.currentAppId = p.queue[0] ?? null

  if (!p.currentAppId) {
    // Nothing to do → close the cycle.
    p.phase = 'idle'
    p.lastCycleCompletedAt = nowIso
    p.nextCycleAfter = now + cycleInterval
    await saveProgress(p)
    return { status: 'cycle-complete', currentAppId: null, eventsThisApp: 0, appsRemaining: 0, nextCycleAt: new Date(p.nextCycleAfter).toISOString() }
  }

  const appId = p.currentAppId
  const orgId = partnerOfApp.get(appId)!
  const token = tokenOfPartner.get(orgId)!
  const acc = await loadAcc(appId)

  let finishedApp: { appId: string; installed: number } | undefined

  // Page until deadline or the app is exhausted.
  while (Date.now() < deadline) {
    const { edges, hasNextPage } = await fetchPage(orgId, appId, token, p.cursor)
    for (const e of edges) {
      const n = e?.node
      const code = TYPE_CODE[n?.type]
      const domain: string | undefined = n?.shop?.myshopifyDomain
      if (!code || !domain || !n?.occurredAt) continue
      const at = new Date(n.occurredAt).getTime()
      const cur = acc[domain]
      if (!cur || at > cur.at) acc[domain] = { t: code, at }
    }
    p.eventsThisApp += edges.length
    const last = edges[edges.length - 1]
    if (!hasNextPage || !last?.cursor) {
      // App complete → write the exact baseline.
      const installed = installedFromAcc(acc)
      const metaRow = await prisma.state.findUnique({ where: { id: metaId(appId) } })
      const prevMeta = (metaRow?.value as any) || {}
      await prisma.state.upsert({
        where: { id: metaId(appId) },
        create: { id: metaId(appId), value: { ...prevMeta, baselineInstalled: installed, baselineAsOf: nowIso, baselineSource: 'full_replay' } as any },
        update: { value: { ...prevMeta, baselineInstalled: installed, baselineAsOf: nowIso, baselineSource: 'full_replay' } as any },
      })
      await clearAcc(appId)
      p.lastResult[appId] = installed
      finishedApp = { appId, installed }
      p.queue.shift()
      p.cursor = null
      p.eventsThisApp = 0
      break
    }
    p.cursor = last.cursor
  }

  // If we stopped mid-app (deadline), persist the partial accumulator + cursor.
  if (!finishedApp) await saveAcc(appId, acc)

  // Close the cycle if the queue is now empty.
  if (p.queue.length === 0) {
    p.phase = 'idle'
    p.currentAppId = null
    p.lastCycleCompletedAt = nowIso
    p.nextCycleAfter = now + cycleInterval
    await saveProgress(p)
    return { status: 'cycle-complete', currentAppId: null, eventsThisApp: 0, appsRemaining: 0, finishedApp, nextCycleAt: new Date(p.nextCycleAfter).toISOString() }
  }

  p.currentAppId = p.queue[0] ?? null
  await saveProgress(p)
  return { status: 'running', currentAppId: p.currentAppId, eventsThisApp: p.eventsThisApp, appsRemaining: p.queue.length, finishedApp }
}

export async function getReplayStatus() {
  const p = await loadProgress()
  return {
    phase: p.phase,
    currentAppId: p.currentAppId,
    appsRemaining: p.queue.length,
    eventsThisApp: p.eventsThisApp,
    startedAt: p.startedAt,
    lastRunAt: p.lastRunAt,
    lastCycleCompletedAt: p.lastCycleCompletedAt,
    nextCycleAt: p.nextCycleAfter ? new Date(p.nextCycleAfter).toISOString() : null,
    lastResult: p.lastResult,
  }
}
