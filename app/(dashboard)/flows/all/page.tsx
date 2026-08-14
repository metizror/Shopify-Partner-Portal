'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Zap, Trash2, Play, Pause } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { triggerLabel } from '@/services/flow-constants'

const writeHeaders = () => ({ 'Content-Type': 'application/json' })

interface FlowRow {
  id: number; slug: string; name: string; trigger: string; appScope: string; active: boolean
  stepCount: number; runs: number; lastRun: string | null; updatedAt: string
}

export default function AllFlowsPage() {
  const [flows, setFlows] = useState<FlowRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => backendFetch('/api/flows').then((r) => r.json()).then((d) => setFlows(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const toggle = async (f: FlowRow) => {
    setFlows((prev) => prev.map((x) => (x.id === f.id ? { ...x, active: !x.active } : x)))
    await backendFetch(`/api/flows/${f.id}`, { method: 'PATCH', headers: writeHeaders(), body: JSON.stringify({ active: !f.active }) })
  }
  const remove = async (f: FlowRow) => {
    if (!window.confirm(`Delete flow "${f.name}"?`)) return
    await backendFetch(`/api/flows/${f.id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Flows</h1>
          <p className="text-sm text-gray-500 mt-1">{flows.length} automation{flows.length === 1 ? '' : 's'}</p>
        </div>
        <Link href="/flows/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> Create Flow</Link>
      </div>

      <div className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
        ) : flows.length === 0 ? (
          <div className="py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3"><Zap className="h-6 w-6 text-gray-400" /></div>
            <p className="text-gray-500 text-sm">No flows yet.</p>
            <Link href="/flows/new" className="inline-flex items-center gap-1.5 mt-3 text-sm text-purple-600 hover:underline"><Plus className="h-4 w-4" /> Create your first flow</Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {flows.map((f) => (
              <li key={f.id} className="flex items-center gap-4 px-5 py-4 group">
                <span className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${f.active ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-400'}`}><Zap className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <Link href={`/flows/${f.slug}`} className="font-medium text-gray-900 hover:text-purple-700">{f.name}</Link>
                  <div className="text-xs text-gray-400">
                    {triggerLabel(f.trigger)} · {f.stepCount} step{f.stepCount === 1 ? '' : 's'} · {f.runs} run{f.runs === 1 ? '' : 's'}
                    {f.appScope !== 'all' ? ' · scoped' : ''}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${f.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{f.active ? 'Active' : 'Inactive'}</span>
                <button onClick={() => toggle(f)} title={f.active ? 'Pause' : 'Activate'} className="text-gray-400 hover:text-gray-700">
                  {f.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button onClick={() => remove(f)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
