import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/db')
  const since = new Date(Date.now() - 3 * 86_400_000)
  const events = await prisma.shopifyAppEvent.findMany({
    where: { occurredAt: { gte: since } },
    orderBy: { occurredAt: 'desc' },
    take: 30,
    select: { appId: true, type: true, storeDomain: true, occurredAt: true, createdAt: true, source: true },
  })
  console.log(`\nLast ${events.length} events (past 3 days):\n`)
  for (const e of events) {
    const gap = ((e.createdAt.getTime() - e.occurredAt.getTime()) / 1000).toFixed(0)
    console.log(`${e.occurredAt.toISOString()} | ${e.type.padEnd(11)} | app ${e.appId.padEnd(12)} | ${(e.storeDomain || '-').padEnd(32)} | src=${e.source} | recorded +${gap}s`)
  }
  console.log()
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
