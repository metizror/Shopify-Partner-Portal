'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap, Plus } from 'lucide-react'
import { FLOW_TEMPLATES, triggerLabel } from '@/services/flow-constants'

const CATEGORIES = ['all', 'onboarding', 'engagement', 'internal'] as const

export default function FlowTemplatesPage() {
  const router = useRouter()
  const [cat, setCat] = useState<string>('all')
  const shown = FLOW_TEMPLATES.filter((t) => cat === 'all' || t.category === cat)

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flow Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Get started quickly with pre-built automation templates</p>
        </div>
        <Link href="/flows/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"><Plus className="h-4 w-4" /> Create from Scratch</Link>
      </div>

      <div className="flex gap-2 mt-5">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${cat === c ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'}`}>
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {shown.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
            <div className="flex items-center justify-between">
              <span className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center"><Zap className="h-4 w-4 text-gray-500" /></span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-gray-100 text-gray-500 capitalize">{t.category}</span>
            </div>
            <h3 className="font-semibold text-gray-900 mt-3">{t.name}</h3>
            <p className="text-xs text-gray-400 mt-1">{triggerLabel(t.trigger)} · {t.steps.length} step{t.steps.length === 1 ? '' : 's'}</p>
            <div className="flex-1" />
            <button onClick={() => router.push(`/flows/new?template=${t.id}`)}
              className="mt-4 w-full py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800">Use Template</button>
          </div>
        ))}
      </div>
    </div>
  )
}
