'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Mail, FileText, Layout, Users, CheckCircle2, Circle, Plus, AlertTriangle } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'

interface Overview {
  templates: number; layouts: number; senders: number; verifiedSenders: number; brevoConfigured: boolean
  steps: { key: string; label: string; done: boolean; optional?: boolean }[]
}

export default function EmailOverviewPage() {
  const [d, setD] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    backendFetch('/api/email/overview').then((r) => r.json()).then((x) => !x.error && setD(x)).finally(() => setLoading(false))
  }, [])

  const doneCount = d?.steps.filter((s) => s.done).length || 0
  const totalSteps = d?.steps.length || 0

  const stats = [
    { label: 'Templates', value: d?.templates ?? 0, icon: FileText, href: '/email/templates' },
    { label: 'Layouts', value: d?.layouts ?? 0, icon: Layout, href: '/email/layouts' },
    { label: 'Senders', value: d?.senders ?? 0, icon: Users, href: '/email/settings' },
  ]

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email</h1>
          <p className="text-sm text-gray-500 mt-1">Layouts, templates and senders for your automated emails</p>
        </div>
        <Link href="/email/templates" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> New Template</Link>
      </div>

      {!loading && d && !d.brevoConfigured && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> <code>BREVO_API_KEY</code> is not set — emails won&apos;t actually send until it is configured.
        </div>
      )}

      {/* Setup checklist */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Set up sending</h3>
          <span className="text-xs text-gray-400">{doneCount} of {totalSteps} done</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: totalSteps ? `${(doneCount / totalSteps) * 100}%` : '0%' }} />
        </div>
        <ul className="space-y-2">
          {d?.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-gray-300" />}
              <span className={s.done ? 'text-gray-500 line-through' : 'text-gray-800'}>{s.label}</span>
              {s.optional && <span className="text-[10px] text-gray-400">optional</span>}
            </li>
          ))}
        </ul>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300">
            <div className="flex items-center justify-between">
              <span className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center"><s.icon className="h-4 w-4 text-gray-500" /></span>
              <Mail className="h-4 w-4 text-gray-200" />
            </div>
            <div className="text-2xl font-semibold text-gray-900 mt-3">{loading ? '—' : s.value}</div>
            <div className="text-sm text-gray-500">{s.label}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
