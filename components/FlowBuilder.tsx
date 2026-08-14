'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Zap, Plus, X, Trash2, GitBranch, Play, ChevronRight, Clock, Minus, Maximize2,
  Check, Loader2, Save,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { usePageTitle } from '@/contexts/PageTitleContext'
import RichTextEditor from '@/components/RichTextEditor'
import {
  TRIGGERS, ACTIONS, CONDITION_FIELDS, CONDITION_OPS, DELAY_UNITS, FLOW_PLACEHOLDERS,
  COMMON_PLACEHOLDERS, UNINSTALL_PLACEHOLDERS,
  actionDef, triggerLabel, scheduleLabel, eventEmailKind, EVENT_EMAIL_LABEL,
  type FlowStep, type Schedule,
} from '@/services/flow-constants'

/** Tag groups for the editor dropdown. Every tag is always offered — a flow's
 *  trigger can be changed after the body is written, and an unresolved tag
 *  renders as '' rather than breaking the email. The uninstall group carries a
 *  hint when the current trigger won't populate it. */
function mergeTagGroups(trigger: string | null) {
  return [
    { label: 'Customer', tags: COMMON_PLACEHOLDERS.map((p) => p.key) },
    {
      label: 'Uninstall details',
      tags: UNINSTALL_PLACEHOLDERS.map((p) => p.key),
      hint: trigger === 'customer_uninstalls' ? undefined : 'uninstall flows only',
    },
  ]
}

/** The "Placeholders: …" hint under a body field — driven from the same list. */
function placeholderHint(): string {
  return FLOW_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' ')
}

const writeHeaders = () => ({ 'Content-Type': 'application/json' })
const uid = () => `s${Math.random().toString(36).slice(2, 9)}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const EVENT_NOUN: Record<string, string> = {
  customer_installs: 'install', customer_uninstalls: 'uninstall',
  subscription_activated: 'subscription activation', subscription_cancelled: 'cancellation',
}

const NODE_W = 300
const NODE_H = 92 // anchor height for edges

interface AppOpt { appId: string; name: string }
interface XY { x: number; y: number }
type Node = FlowStep & { parentId?: string }
type Picker =
  | { mode: 'trigger' }
  | { mode: 'choose'; parentId: string }
  | { mode: 'action'; parentId: string }
  | { mode: 'condition'; parentId: string }
  | null

// Old flows saved before branching have no parentId → interpret as a linear chain.
function normalizeSteps(steps: Node[]): Node[] {
  if (steps.some((s) => s.parentId)) return steps
  let prev = 'trigger'
  return steps.map((s) => { const r = { ...s, parentId: prev }; prev = s.id; return r })
}

export default function FlowBuilder({ flowKey, initial }: {
  flowKey?: string
  initial?: { name?: string; trigger?: string; steps?: FlowStep[]; appScope?: string }
}) {
  const router = useRouter()
  const { user } = useAuth()
  const { setTitle } = usePageTitle()

  const [name, setName] = useState(initial?.name || '')
  const [trigger, setTrigger] = useState<string | null>(initial?.trigger || null)
  const [appScope, setAppScope] = useState(initial?.appScope || 'all')
  const [schedule, setSchedule] = useState<Schedule | null>(initial?.trigger === 'scheduled' ? { freq: 'daily', hour: 9, minute: 0 } : null)
  const [scheduleId, setScheduleId] = useState<number | null>(null)
  const [schedules, setSchedules] = useState<(Schedule & { id: number; name: string })[]>([])
  const [active, setActive] = useState(true)
  const [steps, setSteps] = useState<Node[]>(normalizeSteps(initial?.steps || []))
  const [pos, setPos] = useState<Record<string, XY>>({})
  const [apps, setApps] = useState<AppOpt[]>([])
  const [senders, setSenders] = useState<{ id: number; name: string; email: string }[]>([])
  const [templates, setTemplates] = useState<{ id: number; name: string; subject: string }[]>([])
  const [notifyRecipients, setNotifyRecipients] = useState<string[]>([])
  const [picker, setPicker] = useState<Picker>(null)
  const [selected, setSelected] = useState<string | 'trigger' | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!!flowKey)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' | 'info' } | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [runState, setRunState] = useState<Record<string, { status: string; detail?: string }>>({})
  const [running, setRunning] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const showToast = (text: string, kind: 'success' | 'error' | 'info' = 'info') => { setToast({ text, kind }); window.setTimeout(() => setToast(null), 4000) }

  // Canvas transform.
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)

  // Show the flow's name in the global header (and browser tab) for this inner
  // page — falls back to "New Flow" / "Untitled Flow" while unnamed.
  useEffect(() => {
    const t = name.trim() || (flowKey ? 'Untitled Flow' : 'New Flow')
    setTitle(t)
    document.title = `${t} · Flows`
  }, [name, flowKey, setTitle])
  useEffect(() => () => setTitle(null), [setTitle])

  // Load app list + senders.
  useEffect(() => {
    backendFetch('/api/customers?facets=1&pageSize=1').then((r) => r.json()).then((d) => setApps(d?.facets?.apps || [])).catch(() => {})
    backendFetch('/api/email/senders').then((r) => r.json()).then((d) => setSenders(Array.isArray(d) ? d : [])).catch(() => {})
    backendFetch('/api/email/templates').then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {})
    backendFetch('/api/email/recipients').then((r) => r.json()).then((d) => setNotifyRecipients(Array.isArray(d?.emails) ? d.emails : [])).catch(() => {})
    backendFetch('/api/flows/schedules').then((r) => r.json()).then((d) => setSchedules(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Default node positions for a set of steps.
  const layoutFor = useCallback((stepList: FlowStep[], saved?: any): Record<string, XY> => {
    const base: Record<string, XY> = {}
    base['trigger'] = saved?.trigger || { x: 260, y: 40 }
    stepList.forEach((s, i) => {
      base[s.id] = saved?.steps?.[s.id] || { x: base['trigger'].x, y: base['trigger'].y + (i + 1) * 150 }
    })
    return base
  }, [])

  // Init positions for the "new" / template case.
  useEffect(() => {
    if (!flowKey) setPos(layoutFor(initial?.steps || []))
  }, [flowKey, initial, layoutFor])

  // Load existing flow when editing.
  useEffect(() => {
    if (!flowKey) return
    backendFetch(`/api/flows/${flowKey}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) {
          setName(d.name); setTrigger(d.trigger); setAppScope(d.appScope)
          setActive(d.active); setSchedule(d.schedule || null); setScheduleId(d.scheduleId || null)
          const st = normalizeSteps(Array.isArray(d.steps) ? d.steps : [])
          setSteps(st); setPos(layoutFor(st, d.layout))
        }
      })
      .finally(() => setLoading(false))
  }, [flowKey, layoutFor])

  const setNodePos = (id: string, p: XY) => setPos((prev) => ({ ...prev, [id]: p }))

  // Add a node as a CHILD of `parentId` (the node whose + was clicked). Siblings
  // are offset to the right so branches from one node don't overlap.
  const addStep = useCallback((parentId: string, step: Node) => {
    step.parentId = parentId
    const siblings = steps.filter((s) => (s.parentId || 'trigger') === parentId).length
    setSteps((prev) => [...prev, step])
    setPos((pp) => {
      const a = pp[parentId] || { x: 260, y: 40 }
      return { ...pp, [step.id]: { x: a.x + siblings * 340, y: a.y + 170 } }
    })
  }, [steps])
  const updateStep = (id: string, config: Record<string, any>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, config } : s)))
  // Delete a node and reparent its children onto the deleted node's parent, so
  // the rest of that branch stays connected.
  const removeStep = (id: string) => {
    const node = steps.find((s) => s.id === id)
    const np = node?.parentId || 'trigger'
    setSteps((prev) => prev.filter((s) => s.id !== id).map((s) => ((s.parentId || 'trigger') === id ? { ...s, parentId: np } : s)))
    setPos((prev) => { const n = { ...prev }; delete n[id]; return n })
    setSelected(null)
  }

  const save = async (opts?: { stay?: boolean }) => {
    if (!trigger) { setSaveErr('Add a trigger before saving — click “Select a Trigger”.'); showToast('Add a trigger before saving.', 'error'); return }
    if (!name.trim()) { setSaveErr('Enter a flow name at the top, then save.'); showToast('Enter a flow name at the top, then save.', 'error'); nameRef.current?.focus(); return }
    setSaveErr(null)
    setSaving(true)
    const layout = { trigger: pos['trigger'], steps: Object.fromEntries(steps.map((s) => [s.id, pos[s.id]]).filter(([, p]) => p)) }
    const payload = { name, trigger, appScope, active, steps, layout, createdBy: user?.name,
      schedule: !scheduleId ? schedule : null,
      scheduleId }
    const res = flowKey
      ? await backendFetch(`/api/flows/${flowKey}`, { method: 'PATCH', headers: writeHeaders(), body: JSON.stringify(payload) })
      : await backendFetch('/api/flows', { method: 'POST', headers: writeHeaders(), body: JSON.stringify(payload) })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setSaveErr(d.error || 'Could not save the flow. Please try again.'); showToast('Could not save the flow.', 'error'); return }
    // Stay = an in-drawer save: persist but keep editing. A brand-new flow gets a
    // slug back, so route to its editor so subsequent saves PATCH instead of POST.
    if (opts?.stay) {
      showToast('Saved', 'success')
      if (!flowKey) { const d = await res.json().catch(() => ({})); if (d.slug) router.replace(`/flows/${d.slug}`) }
      return
    }
    router.push('/flows/all')
  }

  // Run the flow now. For event flows this runs against the latest UNPROCESSED
  // trigger event (an actual install/uninstall) and animates the nodes. If there
  // is no new event since the last run, it just shows a toast.
  const runNow = async () => {
    if (!flowKey) { setSaveErr('Save the flow first, then run it.'); return }
    setRunning(true); setRunState({ trigger: { status: 'running' } })
    let d: any
    try {
      const r = await backendFetch(`/api/flows/${flowKey}/test`, { method: 'POST', headers: writeHeaders(), body: JSON.stringify({}) })
      d = await r.json()
    } catch { showToast('Run failed — could not reach the server.', 'error'); setRunning(false); setRunState({}); return }
    if (d?.error) { showToast(`Error: ${d.error}`, 'error'); setRunning(false); setRunState({}); return }

    // No new trigger event → nothing to do.
    if (d.ran === false) {
      const noun = EVENT_NOUN[d.trigger] || 'event'
      showToast(`No new ${noun} found for this app since the last run.`, 'info')
      setRunning(false); setRunState({})
      return
    }

    const log: any[] = Array.isArray(d.log) ? d.log : []
    await sleep(450)
    setRunState({ trigger: { status: 'success', detail: d.scheduled ? 'scheduled run' : `on ${d.domain || 'store'}` } })
    for (const l of log) {
      if (!l.id) continue
      setRunState((prev) => ({ ...prev, [l.id]: { status: 'running' } }))
      await sleep(520)
      const status = l.kind === 'condition' ? (l.pass ? 'success' : 'skipped')
        : l.deferred ? 'scheduled'
        : (l.ok === false ? 'failed' : 'success')
      const detail = l.detail
        || (l.deferred ? `queued · ${Math.round((l.runInMs || 0) / 60000)}m` : undefined)
        || (l.kind === 'condition' ? (l.pass ? 'matched' : 'not matched — branch stopped') : undefined)
      setRunState((prev) => ({ ...prev, [l.id]: { status, detail } }))
      await sleep(160)
    }
    showToast(d.scheduled ? `Ran → ${d.status}` : `Ran on ${d.domain} → ${d.status}`, d.status === 'failed' ? 'error' : 'success')
    setRunning(false)
  }

  /* ── drag / pan ────────────────────────────────────────────────────────── */
  const drag = useRef<{ kind: 'node' | 'pan'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    const p = pos[id] || { x: 0, y: 0 }
    drag.current = { kind: 'node', id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, moved: false }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.kind === 'node' && d.id) setNodePos(d.id, { x: d.ox + dx / zoom, y: d.oy + dy / zoom })
    else if (d.kind === 'pan') setPan({ x: d.ox + dx, y: d.oy + dy })
  }
  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    drag.current = null
  }
  const clickIfNotDragged = (fn: () => void) => { if (!drag.current?.moved) fn() }

  const fit = () => { setPan({ x: 0, y: 0 }); setZoom(1) }

  if (loading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
  }

  // Edges: each node connects up to its parent (the node it was created from).
  const edges: [string, string][] = steps.map((s) => [s.parentId || 'trigger', s.id])

  return (
    <div className="relative h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white z-20">
        <button onClick={() => router.push('/flows/all')} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></button>
        <input ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); if (saveErr) setSaveErr(null) }} placeholder="Flow name…"
          className={`flex-1 max-w-sm px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 ${saveErr && !name.trim() ? 'border-red-300' : 'border-gray-200'}`} />
        <div className="flex-1" />
        <button onClick={() => setActive((a) => !a)} className="inline-flex items-center gap-2 text-sm">
          <span className={`relative inline-flex h-5 w-9 rounded-full transition ${active ? 'bg-gray-900' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${active ? 'left-4' : 'left-0.5'}`} />
          </span>
          <span className="text-gray-600">{active ? 'Active' : 'Inactive'}</span>
        </button>
        {flowKey && <button onClick={runNow} disabled={running} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? 'Running…' : 'Run now'}</button>}
        <button onClick={() => router.push('/flows/all')} className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
        <button onClick={() => save()} disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800">
          {saving ? 'Saving…' : 'Save Flow'}
        </button>
      </div>

      {saveErr && (
        <div className="px-4 py-2 text-xs bg-red-50 text-red-700 border-b border-red-100 flex items-center justify-between">
          <span>{saveErr}</span>
          <button onClick={() => setSaveErr(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
          toast.kind === 'success' ? 'bg-emerald-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          {toast.text}
          <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Canvas */}
      <div
        onPointerDown={onCanvasPointerDown}
        className="flex-1 overflow-hidden relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] cursor-grab active:cursor-grabbing"
      >
        {!trigger ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4"><GitBranch className="h-7 w-7 text-gray-400" /></div>
            <h3 className="text-lg font-semibold text-gray-800">Start your workflow</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">Every workflow begins with a trigger. Choose an event that will start this automation.</p>
            <button onClick={() => setPicker({ mode: 'trigger' })}
              className="pointer-events-auto mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800">
              <Zap className="h-4 w-4" /> Select a Trigger
            </button>
          </div>
        ) : (
          <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {/* Edges */}
            <svg className="absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1}>
              {edges.map(([a, b], i) => {
                const pa = pos[a], pb = pos[b]
                if (!pa || !pb) return null
                const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H
                const x2 = pb.x + NODE_W / 2, y2 = pb.y
                const mid = (y1 + y2) / 2
                return <path key={i} d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`} stroke="#cbd5e1" strokeWidth={2} fill="none" />
              })}
            </svg>

            {/* Trigger node */}
            {pos['trigger'] && (
              <NodeCard
                pos={pos['trigger']} icon={Zap} iconClass="bg-blue-500 text-white"
                title={triggerLabel(trigger)}
                subtitle={trigger === 'scheduled'
                  ? (scheduleId ? (schedules.find((s) => s.id === scheduleId)?.name || 'Named schedule') : scheduleLabel(schedule))
                  : `${appScope !== 'all' ? apps.find((a) => a.appId === appScope)?.name || appScope : 'All apps'}${(scheduleId || schedule) ? ` · ${scheduleId ? (schedules.find((s) => s.id === scheduleId)?.name || 'scheduled') : scheduleLabel(schedule)}` : (trigger === 'customer_installs' || trigger === 'customer_uninstalls') ? ' · auto on event' : ' · manual'}`}
                selected={selected === 'trigger'}
                run={runState['trigger']}
                onPointerDown={(e) => onNodePointerDown(e, 'trigger')}
                onClick={() => clickIfNotDragged(() => setSelected('trigger'))}
                onAdd={() => clickIfNotDragged(() => setPicker({ mode: 'choose', parentId: 'trigger' }))}
              />
            )}

            {/* Step nodes */}
            {steps.map((step) => pos[step.id] && (
              <NodeCard
                key={step.id}
                pos={pos[step.id]}
                icon={step.kind === 'condition' ? GitBranch : Play}
                iconClass={step.kind === 'condition' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}
                title={step.kind === 'condition' ? conditionSummary(step) : (actionDef(step.type)?.label || step.type)}
                subtitle={step.kind === 'condition' ? 'Continue only if it matches' : actionSummary(step)}
                selected={selected === step.id}
                run={runState[step.id]}
                badge={step.kind === 'action' && step.config?.delay?.value ? `after ${step.config.delay.value} ${step.config.delay.unit}` : undefined}
                onPointerDown={(e) => onNodePointerDown(e, step.id)}
                onClick={() => clickIfNotDragged(() => setSelected(step.id))}
                onDelete={() => removeStep(step.id)}
                onAdd={() => clickIfNotDragged(() => setPicker({ mode: 'choose', parentId: step.id }))}
              />
            ))}
          </div>
        )}

        {/* Zoom controls */}
        {trigger && (
          <div className="absolute bottom-4 left-4 flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden z-10" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))} className="p-2 hover:bg-gray-50 text-gray-500"><Plus className="h-4 w-4" /></button>
            <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} className="p-2 hover:bg-gray-50 text-gray-500 border-t border-gray-100"><Minus className="h-4 w-4" /></button>
            <button onClick={fit} className="p-2 hover:bg-gray-50 text-gray-500 border-t border-gray-100"><Maximize2 className="h-4 w-4" /></button>
          </div>
        )}
        <div className="absolute bottom-4 right-4 text-[11px] text-gray-400 z-10 pointer-events-none">Drag nodes to move · drag canvas to pan</div>
      </div>

      {/* Pickers + config drawer */}
      {picker?.mode === 'trigger' && (
        <Drawer title="Select trigger" subtitle="Choose what starts this flow" onClose={() => setPicker(null)}>
          {TRIGGERS.map((t) => (
            <PickRow key={t.type} title={t.label} desc={t.desc} onClick={() => {
              setTrigger(t.type)
              if (t.type === 'scheduled') setSchedule((s) => s || { freq: 'daily', hour: 9, minute: 0 })
              setPos((p) => ({ ...p, trigger: p.trigger || { x: 260, y: 40 } })); setPicker(null); setSelected('trigger')
            }} />
          ))}
        </Drawer>
      )}
      {picker?.mode === 'choose' && (
        <Drawer title="Add step" subtitle="Connects to the selected node" onClose={() => setPicker(null)}>
          <PickRow title="Add Condition" desc="Continue only when rules are met" icon={GitBranch}
            onClick={() => setPicker({ mode: 'condition', parentId: picker.parentId })} />
          <PickRow title="Add Action" desc="Do something (email, tag, task…)" icon={Play}
            onClick={() => setPicker({ mode: 'action', parentId: picker.parentId })} />
        </Drawer>
      )}
      {picker?.mode === 'action' && (
        <Drawer title="Select action" subtitle="Choose what happens" onClose={() => setPicker(null)}>
          {ACTIONS.map((a) => (
            <PickRow key={a.type} title={a.label} desc={a.desc}
              onClick={() => { const s: Node = { id: uid(), kind: 'action', type: a.type, config: {} }; addStep(picker.parentId, s); setSelected(s.id); setPicker(null) }} />
          ))}
        </Drawer>
      )}
      {picker?.mode === 'condition' && (
        <Drawer title="Add condition" subtitle="Gate this branch" onClose={() => setPicker(null)}>
          <p className="text-xs text-gray-400 px-1 mb-2">This branch continues only when the condition matches.</p>
          <PickRow title="Field condition" desc="One or more rules (AND / OR)"
            onClick={() => {
              const s: Node = { id: uid(), kind: 'condition', type: 'if', config: { match: 'all', rules: [{ field: 'country', op: 'eq', value: '' }] } }
              addStep(picker.parentId, s); setSelected(s.id); setPicker(null)
            }} />
        </Drawer>
      )}

      {selected === 'trigger' && trigger && (
        <Drawer title={triggerLabel(trigger)} subtitle="Trigger settings" onClose={() => setSelected(null)} onSave={() => save({ stay: true })} saving={saving}>
          {trigger === 'scheduled' ? (
            <div className="space-y-4">
              <ScheduleEditor schedule={schedule} onChange={setSchedule} schedules={schedules} scheduleId={scheduleId}
                onPick={(id) => { setScheduleId(id); if (id) setSchedule(null); else setSchedule((s) => s || { freq: 'daily', hour: 9, minute: 0 }) }} />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Summarize activity for</label>
                <select value={appScope} onChange={(e) => setAppScope(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                  <option value="all">All apps</option>
                  {apps.map((a) => <option key={a.appId} value={a.appId}>{a.name}</option>)}
                </select>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-500">
                <b className="text-gray-600">Digest variables</b> — use these in a <b>Send email → my team</b> action to send a summary of installs/uninstalls since the last run:<br />
                <code>{'{{installs}}'}</code> <code>{'{{uninstalls}}'}</code> <code>{'{{net}}'}</code> <code>{'{{period}}'}</code> <code>{'{{summary}}'}</code> (the list).
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Apply to app</label>
                <select value={appScope} onChange={(e) => setAppScope(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                  <option value="all">All apps</option>
                  {apps.map((a) => <option key={a.appId} value={a.appId}>{a.name}</option>)}
                </select>
              </div>
              {(() => {
                const autoFires = trigger === 'customer_installs' || trigger === 'customer_uninstalls'
                return (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Run this flow</label>
                <select value={(scheduleId || schedule) ? 'schedule' : 'manual'}
                  onChange={(e) => { if (e.target.value === 'manual') { setSchedule(null); setScheduleId(null) } else { setScheduleId(null); setSchedule((s) => s || { freq: 'daily', hour: 9, minute: 0 }) } }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                  <option value="manual">{autoFires ? 'Automatically on each event' : 'Manually only (Run now)'}</option>
                  <option value="schedule">On a schedule (batch)</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  {(scheduleId || schedule)
                    ? 'Runs at the scheduled time, processing each matching event since the last run.'
                    : autoFires
                      ? 'Runs automatically the moment this event happens in Shopify. You can also Run now anytime.'
                      : 'This flow won’t run on its own — it only runs when you click Run now.'}
                </p>
              </div>
                )
              })()}
              {(scheduleId || schedule) && (
                <ScheduleEditor schedule={schedule} onChange={setSchedule} schedules={schedules} scheduleId={scheduleId}
                  onPick={(id) => { setScheduleId(id); if (id) setSchedule(null); else setSchedule((s) => s || { freq: 'daily', hour: 9, minute: 0 }) }} />
              )}
            </div>
          )}
          <button onClick={() => { setTrigger(null); setSelected(null) }} className="mt-4 inline-flex items-center gap-1.5 text-xs text-red-500 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Change trigger</button>
        </Drawer>
      )}
      {selected && selected !== 'trigger' && (() => {
        const step = steps.find((s) => s.id === selected)
        if (!step) return null
        return (
          <Drawer
            title={step.kind === 'condition' ? 'Condition' : (actionDef(step.type)?.label || step.type)}
            subtitle={step.kind === 'condition' ? 'Continue only if it matches' : 'Action settings'}
            onClose={() => setSelected(null)}
            onSave={() => save({ stay: true })}
            saving={saving}
          >
            {step.kind === 'condition'
              ? <ConditionConfig step={step} onChange={(c) => updateStep(step.id, c)} apps={apps} />
              : <ActionConfig step={step} onChange={(c) => updateStep(step.id, c)} senders={senders} templates={templates} notifyRecipients={notifyRecipients} trigger={trigger} />}
            <button onClick={() => removeStep(step.id)} className="mt-5 inline-flex items-center gap-1.5 text-xs text-red-500 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Delete step</button>
          </Drawer>
        )
      })()}
    </div>
  )
}

/* ── summaries ─────────────────────────────────────────────────────────────── */
function ruleList(s: FlowStep): any[] {
  return Array.isArray(s.config?.rules) ? s.config.rules : (s.config?.field ? [s.config] : [])
}
function conditionSummary(s: FlowStep) {
  const rules = ruleList(s)
  if (rules.length === 0) return 'If …'
  if (rules.length === 1) {
    const r = rules[0]
    const f = CONDITION_FIELDS.find((x) => x.key === r.field)?.label || r.field || 'field'
    const op = CONDITION_OPS.find((x) => x.op === r.op)?.label || r.op || ''
    return `If ${f} ${op} ${r.value ?? ''}`.trim()
  }
  return `${rules.length} rules · match ${s.config?.match === 'any' ? 'ANY' : 'ALL'}`
}
function actionSummary(s: FlowStep) {
  const def = actionDef(s.type)
  if (!def) return ''
  if (s.type === 'send_email') {
    const mode = s.config?.sendTo || (s.config?.to ? 'specific' : 'recipients')
    if (mode === 'specific') return s.config?.to ? `to ${String(s.config.to).slice(0, 40)}` : 'to specific addresses'
    if (mode === 'merchant') return 'to the store merchant'
    return 'to my team'
  }
  const first = def.fields[0]
  const v = first ? s.config?.[first.key] : ''
  return v ? String(v).slice(0, 48) : def.desc
}

/* ── presentational ────────────────────────────────────────────────────────── */
function NodeCard({ pos, icon: Icon, iconClass, title, subtitle, selected, onClick, onDelete, onAdd, onPointerDown, badge, run }: {
  pos: XY; icon: React.ElementType; iconClass: string; title: string; subtitle: string
  selected?: boolean; onClick?: () => void; onDelete?: () => void; onAdd?: () => void
  onPointerDown?: (e: React.PointerEvent) => void; badge?: string
  run?: { status: string; detail?: string }
}) {
  const runRing =
    run?.status === 'running' ? 'border-purple-400 ring-2 ring-purple-200 shadow-[0_0_0_4px_rgba(168,85,247,0.12)]'
    : run?.status === 'success' ? 'border-emerald-400 ring-2 ring-emerald-100'
    : run?.status === 'failed' ? 'border-red-400 ring-2 ring-red-100'
    : run?.status === 'scheduled' ? 'border-amber-400 ring-2 ring-amber-100'
    : run?.status === 'skipped' ? 'border-gray-300 opacity-70'
    : selected ? 'border-purple-400 ring-2 ring-purple-100' : 'border-gray-200 hover:border-gray-300'
  return (
    <div className="absolute" style={{ left: pos.x, top: pos.y, width: NODE_W }}>
      <div
        onPointerDown={onPointerDown} onClick={onClick}
        className={`group relative bg-white border rounded-2xl p-4 flex items-start gap-3 cursor-grab active:cursor-grabbing transition ${runRing}`}
      >
        {run && <RunBadge status={run.status} />}
        <span className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconClass}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 leading-tight line-clamp-1">{title}</div>
          <div className="text-sm text-gray-500 mt-0.5 line-clamp-2">{subtitle}</div>
          {run?.detail && (
            <div className={`text-[11px] mt-1 ${run.status === 'failed' ? 'text-red-500' : run.status === 'skipped' ? 'text-gray-400' : run.status === 'scheduled' ? 'text-amber-600' : 'text-emerald-600'}`}>{run.detail}</div>
          )}
          {badge && !run && <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded text-[11px] bg-amber-50 text-amber-700"><Clock className="h-3 w-3" />{badge}</span>}
        </div>
        {onDelete && (
          <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete() }} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
        )}
      </div>
      {/* add button */}
      {onAdd && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAdd() }}
          className="absolute left-1/2 -translate-x-1/2 -bottom-4 h-7 w-7 rounded-full bg-white border border-gray-300 flex items-center justify-center text-gray-500 hover:border-purple-400 hover:text-purple-600 shadow-sm z-10"
        ><Plus className="h-4 w-4" /></button>
      )}
    </div>
  )
}
function RunBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    running: { cls: 'bg-purple-500 text-white', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    success: { cls: 'bg-emerald-500 text-white', icon: <Check className="h-3 w-3" /> },
    failed: { cls: 'bg-red-500 text-white', icon: <X className="h-3 w-3" /> },
    skipped: { cls: 'bg-gray-300 text-white', icon: <Minus className="h-3 w-3" /> },
    scheduled: { cls: 'bg-amber-500 text-white', icon: <Clock className="h-3 w-3" /> },
  }
  const s = map[status]
  if (!s) return null
  return <span className={`absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center shadow ${s.cls}`}>{s.icon}</span>
}
function Drawer({ title, subtitle, onClose, children, onSave, saving }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode
  onSave?: () => void; saving?: boolean
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/10 z-30" onClick={onClose} />
      {/* max-w-lg (not sm) so the rich-text editor's toolbar fits without
          wrapping into three rows when composing an email body. */}
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-white border-l border-gray-200 z-40 shadow-xl flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {onSave && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 bg-gray-50">
            <button
              onClick={onSave}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save</>}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
function PickRow({ title, desc, icon: Icon, onClick }: { title: string; desc: string; icon?: React.ElementType; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-3 rounded-lg hover:bg-gray-50 flex items-center gap-3 group">
      {Icon && <span className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0"><Icon className="h-4 w-4 text-gray-500" /></span>}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span className="block text-xs text-gray-400">{desc}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500" />
    </button>
  )
}

/* ── config panels ─────────────────────────────────────────────────────────── */
type EmailSource = 'builtin' | 'template' | 'custom'

function ActionConfig({ step, onChange, senders, templates, notifyRecipients, trigger }: {
  step: FlowStep; onChange: (c: Record<string, any>) => void
  senders: { id: number; name: string; email: string }[]
  templates: { id: number; name: string; subject: string }[]
  notifyRecipients: string[]; trigger: string | null
}) {
  const def = actionDef(step.type)
  if (!def) return null
  const set = (k: string, v: any) => onChange({ ...step.config, [k]: v })
  const isEmail = step.type === 'send_email'
  // What the email is built from. Install/uninstall flows default to the built-in
  // styled template; anything else defaults to a custom subject/body. Either can
  // be swapped for one of your saved Email → Templates.
  const emailKind = isEmail ? eventEmailKind(trigger) : null
  const stored = step.config?.emailSource
  const source: EmailSource =
    stored === 'builtin' || stored === 'template' || stored === 'custom' ? stored
      : step.config?.templateId ? 'template'
      : emailKind ? 'builtin'
      : 'custom'
  const templateId: number | '' = step.config?.templateId ? Number(step.config.templateId) : ''
  const sendTo: string = step.config?.sendTo || (step.config?.to ? 'specific' : 'recipients')
  return (
    <div className="space-y-4">
      {isEmail && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Send to</label>
            <select value={sendTo} onChange={(e) => set('sendTo', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
              <option value="recipients">Notification recipients (my team)</option>
              <option value="specific">Specific addresses</option>
              <option value="merchant">The store merchant</option>
            </select>
            {sendTo === 'recipients' && (
              <p className="text-[11px] text-gray-400 mt-1">
                {notifyRecipients.length ? `Sends to ${notifyRecipients.length} address${notifyRecipients.length === 1 ? '' : 'es'}: ${notifyRecipients.slice(0, 3).join(', ')}${notifyRecipients.length > 3 ? '…' : ''}. ` : 'No recipients set. '}
                Manage them in <a href="/email/settings" className="text-purple-600 underline">Email → Settings</a>.
              </p>
            )}
            {sendTo === 'merchant' && <p className="text-[11px] text-gray-400 mt-1">Sends to the store’s own email (only if it’s known).</p>}
          </div>
          {sendTo === 'specific' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Addresses (To)</label>
              <textarea value={step.config?.to || ''} onChange={(e) => set('to', e.target.value)} rows={2}
                placeholder="you@company.com, teammate@company.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-200" />
              <p className="text-[11px] text-gray-400 mt-1">Comma-separated — multiple allowed. Use <code>{'{{email}}'}</code> for the merchant.</p>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sender</label>
            <select value={step.config?.senderId ?? ''} onChange={(e) => set('senderId', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
              <option value="">Default sender</option>
              {senders.map((s) => <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;</option>)}
            </select>
          </div>
        </>
      )}
      {isEmail && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email content</label>
          <select value={source} onChange={(e) => set('emailSource', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
            {emailKind && <option value="builtin">Built-in {EVENT_EMAIL_LABEL[emailKind]} template</option>}
            <option value="template">Saved template…</option>
            <option value="custom">Custom subject &amp; body</option>
          </select>
        </div>
      )}

      {isEmail && source === 'builtin' && emailKind && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <p className="text-[11px] font-medium text-emerald-800 mb-1">Uses the built-in {EVENT_EMAIL_LABEL[emailKind]} template</p>
          <p className="text-[11px] text-emerald-600">
            {emailKind === 'install'
              ? 'Sends our standard styled “New App Install” email (app, store, plan details + Book Demo button) automatically. Nothing to write.'
              : 'Sends our standard styled “App Uninstalled” email (app, store, plan details) automatically. Nothing to write.'}
          </p>
        </div>
      )}

      {isEmail && source === 'template' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Template</label>
          <select value={templateId} onChange={(e) => set('templateId', e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
            <option value="">Select a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!templateId
            ? <p className="text-[11px] text-amber-600 mt-1">Pick a template — the flow will fail at run time without one.</p>
            : <p className="text-[11px] text-gray-400 mt-1">Subject: {templates.find((t) => t.id === templateId)?.subject}</p>}
          <p className="text-[11px] text-gray-400 mt-1">
            Build and preview templates in <a href="/email/templates" className="text-purple-600 underline">Email → Templates</a>. Merge tags are filled from the event.
          </p>
        </div>
      )}

      {(!isEmail || source === 'custom') && def.fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
          {f.type === 'richtext'
            ? <RichTextEditor value={step.config?.[f.key] || ''} onChange={(html) => set(f.key, html)} mergeTagGroups={mergeTagGroups(trigger)} minHeight={200} />
            : f.type === 'textarea'
            ? <textarea value={step.config?.[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={4} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-200" />
            : <input value={step.config?.[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200" />}
        </div>
      ))}
      {(!isEmail || source === 'custom') && (
        <>
          <p className="text-[11px] text-gray-400 break-words">Placeholders: {placeholderHint()}</p>
          {trigger === 'customer_uninstalls' && (
            <p className="text-[11px] text-gray-400">
              Uninstall details come from the app&apos;s own API and are captured when the store
              uninstalls. <span className="text-gray-500">{'{{last_user_email}}'}</span> is blank
              for apps that don&apos;t track app users yet — use{' '}
              <span className="text-gray-500">{'{{shop_contact_email}}'}</span> for the store&apos;s
              contact address instead.
            </p>
          )}
        </>
      )}
      {def.hasDelay && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Delay</label>
          <div className="flex gap-2">
            <input type="number" min={0} value={step.config?.delay?.value ?? 0}
              onChange={(e) => set('delay', { value: Number(e.target.value), unit: step.config?.delay?.unit || 'hours' })}
              className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200" />
            <select value={step.config?.delay?.unit || 'hours'}
              onChange={(e) => set('delay', { value: step.config?.delay?.value || 0, unit: e.target.value })}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
              {DELAY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">0 = run immediately.</p>
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function ScheduleEditor({ schedule, onChange, schedules, scheduleId, onPick }: {
  schedule: Schedule | null; onChange: (s: Schedule) => void
  schedules: (Schedule & { id: number; name: string })[]; scheduleId: number | null; onPick: (id: number | null) => void
}) {
  const s: Schedule = schedule || { freq: 'daily', hour: 9, minute: 0 }
  const set = (patch: Partial<Schedule>) => onChange({ ...s, ...patch })
  const cls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200'
  const usingNamed = !!scheduleId
  return (
    <div className="space-y-4">
      {/* Reuse an existing schedule, or set a custom one inline */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Schedule</label>
        <select value={scheduleId ?? ''} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)} className={cls}>
          <option value="">Custom (set below)</option>
          {schedules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          {usingNamed
            ? <>Using a shared schedule. Manage it under <a href="/flows/schedules" className="text-purple-600 underline">Flows → Schedules</a>.</>
            : <>Pick a saved schedule to reuse, or set a custom time below. Save reusable ones under <a href="/flows/schedules" className="text-purple-600 underline">Flows → Schedules</a>.</>}
        </p>
      </div>
      {usingNamed ? null : (<>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Frequency</label>
        <select value={s.freq} onChange={(e) => set({ freq: e.target.value as Schedule['freq'] })} className={cls}>
          <option value="hourly">Every hour</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      {s.freq === 'weekly' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Day of week</label>
          <select value={s.weekday ?? 1} onChange={(e) => set({ weekday: Number(e.target.value) })} className={cls}>
            {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
      )}
      {s.freq !== 'hourly' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Time (IST)</label>
          <div className="flex items-center gap-2">
            <select value={s.hour ?? 9} onChange={(e) => set({ hour: Number(e.target.value) })} className={cls}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
            </select>
            <span className="text-gray-400">:</span>
            <select value={s.minute ?? 0} onChange={(e) => set({ minute: Number(e.target.value) })} className={cls}>
              {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
            </select>
          </div>
        </div>
      )}
      </>)}
      <p className="text-[11px] text-gray-400">Runs once each time (no specific customer) — good for team notifications, digests and tasks. Fires on the next poll after the due time (~5 min granularity).</p>
    </div>
  )
}

function ConditionConfig({ step, onChange, apps }: { step: FlowStep; onChange: (c: Record<string, any>) => void; apps: AppOpt[] }) {
  const rules: any[] = Array.isArray(step.config?.rules) ? step.config.rules : (step.config?.field ? [step.config] : [{ field: 'country', op: 'eq', value: '' }])
  const match = step.config?.match === 'any' ? 'any' : 'all'
  const commit = (nextRules: any[], nextMatch = match) => onChange({ match: nextMatch, rules: nextRules })
  const setRule = (i: number, patch: any) => commit(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRule = () => commit([...rules, { field: 'country', op: 'eq', value: '' }])
  const removeRule = (i: number) => commit(rules.filter((_, j) => j !== i))

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Match</label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['all', 'any'] as const).map((m) => (
            <button key={m} onClick={() => commit(rules, m)}
              className={`flex-1 py-2 ${match === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {m === 'all' ? 'Match ALL (AND)' : 'Match ANY (OR)'}
            </button>
          ))}
        </div>
      </div>
      {rules.map((r, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2 relative">
          {rules.length > 1 && (
            <button onClick={() => removeRule(i)} className="absolute top-2 right-2 text-gray-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
          )}
          <div className="text-[11px] text-gray-400">Rule {i + 1}</div>
          <select value={r.field || 'country'} onChange={(e) => setRule(i, { field: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
            {CONDITION_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select value={r.op || 'eq'} onChange={(e) => setRule(i, { op: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
            {CONDITION_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </select>
          {r.field === 'appId'
            ? <select value={r.value || ''} onChange={(e) => setRule(i, { value: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                <option value="">—</option>
                {apps.map((a) => <option key={a.appId} value={a.appId}>{a.name}</option>)}
              </select>
            : <input value={r.value ?? ''} onChange={(e) => setRule(i, { value: e.target.value })} placeholder="Value"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200" />}
        </div>
      ))}
      <button onClick={addRule} className="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:underline"><Plus className="h-3.5 w-3.5" /> Add rule</button>
    </div>
  )
}
