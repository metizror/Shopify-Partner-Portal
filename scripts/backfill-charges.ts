// One-off: backfill the Charge table from the Partner API transactions history.
// Usage: npx tsx scripts/backfill-charges.ts [sinceDays]
import dotenv from 'dotenv'
dotenv.config({ path: '.env' })

async function main() {
  // Dynamic import so env is loaded before @/lib/db reads DATABASE_URL.
  const { syncCharges } = await import('@/services/analytics-sync')
  const sinceDays = process.argv[2] ? parseInt(process.argv[2], 10) : 400
  console.log(`Backfilling charges (sinceDays=${sinceDays})…`)
  const started = Date.now()
  const r = await syncCharges({ fullBackfill: true, sinceDays, budgetMs: 240_000 })
  console.log(JSON.stringify(r, null, 2))
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
