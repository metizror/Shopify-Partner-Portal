// Manual-trigger job registry. The legacy node-cron scheduler is gone — these
// jobs only run when the dashboard's "Sync" / "Check Now" buttons hit
// /api/jobs/run/<name>, or when a cron POSTs the same route.
//
// The install/uninstall alert job ("notify") and the data.json snapshot jobs
// ("dashboard", "dashboard-from-db", "categorize", "ads", "keywords") are gone:
// flow-engine sends all email now, and nothing reads data.json.
//
// "countries" and "partner-stores" still run because flow-engine reads
// StoreCountry for the {{country}} merge tag, and countries.ts sources its
// domain list from PartnerManagedStore. Both are cookie-scrape based and need
// rewriting against the Partner API before this can be self-hosted by anyone else.

import { runCountriesOnce } from '@/services/countries'
import { runPartnerManagedStoresOnce } from '@/services/partner-managed-stores'
import { scrapePartnerDashboard, syncRecentEventCounts } from '@/services/partner-dashboard-scraper'
import { syncCharges } from '@/services/analytics-sync'
import { syncCustomers } from '@/services/customer-sync'

interface JobDef {
  name: string
  schedule: string   // legacy cron expression — kept for /api/jobs display
  fn: (opts?: Record<string, any>) => Promise<any>
}

const JOBS: JobDef[] = [
  // Feeds StoreCountry, which flow-engine reads for the {{country}} merge tag.
  { name: 'countries',  schedule: '0 1 * * 0',    fn: runCountriesOnce },
  // Feeds PartnerManagedStore, which is countries.ts's source of store domains.
  { name: 'partner-stores', schedule: '0 3 * * *',    fn: runPartnerManagedStoresOnce },
  { name: 'partner-scrape',   schedule: '*/30 * * * *', fn: (opts) => scrapePartnerDashboard(opts) },
  // Lightweight: refresh "installs/uninstalls today" counts for connected apps.
  { name: 'sync-today',       schedule: '*/20 * * * *', fn: (opts) => syncRecentEventCounts(opts) },
  // Revenue ETL: pull Partner API transactions into the Charge table (Home dashboard).
  { name: 'sync-charges',     schedule: '*/30 * * * *', fn: (opts) => syncCharges(opts) },
  // CRM: materialize the Customer table from ShopifyAppUser + Charge + country/email.
  { name: 'sync-customers',   schedule: '*/30 * * * *', fn: () => syncCustomers() },
]

export async function runJobByName(name: string, opts?: Record<string, any>): Promise<any> {
  const job = JOBS.find((j) => j.name === name)
  if (!job) throw new Error(`unknown job: ${name}`)
  return job.fn(opts)
}

export function listJobs(): Array<{ name: string; schedule: string }> {
  return JOBS.map((j) => ({ name: j.name, schedule: j.schedule }))
}
