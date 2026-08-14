import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/db')
  const flows = await prisma.flow.findMany({ select: { id: true, name: true, trigger: true, active: true, steps: true } })
  console.log('FLOWS:')
  for (const f of flows) {
    const steps = Array.isArray(f.steps) ? f.steps : []
    console.log(`  #${f.id} "${f.name}" trigger=${f.trigger} active=${f.active} steps=${steps.map((s: any) => s.type || s.kind).join(',')}`)
  }
  console.log('\nFAILED runs (latest 5):')
  const failed = await prisma.flowRun.findMany({ where: { status: 'failed' }, orderBy: { ranAt: 'desc' }, take: 5 })
  for (const r of failed) {
    console.log(`\n=== run ${r.id} | flow ${r.flowId} | ${r.trigger} | ${r.status} | ${r.ranAt.toISOString()} | domain=${r.domain || '-'}`)
    console.log('log:', JSON.stringify(r.log, null, 2))
  }
  if (failed.length === 0) console.log('  (none in this DB)')
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
