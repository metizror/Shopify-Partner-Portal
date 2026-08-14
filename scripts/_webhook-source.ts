import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

// Exact source breakdown per app, using the recorded `source` field
// ('webhook' | 'poller' | 'seed' | 'unknown' for rows predating the field).
async function main() {
  const { prisma } = await import('@/lib/db')

  const apps = await prisma.shopifyApp.findMany({ select: { appId: true, name: true } })
  const nameById = new Map(apps.map((a) => [a.appId, a.name]))

  const grouped = await prisma.shopifyAppEvent.groupBy({
    by: ['appId', 'source'],
    _count: { _all: true },
  })

  const byApp = new Map<string, Record<string, number>>()
  for (const g of grouped) {
    const row = byApp.get(g.appId) || {}
    row[g.source] = g._count._all
    byApp.set(g.appId, row)
  }

  const rows = [...byApp.entries()]
    .map(([appId, counts]) => ({ appId, name: nameById.get(appId) || '(unknown)', counts }))
    .sort((a, b) => (b.counts.webhook || 0) - (a.counts.webhook || 0))

  console.log('\nApp                                  | webhook | poller | seed | unknown | fires instantly?')
  console.log('-------------------------------------|---------|--------|------|---------|-----------------')
  for (const r of rows) {
    const c = r.counts
    const label = `${r.name} (${r.appId})`.padEnd(36).slice(0, 36)
    const instant = (c.webhook || 0) > 0 ? 'YES (webhook live)' : 'no — poller only'
    console.log(`${label} | ${String(c.webhook || 0).padStart(7)} | ${String(c.poller || 0).padStart(6)} | ${String(c.seed || 0).padStart(4)} | ${String(c.unknown || 0).padStart(7)} | ${instant}`)
  }
  console.log('\n"unknown" = rows recorded before the source field was added. New events are tagged exactly.\n')

  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
