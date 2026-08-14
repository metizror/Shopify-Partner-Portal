'use client'
import { useParams } from 'next/navigation'
import FlowBuilder from '@/components/FlowBuilder'

// The [id] segment is a flow slug (falls back to the numeric id for old links).
export default function EditFlowPage() {
  const params = useParams()
  const key = String(params.id || '')
  if (!key) return null
  return <FlowBuilder flowKey={key} />
}
