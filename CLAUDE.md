# Shopify Dashboard — CLAUDE.md

Self-hosted dashboard for Shopify app developers. Connect one or more Partner
organisations and it tracks installs, uninstalls, active stores, app ads and
partner data, then drives email flows, sequences and campaigns off those events.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, `'use client'` on the main page)
- **Database**: MySQL via **Prisma** ORM
- **Styling**: Tailwind CSS
- **Icons**: lucide-react
- **Deployment**: self-hosted — nginx + pm2, via `scripts/deploy.sh`
- **Email**: Brevo API or SMTP — chosen per-installation under Settings → Email
- **AI**: Gemini API (store categorization + keyword suggestions)

---

## Project Structure

```
app/
  page.tsx                  — Main dashboard UI (single giant client component)
  login/page.tsx            — Login page
  api/
    dashboard/route.ts      — GET: build org/app metrics from MySQL events
    sync-app/route.ts       — POST: per-app token-based sync from Shopify Partner API
    jobs/run/[name]/route.ts — POST: trigger named background jobs
    jobs/run/ads-custom/    — POST: custom ad range job
    static/[filename]/      — GET/POST: serve FileBlob files (data.json, etc.)
    users/                  — CRUD for dashboard users
    projects/               — CRUD for internal projects
    automations/            — CRUD for n8n automations
    partners/               — CRUD for partner directory
    cookies/                — Manage partner session cookies
    history/                — Event history
    thresholds/             — Per-app alert thresholds
    health/                 — Health check
    partner-webhook/        — Incoming partner events

components/
  Sidebar.tsx               — Navigation sidebar
  AppAds.tsx                — App Ads tab (Google Ads data)
  ProjectDirectory.tsx      — Projects tab
  AutomationHub.tsx         — Automations tab
  Partners.tsx              — Partners tab
  PartnerStores.tsx         — Partner-managed stores tab
  UserManagement.tsx        — User admin tab

services/
  dashboard-snapshot.ts     — Builds data.json from Shopify Partner API (token-based)
  dashboard-snapshot-from-db.ts — Builds data.json from MySQL events (fallback)
  jobs.ts                   — Job registry; maps job names to service functions
  notify.ts                 — Install/uninstall email alerts via Brevo
  categorize.ts             — Store categorization via Gemini
  countries.ts              — Store country detection
  app-ads.ts                — Google Ads data fetching
  keywords.ts               — Keyword suggestions via Gemini
  partner-managed-stores.ts — Scrape partner-managed stores
  partner-dashboard-scraper.ts — Cookie-based Partner Dashboard scraper
  partner-cookies.ts        — Read/write partner session cookies from DB
  file-blob.ts              — Read/write FileBlob table (JSON/CSV storage)
  shopify-partner.ts        — Shopify Partner API client helpers
  store-email.ts            — Store email lookup
  email-provider.ts         — Delivery layer: picks Brevo API vs SMTP, lists senders
  gemini.ts                 — Gemini API client
  email-templates.ts        — Email HTML templates

lib/
  db.ts                     — Prisma client singleton
  auth.ts                   — requireDashboardPassword() route guard
  api-client.ts             — backendFetch() — rewrites /foo.json → /api/static/foo.json
  env.ts                    — dotenv loader for CLI scripts
  csv.ts                    — CSV helpers

contexts/
  AuthContext.tsx            — Auth state (login, role, canSync, sections, allowedOrgs)

prisma/
  schema.prisma             — MySQL schema (see models below)

public/
  data.json                 — STUB only (epoch timestamps). Real data comes from FileBlob table.
  store_categories.json     — STUB only.
  store_countries.json      — STUB only.
```

---

## Prisma Models (MySQL)

| Model | Purpose |
|---|---|
| `Event` | One row per Shopify Partner event (install/uninstall/charge/etc.) |
| `State` | Generic key/value store. `id='last_sync'` holds `{ timestamp }` |
| `AppSnapshot` | Historical per-app snapshots |
| `StoreCategory` | Store categorization results |
| `StoreCountry` | Store country detection results |
| `StoreEmail` | Store domain → email mapping |
| `FileBlob` | JSON/CSV file storage (replaces filesystem). Key files: `data.json`, `app_ads.json` |
| `AppAd` | Google Ads report rows per range/org |
| `KeywordSuggestion` | Gemini keyword suggestions per app |
| `PartnerCookie` | Shopify Partner session cookies (`id='shopify_partner'`) |
| `PartnerManagedStore` | Stores from Partner Dashboard scrape |
| `Threshold` | Per-app alert thresholds |
| `EmailConfig` | Singleton (`id=1`): which email provider is live + its credentials |
| `User` | Dashboard users (role, sections, canSync, allowedOrgs, etc.) |
| `Project` | Internal dev projects |
| `Automation` | n8n automations |
| `Partner` | Partner/vendor directory |

---

## Key Patterns

### Data Flow
1. Background job (`services/dashboard-snapshot.ts`) fetches from Shopify Partner API → writes to MySQL `Event` table → builds `data.json` shape → saves to `FileBlob` table → saves sync timestamp to `State` table (`id='last_sync'`).
2. Frontend fetches `/api/static/data.json` → reads `FileBlob` row → returns real data.
3. `public/data.json` is a **stub** with epoch timestamps — never rely on it for real data; it only provides TypeScript type inference at module load.

### Static File Serving (`/api/static/[filename]`)
- `store_categories.json` and `store_countries.json` are built live from relational tables (not FileBlob).
- `data.json`, `app_ads.json`, etc. come from the `FileBlob` table via `readBlob()`.
- Falls back to `{}` (or `[]` for partner_managed_stores.json) if not found — never 404.

### Last Updated Timestamp
- Stored in `State` table: `{ id: 'last_sync', value: { timestamp: ISO string } }`.
- Written by both `dashboard-snapshot.ts` and `dashboard-snapshot-from-db.ts` after each sync.
- Read by `GET /api/dashboard` and returned as `last_updated` in the response.
- Frontend `loadAll()` calls `setLastUpdated(newData.last_updated)` after fetch — do NOT rely on `useState(d.last_updated)` initial value (stub is epoch).

### Authentication
- **Browser**: `POST /api/auth/login` verifies email+password against the MySQL `User` table
  server-side and sets `dash_session`, an httpOnly HMAC-signed cookie (`lib/session.ts`,
  signed with `SESSION_SECRET`). The client never holds a password or token — `authHeaders()`
  in the components returns only `Content-Type`. `GET /api/auth/me` re-reads the profile from
  the DB on every page load; `POST /api/auth/logout` expires the cookie.
- **Server-to-server** (crons, scripts, curl): `x-dashboard-password: $DASHBOARD_PASSWORD`.
- `requireDashboardPassword(req)` in `lib/auth.ts` accepts either. `lib/user-profile.ts`
  (`toProfile`) is the single choke point that keeps `password` from ever being serialized —
  `GET /api/users` does not return it.
- **Never put a secret in a `NEXT_PUBLIC_*` var** — Next.js inlines those into the public
  client bundle. `NEXT_PUBLIC_DASHBOARD_PASSWORD` used to do exactly that and has been removed.
- User roles stored in MySQL `User` table. `AuthContext` exposes `canSync`, `canAdd`, `canEdit`, `canDelete`, `sections`, `allowedOrgs`.

### Email delivery
- **Every** send goes through `deliverEmail()` in `services/email-provider.ts` — one
  place decides the transport. `sendBrevoDetailed()` in `services/partner-notify.ts`
  is a thin alias kept for its dozen existing call sites.
- Credentials live in the `EmailConfig` singleton row, edited at `/settings/email`.
  Both providers' credentials persist; `provider` alone picks the live one.
- `getEmailConfig()` merges DB over `BREVO_API_KEY` from env, and swallows a missing
  table, so an un-migrated or pre-upgrade deploy keeps sending instead of hard-failing.
- Never read `process.env.BREVO_API_KEY` directly — use `isEmailConfigured()`.
- `EMAIL_REDIRECT_TO` sends *everything* to one address instead of the real
  recipients (dev safety net; the real ones move into the subject). Must be empty
  in production — every redirected send logs `[email] redirect active`.
- Transport ≠ identity: the from-address still comes from `EmailSender` rows via
  `resolveSender()` / `services/brand.ts`. Settings → Email only *imports* addresses
  into that table (live from `GET /v3/senders`; Brevo-only, SMTP can't enumerate).
  Any address can also be typed in by hand — it is stored `verified:false` and the
  page warns, rather than being refused, because aliases and domain relays are
  legitimate and SMTP lists nothing. `syncProviderSenders()` seeds a default only
  when none exists; it never moves one someone chose.
- **The default `EmailSender` row is the only from-address.** `EMAIL_FROM_ALERTS` /
  `EMAIL_FROM_HELLO` are gone: an address pinned in `.env` silently beat the UI, so
  picking a sender in Settings did nothing and Zoho answered every send with
  `553 Sender is not allowed to relay`. Do not reintroduce an env layer in front of
  `dbSender()`. A per-flow/campaign `senderId` is the supported way to send as a
  second identity — it is visible in the UI.
- Internal alert recipients live in `State` under `notify_recipients`
  (`services/notify-recipients.ts` — its own module so `partner-notify.ts` can read
  it without closing an import cycle through `services/email.ts`). Editable under
  Settings → Email and Email → Settings; `EMAIL_TO` is a first-run fallback only.
  Never read `process.env.EMAIL_TO` directly.
- `nodemailer` must stay a lazy `await import()` inside the SMTP branch — this file is
  reachable from `instrumentation.ts`, which Next also bundles for the edge runtime.

### backendFetch()
- All API calls from the frontend go through `backendFetch()` in `lib/api-client.ts`.
- Rewrites `/foo.json` → `/api/static/foo.json` transparently.
- Always sets `cache: 'no-store'`.

### Toast Notifications
- Lightweight module-level toast system in `app/page.tsx` — no library.
- Call `showToast(message, 'success' | 'error')` from anywhere in the file.
- `<ToastContainer />` is rendered at the Dashboard root.

### Sync Jobs
- Named jobs registered in `services/jobs.ts`.
- Triggered via `POST /api/jobs/run/[name]` (requires `x-dashboard-password`).
- `dashboard` job: checks if tokens set → if yes, uses Shopify Partner API; if no, scrapes Partner Dashboard via cookies stored in DB.
- Sync cooldown tracked in `localStorage('last_sync')` on the frontend (not DB).

### Orgs & Apps Config
- Partner orgs and their apps are **database rows**, not code: `shopify_partners`
  (partnerId, orgName, apiToken) and `shopify_apps` (partnerId, appId, name, handle),
  managed from **Shopify → Partners** in the UI.
- Read them through `services/app-catalog.ts` — `listPartners()`, `partnersWithToken()`,
  `partnersWithApps()`, `appCatalog()`, `appInfo()`. Never reintroduce a hardcoded org
  or app list; `config/index.ts` holds installation-independent constants only.
- For many lookups, take `appCatalog()` once and index the Map (`appNameFrom` /
  `appOrgFrom`) rather than calling `appInfo()` per row.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string |
| `DASHBOARD_PASSWORD` | Yes | Server-side API auth |
| `SESSION_SECRET` | Yes | HMAC key for the session cookie (falls back to `DASHBOARD_PASSWORD`) |

Shopify Partner API tokens are **not** env vars — they live on `shopify_partners` rows,
added via Shopify → Partners.
| `BREVO_API_KEY` | Optional | **Fallback only** — read when no Brevo key is saved in `EmailConfig` |
| `EMAIL_TO` | Optional | **Fallback only** — first-run alert recipients, until a list is saved under Settings → Email |
| `GEMINI_API_KEY` | Optional | Store categorization + keyword suggestions |

All env vars go in `.env` (gitignored, never committed). See `.env.example` for the template.

---

## Common Commands

```bash
# Dev server
npm run dev

# Build (also runs prisma generate)
npm run build          # or: prisma generate && next build

# Prisma
npx prisma generate    # regenerate client after schema changes
npx prisma migrate dev # create + run migration
npx prisma studio      # GUI

# Manually run a job (requires .env.local loaded)
# Hit POST /api/jobs/run/dashboard with x-dashboard-password header
```

---

## Deployment

Self-hosted behind nginx, run under pm2. `scripts/deploy.sh` is the reference
deploy: it pulls, installs, runs `prisma migrate deploy` *before* the build, then
reloads pm2. Paths are overridable — `APP_DIR=… APP_PORT=… bash scripts/deploy.sh`.

There are no serverless function timeouts to work around, so long-running jobs
(countries, partner scrape) can run in-process. The previous `vercel.json` and
its per-route `maxDuration` limits were left over from a Vercel deployment this
project no longer uses, and named three routes that no longer exist.

---

## Important Gotchas

- **`public/data.json` is a stub** — epoch timestamps, empty orgs. Never write real data there.
- **`app/page.tsx` is one large file** — all dashboard UI, helper functions, sub-components (SyncButton, AppDetailPanel, ToastContainer, etc.) live in it.
- **No toast library** — uses a custom module-level `showToast()` + `ToastContainer` defined at the top of `page.tsx`.
- **No mock DB in tests** — integration tests should use a real DB connection.
- **`backendFetch('/data.json')`** hits `/api/static/data.json`, NOT the public file.
- **Partner cookie scrape** is the fallback when no API tokens are set; cookies stored in `PartnerCookie` table with `id='shopify_partner'`.
- **All timestamps** displayed in IST (`Asia/Kolkata`) via `formatIST()` helper in `page.tsx`.
