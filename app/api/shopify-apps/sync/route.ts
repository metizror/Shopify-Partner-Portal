import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { fetchPartnerApps } from '@/services/shopify-partner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/shopify-apps/sync  body: { partnerId?: string }
// Syncs published apps for one partner (if partnerId given) or all partners.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const onlyPartnerId = body.partnerId ? String(body.partnerId) : null

  const partners = await prisma.shopifyPartner.findMany({
    where: onlyPartnerId ? { partnerId: onlyPartnerId } : undefined,
  })
  if (partners.length === 0) {
    return NextResponse.json({ error: 'No matching partner to sync.' }, { status: 404 })
  }

  type SyncResult = { partnerId: string; orgName: string; count?: number; partial?: boolean; error?: string }

  // Partners are synced CONCURRENTLY: each fetchPartnerApps call is an
  // independent, network-bound scan against its own org/token, so overlapping
  // them makes wall-clock ≈ the slowest single partner rather than the sum.
  // Because they overlap, each partner gets the full budget (no dividing by
  // partners.length like the old sequential loop did).
  const budgetMs = 240_000

  const results: SyncResult[] = await Promise.all(
    partners.map(async (partner): Promise<SyncResult> => {
      try {
        const { apps, partial } = await fetchPartnerApps(partner.partnerId, partner.apiToken, { budgetMs })
        const now = new Date()
        // Upserts within a partner are independent rows → run them in parallel too.
        await Promise.all(
          apps.map((app) =>
            prisma.shopifyApp.upsert({
              where: { partnerId_appId: { partnerId: partner.partnerId, appId: app.appId } },
              create: { partnerId: partner.partnerId, appId: app.appId, name: app.name, syncedAt: now, source: 'sync' },
              // Leave `source`/`handle`/`icon` untouched on update.
              update: { name: app.name, syncedAt: now },
            }),
          ),
        )
        // Sync is ADDITIVE ONLY. We deliberately do not delete apps that aren't in
        // this scan: transaction discovery isn't perfectly complete/deterministic
        // for large histories, so auto-removal would drop valid apps. Remove apps
        // manually via the trash button instead.
        return { partnerId: partner.partnerId, orgName: partner.orgName, count: apps.length, partial }
      } catch (e: any) {
        return { partnerId: partner.partnerId, orgName: partner.orgName, error: e?.message || 'Sync failed' }
      }
    }),
  )

  const synced = results.reduce((n, r) => n + (r.count || 0), 0)
  return NextResponse.json({ ok: true, synced, results })
}
