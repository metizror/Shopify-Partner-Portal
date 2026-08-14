'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  LayoutGrid, Building2, Loader2, ExternalLink, ArrowLeft, Store,
  CheckCircle2, XCircle, Search, RefreshCw, ChevronLeft, ChevronRight,
  ShieldCheck, Info,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import AppEndpointConfig from '@/components/AppEndpointConfig'
import { formatShort, today } from '@/lib/tz'

interface AppInfo {
  id: number
  partnerId: string
  appId: string
  name: string
  handle?: string | null
  icon?: string | null
  syncedAt: string
}

interface AppUser {
  domain: string
  name: string
  status: 'installed' | 'uninstalled'
  installedAt?: string | null
  uninstalledAt?: string | null
  uninstallReason?: string | null
  uninstallDescription?: string | null
}

interface TrendPoint {
  date: string
  installs: number
  uninstalls: number
}

interface DetailResponse {
  app: AppInfo
  partnerName: string
  users: AppUser[]
  installed: number
  uninstalled: number
  authoritativeInstalls: number | null
  source: 'partner_dashboard' | 'partner_api'
  trend: TrendPoint[]
  partial: boolean
  cached: boolean
  lastSyncedAt: string | null
  usersError: string | null
}

const PAGE_SIZE = 10

function formatIST(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return formatShort(iso)
  } catch {
    return iso
  }
}

// Shopify returns the churn reason as an enum-ish token (e.g. "NO_LONGER_NEEDED").
// Render it as readable Title Case; pass human text through unchanged.
function formatReason(reason?: string | null): string | null {
  const r = (reason || '').trim()
  if (!r) return null
  if (/^[A-Z0-9_]+$/.test(r)) {
    return r.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return r
}

export default function ShopifyAppDetail() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const slug = params?.slug

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [refreshing, setRefreshing] = useState(false)

  const load = async (opts: { refresh?: boolean } = {}) => {
    if (!slug) return
    if (opts.refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const url = `/api/shopify-apps/by-slug/${encodeURIComponent(slug)}${opts.refresh ? '?refresh=1' : ''}`
      const r = await backendFetch(url)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || 'Could not load this app.')
        return
      }
      setData(d)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { if (slug) load() }, [slug])

  // Today's install / uninstall counts from the Partner API trend, whose buckets
  // are keyed by calendar day in the display zone. Re-pulled on every Refresh.
  const istToday = today()
  const todayPoint = useMemo(() => (data?.trend || []).find((t) => t.date === istToday), [data, istToday])
  const installsToday = todayPoint?.installs ?? 0
  const uninstallsToday = todayPoint?.uninstalls ?? 0

  // Reset to page 1 when the search changes.
  useEffect(() => { setPage(1) }, [search])

  // Installed stores only, plus search — computed client-side.
  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.users.filter((u) => u.status === 'installed')
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((u) => u.domain.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
    return list
  }, [data, search])

  // Uninstalled stores, most recent first — for the churn / reasons section.
  const uninstalls = useMemo(() => {
    if (!data) return []
    return data.users
      .filter((u) => u.status === 'uninstalled')
      .sort((a, b) => (b.uninstalledAt || '').localeCompare(a.uninstalledAt || ''))
  }, [data])

  // Client-side pagination, 10 rows per page.
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = total > 0 ? (safePage - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(safePage * PAGE_SIZE, total)

  const counts = {
    all: data?.users.length ?? 0,
    installed: data?.installed ?? 0,
    uninstalled: data?.uninstalled ?? 0,
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 w-full">
      <button
        onClick={() => router.push('/shopify/apps')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5"
      >
        <ArrowLeft size={16} />
        Back to Apps
      </button>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 size={26} className="text-emerald-500 animate-spin" />
          <p className="text-sm text-gray-400">Loading install data from Shopify… this can take up to a minute the first time.</p>
        </div>
      ) : error && !data ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 px-6 py-16 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : data ? (
        <>
          {/* App header */}
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3.5 min-w-0">
              {data.app.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.app.icon} alt="" className="w-14 h-14 rounded-2xl object-cover border border-gray-200 shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                  <LayoutGrid size={26} className="text-white" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 truncate">{data.app.name}</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-400">
                  <span className="inline-flex items-center gap-1"><Building2 size={13} />{data.partnerName}</span>
                  <span>App ID: {data.app.appId}</span>
                  {data.app.handle && (
                    <a
                      href={`https://apps.shopify.com/${data.app.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
                    >
                      /{data.app.handle}<ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {/* Data source badge */}
                <div className="mt-1.5">
                  {data.source === 'partner_dashboard' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                      <ShieldCheck size={12} />Partner Dashboard · matches your panel
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                      <ShieldCheck size={12} />Live · Shopify Partner API
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
              <button
                onClick={() => load({ refresh: true })}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              {data.lastSyncedAt && (
                <span className="text-[11px] text-gray-400">Updated {formatIST(data.lastSyncedAt)}</span>
              )}
            </div>
          </header>

          {/* Stat cards */}
          <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><CheckCircle2 size={13} className="text-emerald-500" />Installed{data.source === 'partner_dashboard' ? ' (current)' : ''}</div>
              <p className="text-2xl font-bold text-emerald-600">{data.authoritativeInstalls ?? counts.installed}</p>
              {data.authoritativeInstalls != null && data.authoritativeInstalls !== counts.installed && (
                <p className="text-[11px] text-gray-400 mt-0.5">{counts.installed} in list below</p>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><CheckCircle2 size={13} className="text-emerald-500" />Installs today</div>
              <p className="text-2xl font-bold text-emerald-600">{installsToday}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">today (IST) · via Partner API</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><XCircle size={13} className="text-red-400" />Uninstalls today</div>
              <p className="text-2xl font-bold text-red-500">{uninstallsToday}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">today (IST) · via Partner API</p>
            </div>
          </div>

          {data.usersError && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>{data.usersError}</span>
            </div>
          )}
          {data.authoritativeInstalls != null && data.authoritativeInstalls > counts.installed && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>
                <strong>{data.authoritativeInstalls}</strong> stores currently have this app installed (matches your Partner panel).
                The list below shows the <strong>{counts.all}</strong> stores found in recent event history —{' '}
                <strong>{counts.installed}</strong> of them are still installed. Older installs that haven&apos;t had recent
                activity aren&apos;t in the history yet.
              </span>
            </div>
          )}
          {data.partial && (
            <p className="mb-4 text-sm text-amber-600">
              This app has a long history — showing a partial list. Click Refresh to load more.
            </p>
          )}

          {/* Heading + search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Installed stores</h2>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search store…"
                className="pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 w-full sm:w-64"
              />
            </div>
          </div>

          {/* Users table */}
          {visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-300 px-6 py-16 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
                <Store size={26} className="text-emerald-500" />
              </div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">No installed stores to show</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                {search ? 'No installed stores match your search.' : 'No installed stores were found in the fetched history.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-3 font-medium">Store</th>
                      <th className="px-5 py-3 font-medium">Installed on</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((u) => {
                      const resolved = !u.domain.startsWith('shop-')
                      return (
                        <tr key={u.domain} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                                <Store size={14} className="text-emerald-600" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{u.name}</p>
                                {resolved && <p className="text-xs text-gray-400 truncate">{u.domain}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatIST(u.installedAt)}</td>
                          <td className="px-5 py-3">
                            {resolved && (
                              <a
                                href={`https://${u.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-gray-400 hover:text-emerald-600"
                                title="Open store"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Showing <span className="font-medium text-gray-700">{from}</span>–<span className="font-medium text-gray-700">{to}</span> of{' '}
                  <span className="font-medium text-gray-700">{total}</span>
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={15} />Prev
                  </button>
                  {pageNumbers(safePage, totalPages).map((n, i) =>
                    n === '…' ? (
                      <span key={`gap-${i}`} className="px-2 text-gray-400 text-sm">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n as number)}
                        className={`min-w-[34px] px-2 py-1.5 rounded-md text-sm font-medium ${
                          n === safePage
                            ? 'bg-emerald-600 text-white'
                            : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {n}
                      </button>
                    ),
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next<ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Uninstall-enrichment endpoint for this app */}
          <div className="mt-8">
            <AppEndpointConfig appId={data.app.appId} />
          </div>

          {/* Recent uninstalls + churn reasons */}
          {uninstalls.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-4">
                <XCircle size={16} className="text-red-400" />
                <h2 className="text-sm font-semibold text-gray-900">Recent uninstalls</h2>
                <span className="text-xs text-gray-400">({uninstalls.length})</span>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-50">
                {uninstalls.slice(0, 25).map((u) => {
                  const resolved = !u.domain.startsWith('shop-')
                  const reason = formatReason(u.uninstallReason)
                  return (
                    <div key={u.domain} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 px-5 py-3.5">
                      <div className="min-w-0 sm:w-56 shrink-0">
                        <p className="font-medium text-gray-900 truncate">{u.name}</p>
                        {resolved && <p className="text-xs text-gray-400 truncate">{u.domain}</p>}
                        <p className="text-[11px] text-gray-400 mt-0.5">Uninstalled {formatIST(u.uninstalledAt)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        {reason ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-medium">
                            {reason}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-300">No reason given</span>
                        )}
                        {u.uninstallDescription && (
                          <p className="mt-1.5 text-sm text-gray-600 italic">“{u.uninstallDescription}”</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {uninstalls.length > 25 && (
                <p className="mt-2 text-[11px] text-gray-400">Showing the 25 most recent of {uninstalls.length} uninstalls.</p>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

// Build a compact page list like [1, 2, 3, '…', 10] around the current page.
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('…')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push('…')
  pages.push(total)
  return pages
}
