'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { LayoutGrid, RefreshCw, Building2, Loader2, ExternalLink, Plus, X, Trash2, TrendingUp, TrendingDown, Store } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { slugify } from '@/lib/slug'
import { formatShort } from '@/lib/tz'

interface Partner {
  id: number
  partnerId: string
  orgName: string
}

interface App {
  id: number
  partnerId: string
  appId: string
  name: string
  handle?: string | null
  icon?: string | null
  syncedAt: string
}

interface Counts { installs: number; uninstalls: number; installed: number }
interface EventStats {
  date: string
  byApp: Record<string, Counts>
  byPartner: Record<string, Counts>
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

function formatIST(iso: string): string {
  try {
    return formatShort(iso)
  } catch {
    return iso
  }
}

export default function ShopifyApps() {
  const router = useRouter()
  const [partners, setPartners] = useState<Partner[]>([])
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<string>('all') // 'all' | partnerId
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Per-app install/uninstall stats (today, IST) + installed total.
  const [stats, setStats] = useState<EventStats | null>(null)
  const [refreshingCounts, setRefreshingCounts] = useState(false)
  const [countsProgress, setCountsProgress] = useState({ done: 0, total: 0 })

  // Manual "Add app" modal state.
  const [addOpen, setAddOpen] = useState(false)
  const [addPartnerId, setAddPartnerId] = useState('')
  const [addAppId, setAddAppId] = useState('')
  const [addName, setAddName] = useState('')
  const [addHandle, setAddHandle] = useState('')
  const [addIcon, setAddIcon] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const loadStats = async () => {
    try {
      const r = await backendFetch('/api/shopify-apps/event-stats')
      if (r.ok) setStats(await r.json())
    } catch { /* ignore — counts are best-effort */ }
  }

  const load = async () => {
    try {
      const [pRes, aRes] = await Promise.all([
        backendFetch('/api/shopify-partners'),
        backendFetch('/api/shopify-apps'),
      ])
      if (pRes.ok) setPartners(await pRes.json())
      if (aRes.ok) setApps(await aRes.json())
      await loadStats()
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Keep the live install/uninstall counts fresh while the page is open. This
  // only re-reads the cheap event-stats endpoint (a DB read of webhook events),
  // never a scrape — so it's safe to poll. Pauses while a manual refresh runs.
  useEffect(() => {
    const id = setInterval(() => { if (!refreshingCounts) loadStats() }, 60_000)
    return () => clearInterval(id)
  }, [refreshingCounts])

  // Refresh today's install/uninstall counts for every currently-visible app.
  // Each app is a heavy per-app scrape, so we run them one at a time and show
  // progress, then reload the aggregated stats once.
  const handleRefreshCounts = async () => {
    const targets = filter === 'all' ? apps : apps.filter((a) => a.partnerId === filter)
    if (targets.length === 0) return
    setRefreshingCounts(true)
    setMessage('')
    setError('')
    setCountsProgress({ done: 0, total: targets.length })
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i]
      const slug = a.handle || slugify(a.name) || a.appId
      try {
        const r = await backendFetch(`/api/shopify-apps/by-slug/${encodeURIComponent(slug)}?refresh=1`)
        if (!r.ok) failed++
      } catch {
        failed++
      }
      setCountsProgress({ done: i + 1, total: targets.length })
    }
    await loadStats()
    setRefreshingCounts(false)
    setMessage(
      `Refreshed counts for ${targets.length - failed} of ${targets.length} app${targets.length === 1 ? '' : 's'}.`,
    )
    if (failed) setError(`${failed} app${failed === 1 ? '' : 's'} could not be refreshed.`)
  }

  const handleSync = async () => {
    setSyncing(true)
    setMessage('')
    setError('')
    try {
      const r = await backendFetch('/api/shopify-apps/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(filter === 'all' ? {} : { partnerId: filter }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error || 'Sync failed.')
        return
      }
      const results = data.results || []
      const failed = results.filter((x: any) => x.error)
      const partial = results.some((x: any) => x.partial)
      let msg = `Synced ${data.synced} app${data.synced === 1 ? '' : 's'}.`
      if (partial) msg += ' Some partners have a long sales history — sync again to pick up any remaining apps.'
      setMessage(msg)
      if (failed.length) {
        setError(failed.map((f: any) => `${f.orgName}: ${f.error}`).join(' · '))
      }
      await load()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSyncing(false)
    }
  }

  const openAdd = () => {
    setAddPartnerId(filter !== 'all' ? filter : (partners[0]?.partnerId ?? ''))
    setAddAppId('')
    setAddName('')
    setAddHandle('')
    setAddIcon('')
    setAddError('')
    setAddOpen(true)
  }

  const handleAdd = async () => {
    const appId = addAppId.trim()
    const name = addName.trim()
    if (!addPartnerId || !appId || !name) {
      setAddError('Partner, App ID and App name are required.')
      return
    }
    setAdding(true)
    setAddError('')
    try {
      const r = await backendFetch('/api/shopify-apps', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          partnerId: addPartnerId,
          appId,
          name,
          handle: addHandle.trim(),
          icon: addIcon.trim(),
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setAddError(data.error || 'Could not add the app.')
        return
      }
      setAddOpen(false)
      setMessage(`Added "${data.name}".`)
      setError('')
      await load()
    } catch {
      setAddError('Could not reach the server.')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (app: App) => {
    if (!confirm(`Remove "${app.name}" from the list?`)) return
    try {
      const r = await backendFetch(`/api/shopify-apps/${app.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (r.ok) setApps((prev) => prev.filter((a) => a.id !== app.id))
    } catch { /* ignore */ }
  }

  const partnerName = (pid: string) => partners.find((p) => p.partnerId === pid)?.orgName || `Partner ${pid}`

  // Group apps by partner, honouring the filter.
  const grouped = useMemo(() => {
    const visible = filter === 'all' ? apps : apps.filter((a) => a.partnerId === filter)
    const map = new Map<string, App[]>()
    for (const a of visible) {
      if (!map.has(a.partnerId)) map.set(a.partnerId, [])
      map.get(a.partnerId)!.push(a)
    }
    return [...map.entries()].sort((a, b) => partnerName(a[0]).localeCompare(partnerName(b[0])))
  }, [apps, filter, partners])

  const hasPartners = partners.length > 0

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 w-full">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pt-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <LayoutGrid size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Apps</h1>
            <p className="text-sm text-gray-400">Published apps across your connected partners</p>
          </div>
        </div>

        {hasPartners && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            >
              <option value="all">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.partnerId}>{p.orgName}</option>
              ))}
            </select>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Plus size={15} />
              Add app
            </button>
            <button
              onClick={handleRefreshCounts}
              disabled={refreshingCounts || syncing}
              title="Re-pull today's install/uninstall counts for every app shown"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <RefreshCw size={15} className={refreshingCounts ? 'animate-spin' : ''} />
              {refreshingCounts
                ? `Refreshing… ${countsProgress.done}/${countsProgress.total}`
                : 'Refresh counts'}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync apps'}
            </button>
          </div>
        )}
      </header>

      {(message || error) && (
        <div className="mb-5 space-y-1">
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={26} className="text-emerald-500 animate-spin" />
        </div>
      ) : !hasPartners ? (
        /* No partners connected at all */
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 px-6 py-16 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <Building2 size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">No connected partners</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            Connect a Shopify Partner under <span className="font-medium">Shopify · Partners</span> first, then sync its apps here.
          </p>
        </div>
      ) : grouped.length === 0 ? (
        /* Partners exist but no apps synced yet */
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 px-6 py-16 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <LayoutGrid size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">No apps synced yet</h2>
          <p className="text-sm text-gray-500 max-w-sm mb-6">
            Click <span className="font-medium">Sync apps</span> to pull published apps from
            {filter === 'all' ? ' your connected partners.' : ` ${partnerName(filter)}.`}
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync apps'}
          </button>
        </div>
      ) : (
        /* Apps grouped per partner */
        <div className="space-y-8">
          {grouped.map(([pid, list]) => (
            <section key={pid}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Building2 size={16} className="text-emerald-600" />
                <h2 className="text-sm font-semibold text-gray-900">{partnerName(pid)}</h2>
                <span className="text-xs text-gray-400">({list.length} app{list.length === 1 ? '' : 's'})</span>
                {stats?.byPartner[pid] && (
                  <span className="inline-flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-1"><Store size={12} className="text-gray-400" />{stats.byPartner[pid].installed.toLocaleString()} installed</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600"><TrendingUp size={12} />{stats.byPartner[pid].installs} today</span>
                    <span className="inline-flex items-center gap-1 text-red-500"><TrendingDown size={12} />{stats.byPartner[pid].uninstalls} today</span>
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((app) => (
                  <div
                    key={app.id}
                    onClick={() => router.push(`/shopify/apps/${encodeURIComponent(app.handle || slugify(app.name) || app.appId)}`)}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer transition-all hover:border-emerald-300 hover:shadow-md flex flex-col"
                  >
                    <div className="flex items-start gap-2.5">
                      {app.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={app.icon} alt="" className="w-9 h-9 rounded-lg object-cover border border-gray-200 shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                          <LayoutGrid size={16} className="text-emerald-600" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{app.name}</p>
                        <p className="text-xs text-gray-400">App ID: {app.appId}</p>
                        {app.handle && (
                          <a
                            href={`https://apps.shopify.com/${app.handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-600 hover:underline truncate block"
                          >
                            /{app.handle}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`https://partners.shopify.com/${app.partnerId}/apps/${app.appId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-400 hover:text-emerald-600 hover:bg-gray-50 p-1.5 rounded-md"
                          aria-label="Open in Shopify Partners"
                          title="Open in Shopify Partners"
                        >
                          <ExternalLink size={15} />
                        </a>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(app) }}
                          className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md"
                          aria-label="Delete app"
                          title="Delete app"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Synced timestamp — top of the card */}
                    <p className="mt-2 text-[11px] text-gray-400">Synced {formatIST(app.syncedAt)}</p>

                    {/* Today's install / uninstall counts + installed total — pinned to the bottom */}
                    <div className="mt-auto pt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400"><Store size={11} />Installed</div>
                        <p className="text-sm font-semibold text-gray-900">{(stats?.byApp[app.appId]?.installed ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-600/80"><TrendingUp size={11} />Installs</div>
                        <p className="text-sm font-semibold text-emerald-600">{stats?.byApp[app.appId]?.installs ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-red-50 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-red-500/80"><TrendingDown size={11} />Uninstalls</div>
                        <p className="text-sm font-semibold text-red-500">{stats?.byApp[app.appId]?.uninstalls ?? 0}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Add app modal ──────────────────────────────────────────── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !adding && setAddOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 md:p-7">
            <button
              onClick={() => !adding && setAddOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-md text-gray-400 hover:text-gray-600 disabled:opacity-40"
              aria-label="Close"
              disabled={adding}
            >
              <X size={18} />
            </button>

            <h2 className="text-base font-semibold text-gray-900 mb-1">Add app</h2>
            <p className="text-sm text-gray-500 mb-6">
              Manually add an app with its details. Use this for apps that sync can&apos;t discover (unlisted or zero-sales).
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Partner</label>
                <select
                  value={addPartnerId}
                  onChange={(e) => setAddPartnerId(e.target.value)}
                  disabled={adding}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                >
                  {partners.map((p) => (
                    <option key={p.id} value={p.partnerId}>{p.orgName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">App ID</label>
                <input
                  type="text"
                  value={addAppId}
                  onChange={(e) => setAddAppId(e.target.value)}
                  placeholder="e.g. 52340391937"
                  disabled={adding}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">App name</label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Data Migration"
                  disabled={adding}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  App handle <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={addHandle}
                  onChange={(e) => setAddHandle(e.target.value)}
                  placeholder="e.g. data-migration (App Store slug)"
                  disabled={adding}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Icon URL <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="flex items-center gap-2.5">
                  {addIcon.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={addIcon.trim()} alt="" className="w-9 h-9 rounded-lg object-cover border border-gray-200 shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <LayoutGrid size={16} className="text-emerald-600" />
                    </div>
                  )}
                  <input
                    type="text"
                    value={addIcon}
                    onChange={(e) => setAddIcon(e.target.value)}
                    placeholder="https://…/icon.png"
                    disabled={adding}
                    className="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                  />
                </div>
              </div>
            </div>

            {addError && <p className="mt-4 text-sm text-red-600">{addError}</p>}

            <div className="flex items-center justify-end gap-3 mt-7">
              <button
                onClick={() => !adding && setAddOpen(false)}
                disabled={adding}
                className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={adding}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {adding ? 'Adding…' : 'Add app'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
