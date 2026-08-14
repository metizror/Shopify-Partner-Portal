// Backfill: take every event whose storeUrl looks like "shop-{id}" and
// resolve it to the real *.myshopify.com domain via the Partner Dashboard
// Shop query (cookie auth).
//
// Also populates store_countries / store_emails from the same lookup.

import '@/lib/env'
import { prisma } from '@/lib/db'
import { partnerCookieHeader } from '@/services/partner-cookies'
import { listPartners } from '@/services/app-catalog'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0'

async function fetchCsrf(orgId: string, cookieHdr: string): Promise<string> {
  const res = await fetch(`https://partners.shopify.com/${orgId}/apps`, {
    headers: { 'User-Agent': UA, Cookie: cookieHdr, Accept: 'text/html' },
  })
  const html = await res.text()
  return html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/)![1]
}

async function gqlShop(orgId: string, cookieHdr: string, csrf: string, shopId: string) {
  const res = await fetch(`https://partners.shopify.com/${orgId}/api/graphql`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, Cookie: cookieHdr, 'Content-Type': 'application/json',
      Origin: 'https://partners.shopify.com',
      Referer: `https://partners.shopify.com/${orgId}/apps`,
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({
      query: `query S($id: ID!) { shop(id: $id) { id name permanentDomain country email planName } }`,
      variables: { id: shopId },
    }),
  })
  const text = await res.text()
  let parsed: any
  try { parsed = JSON.parse(text) } catch { return null }
  return parsed?.data?.shop || null
}

async function main() {
  const cookieHdr = await partnerCookieHeader()
  if (!cookieHdr) throw new Error('No partner cookies')

  // Find unique shop ids needing resolution. The synthetic format is "shop-{id}".
  const placeholderEvents = await prisma.event.findMany({
    where: { storeUrl: { startsWith: 'shop-' } },
    select: { storeUrl: true, appId: true, org: true },
  })
  const idToOrgs = new Map<string, Set<string>>()
  for (const e of placeholderEvents) {
    const id = e.storeUrl!.slice('shop-'.length)
    if (!id) continue
    if (!idToOrgs.has(id)) idToOrgs.set(id, new Set())
    idToOrgs.get(id)!.add(e.org)
  }
  console.log(`[backfill] ${placeholderEvents.length} events with placeholder storeUrl, ${idToOrgs.size} unique shopIds`)

  // Events store the org *name*; the CSRF fetch needs the org *id*.
  const partners = await listPartners()
  const orgNameToId = new Map(partners.map((p) => [p.org, p.partnerId] as const))

  // Pre-fetch a CSRF per orgId we'll need
  const csrfByOrgId = new Map<string, string>()
  for (const p of partners) {
    csrfByOrgId.set(p.partnerId, await fetchCsrf(p.partnerId, cookieHdr))
  }

  let resolved = 0
  let failed = 0
  const concurrency = 6
  const ids = Array.from(idToOrgs.keys())
  let cursor = 0
  const resolvedMap = new Map<string, { permanentDomain: string; country: string | null; email: string | null; name: string }>()

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= ids.length) return
      const shopId = ids[idx]
      const orgsForShop = Array.from(idToOrgs.get(shopId) || [])
      let info: any = null
      for (const orgName of orgsForShop) {
        const orgId = orgNameToId.get(orgName)
        if (!orgId) continue
        info = await gqlShop(orgId, cookieHdr, csrfByOrgId.get(orgId)!, shopId)
        if (info?.permanentDomain) break
      }
      if (info?.permanentDomain) {
        resolved++
        resolvedMap.set(shopId, {
          permanentDomain: String(info.permanentDomain).toLowerCase(),
          country: info.country || null,
          email: info.email || null,
          name: info.name || '',
        })
        if (resolved % 100 === 0) console.log(`[backfill] resolved ${resolved}/${ids.length}`)
      } else {
        failed++
      }
    }
  }))

  console.log(`[backfill] done resolving: ${resolved} ok, ${failed} failed`)

  // Update events: rewrite event_id (because it embeds the storeUrl), storeUrl,
  // storeName when blank.
  let updatedEvents = 0
  for (const [shopId, info] of resolvedMap) {
    const oldStoreUrl = `shop-${shopId}`
    const events = await prisma.event.findMany({
      where: { storeUrl: oldStoreUrl },
      select: { id: true, eventId: true, type: true, appId: true, occurredAt: true, storeName: true },
    })
    for (const ev of events) {
      const newEventId = `${ev.type}::${ev.appId}::${info.permanentDomain}::${ev.occurredAt.toISOString()}`
      try {
        await prisma.event.update({
          where: { id: ev.id },
          data: {
            eventId: newEventId,
            storeUrl: info.permanentDomain,
            storeName: ev.storeName && ev.storeName !== '—' ? ev.storeName : info.name || '—',
          },
        })
        updatedEvents++
      } catch (e: any) {
        // Could be a unique-conflict if a real event for that domain already
        // exists. Delete the placeholder in that case.
        try { await prisma.event.delete({ where: { id: ev.id } }) } catch { /* ignore */ }
      }
    }
  }
  console.log(`[backfill] events rewritten: ${updatedEvents}`)

  // Backfill store_countries / store_emails
  let countryWritten = 0, emailWritten = 0
  for (const info of resolvedMap.values()) {
    if (info.country) {
      try {
        await prisma.storeCountry.upsert({
          where: { domain: info.permanentDomain },
          create: { domain: info.permanentDomain, country: info.country, status: 200 },
          update: { country: info.country, status: 200 },
        })
        countryWritten++
      } catch { /* ignore */ }
    }
    if (info.email) {
      try {
        await prisma.storeEmail.upsert({
          where: { domain: info.permanentDomain },
          create: { domain: info.permanentDomain, email: info.email },
          update: { email: info.email },
        })
        emailWritten++
      } catch { /* ignore */ }
    }
  }
  console.log(`[backfill] store_countries: ${countryWritten} written, store_emails: ${emailWritten} written`)
}

main()
  .catch((e) => { console.error('[backfill] fatal:', e.message || e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
