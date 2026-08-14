// Next.js instrumentation hook — runs once when the server process boots.
// This is where we register all background cron jobs so they auto-schedule
// without needing an external cron daemon or Vercel Cron.
//
// Next.js calls register() exactly once per server instance, in the Node.js
// runtime only (not edge). All jobs call the same functions as the manual
// /api/jobs/run/<name> endpoints — no duplication of logic.

export async function register() {
  // Only run in the Node.js runtime (not edge workers)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // On in production, off in development, and ENABLE_CRON overrides either way.
  //
  // This used to key off `process.env.VERCEL`, which meant a self-hosted install
  // — the only kind this project supports — scheduled nothing at all. You could
  // finish the whole README, connect a Partner token, and still see the dashboard
  // update only when you clicked Sync by hand.
  //
  // Development is excluded because `next dev` re-registers on reload, and these
  // jobs call the Shopify Partner API and send real email.
  //
  // Run more than one instance (pm2 cluster mode, several replicas) and each one
  // schedules its own copy — set ENABLE_CRON=false on all but one.
  const explicit = process.env.ENABLE_CRON
  const enabled =
    explicit === 'true'  ? true :
    explicit === 'false' ? false :
    process.env.NODE_ENV === 'production'

  if (!enabled) {
    const why = explicit === 'false' ? 'ENABLE_CRON=false' : 'not production (set ENABLE_CRON=true to override)'
    console.log(`[cron] skipped — ${why}`)
    return
  }

  const cron = await import('node-cron')

  // Lazy-import services so they don't bloat the edge bundle
  const { pollPartnerEvents }          = await import('@/services/partner-event-poller')
  const { scrapePartnerDashboard }     = await import('@/services/partner-dashboard-scraper')
  const { runPartnerManagedStoresOnce }= await import('@/services/partner-managed-stores')
  const { runCountriesOnce }           = await import('@/services/countries')

  // Wrap each job so errors never crash the scheduler
  function schedule(expression: string, name: string, fn: () => Promise<any>) {
    cron.schedule(expression, async () => {
      const start = Date.now()
      console.log(`[cron] ${name} starting`)
      try {
        const result = await fn()
        console.log(`[cron] ${name} done in ${Date.now() - start}ms`, JSON.stringify(result).slice(0, 200))
      } catch (err: any) {
        console.error(`[cron] ${name} failed:`, err?.message || err)
      }
    })
    console.log(`[cron] registered "${name}" → ${expression}`)
  }

  // ── Job schedule ────────────────────────────────────────────────────────
  //  Every 5 min — pull install/uninstall events via each partner's API token.
  //  This is the token path, and the one the README's setup leads to; without it
  //  scheduled here, a new install only ever updated from the external crontab in
  //  scripts/poll-events.sh, which nothing told you to set up. The deadline stays
  //  well inside the interval so a slow run can't overlap the next one.
  schedule('*/5 * * * *',  'poll-events',     () => pollPartnerEvents({ notify: true, deadlineMs: 240_000 }))

  //  Every 30 min — scrape Partner Dashboard for events + email + country.
  //  The cookie fallback, for orgs with no API token; no-ops without cookies.
  schedule('*/30 * * * *', 'partner-scrape',  scrapePartnerDashboard)

  //  Daily 3:00 AM — sync Partner Managed Stores list
  schedule('0 3 * * *',    'partner-stores',  runPartnerManagedStoresOnce)

  //  Weekly Sunday 1:00 AM — scrape store countries (feeds the {{country}} tag)
  schedule('0 1 * * 0',    'countries',       runCountriesOnce)

  console.log('[cron] all jobs scheduled ✓')
}
