'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Zap, Play, TrendingUp, CheckCircle2, Plus, LayoutTemplate, History, Clock,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { triggerLabel } from '@/services/flow-constants'

interface Overview {
  totalFlows: number; activeFlows: number; totalRuns: number; successRate: number; pendingTasks: number
  recent: { id: number; flowId: number; flowSlug: string; flowName: string; trigger: string; domain: string | null; status: string; ranAt: string; error?: string | null }[]
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function FlowsOverviewPage() {
  const [d, setD] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  // Auto-refresh KPIs + recent runs so counts update on their own after a flow
  // runs — polls every 15s and on tab focus. First load shows the spinner;
  // later refreshes update silently (no flicker).
  useEffect(() => {
    let alive = true
    const load = () =>
      backendFetch('/api/flows/overview')
        .then((r) => r.json())
        .then((x) => { if (alive && !x.error) setD(x) })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false) })
    load()
    const id = setInterval(load, 15000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const kpis = [
    { label: 'Total Flows', value: d?.totalFlows ?? 0, icon: Zap },
    { label: 'Active Flows', value: d?.activeFlows ?? 0, icon: Play },
    { label: 'Total Runs', value: d?.totalRuns ?? 0, icon: TrendingUp },
    { label: 'Success Rate', value: `${d?.successRate ?? 0}%`, icon: CheckCircle2 },
  ]

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flows Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor your automation workflows and performance</p>
        </div>
        <Link href="/flows/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800">
          <Plus className="h-4 w-4" /> Create Flow
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <span className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center"><k.icon className="h-4 w-4 text-gray-500" /></span>
            </div>
            <div className="text-2xl font-semibold text-gray-900 mt-3">{loading ? '—' : k.value}</div>
            <div className="text-sm text-gray-500">{k.label}</div>
          </div>
        ))}
      </div>

      {d && d.totalFlows === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl mt-6 py-16 flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4"><Zap className="h-7 w-7 text-gray-400" /></div>
          <h3 className="text-lg font-semibold text-gray-800">No flows yet</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md">Create your first automation flow to streamline your workflows. Start from scratch or use one of our templates.</p>
          <div className="flex gap-2 mt-5">
            <Link href="/flows/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> Create Your First Flow</Link>
            <Link href="/flows/templates" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"><LayoutTemplate className="h-4 w-4" /> Browse Templates</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Quick actions */}
          <h3 className="text-sm font-semibold text-gray-700 mt-8 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <QuickAction href="/flows/new" icon={Plus} title="Create Flow" desc="Build a new automation" />
            <QuickAction href="/flows/templates" icon={LayoutTemplate} title="Use Template" desc="Start from a template" />
            <QuickAction href="/flows/all" icon={History} title="View History" desc="Check run logs" />
          </div>

          {/* Recent runs */}
          <div className="bg-white border border-gray-200 rounded-xl mt-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><History className="h-4 w-4 text-gray-400" /> Recent Runs</h3>
              <Link href="/flows/all" className="text-xs text-purple-600 hover:underline">All flows →</Link>
            </div>
            {loading ? (
              <div className="py-12 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
            ) : d && d.recent.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">No runs yet — flows execute when installs / uninstalls / subscriptions happen.</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {d?.recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/flows/${r.flowSlug}`} className="text-sm font-medium text-gray-900 hover:text-purple-700">{r.flowName}</Link>
                      <div className="text-xs text-gray-400">{triggerLabel(r.trigger)}{r.domain ? ` · ${r.domain}` : ''}</div>
                      {r.status === 'failed' && r.error && <div className="text-xs text-red-500 mt-0.5">⚠ {r.error}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <RunStatus status={r.status} />
                      <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(r.ranAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {d && d.pendingTasks > 0 && (
            <p className="text-xs text-gray-400 mt-6 inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {d.pendingTasks} delayed action{d.pendingTasks > 1 ? 's' : ''} scheduled.</p>
          )}
        </>
      )}
    </div>
  )
}

function RunStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-600', skipped: 'bg-gray-100 text-gray-500',
  }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${map[status] || 'bg-gray-100 text-gray-500'}`}>{status}</span>
}
function QuickAction({ href, icon: Icon, title, desc }: { href: string; icon: React.ElementType; title: string; desc: string }) {
  return (
    <Link href={href} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-3 hover:border-gray-300">
      <span className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center"><Icon className="h-5 w-5 text-gray-500" /></span>
      <span>
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span className="block text-xs text-gray-400">{desc}</span>
      </span>
    </Link>
  )
}
