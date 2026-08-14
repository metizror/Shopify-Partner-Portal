// One-off: materialize the Customer table from existing data.
// Usage: npx tsx scripts/backfill-customers.ts
import dotenv from 'dotenv'
dotenv.config({ path: '.env' })

async function main() {
  const { syncCustomers } = await import('@/services/customer-sync')
  const started = Date.now()
  const r = await syncCustomers()
  console.log(JSON.stringify(r, null, 2))
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
