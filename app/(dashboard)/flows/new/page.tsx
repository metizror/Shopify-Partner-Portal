'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import FlowBuilder from '@/components/FlowBuilder'
import { FLOW_TEMPLATES } from '@/services/flow-constants'

function NewFlowInner() {
  const sp = useSearchParams()
  const tid = sp.get('template')
  const tpl = tid ? FLOW_TEMPLATES.find((t) => t.id === tid) : null
  const initial = tpl ? { name: tpl.name, trigger: tpl.trigger, steps: tpl.steps } : undefined
  return <FlowBuilder initial={initial} />
}

export default function NewFlowPage() {
  return (
    <Suspense fallback={null}>
      <NewFlowInner />
    </Suspense>
  )
}
