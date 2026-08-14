'use client'

// Sequences list + create wizard (/shopify/sequences).
// A sequence is a batched drip over an imported campaign sheet:
// fresh email → (gap) → follow-up 1 to non-openers → (gap) → follow-up 2,
// batch by batch until every contact has had their turn.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Repeat, Plus, Loader2, AlertCircle, X, Clock, Mail, Eye, MessageSquare,
  ChevronRight, PauseCircle, CheckCircle2, PlayCircle, XCircle, UploadCloud, ExternalLink,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { backendFetch } from '@/lib/api-client'
import { autoVarMap } from '@/lib/campaign'
import { formatDayTime } from '@/lib/tz'

const selCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200'

const authHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json' })

/** Friendly name for a merchant-audience app filter, for default naming. */
const appLabel = (appId: string, apps: { appId: string; name: string }[]) =>
  appId === 'all' ? 'All apps' : apps.find((a) => a.appId === appId)?.name || appId

interface SequenceRow {
  id: number; name: string; campaignId: number | null
  audience?: { source: 'sheet' | 'merchants'; appId?: string | null; trigger?: 'install' | 'uninstall' | 'both' } | null
  status: string
  batchSize: number; gapDays: number; sendHour: number; fu1Days: number; fu2Days: number
  currentCycle: number; totalCycles: number; totalBatches: number
  nextRunAt: string | null; createdAt: string
  stats: { total: number; finished: number; opened: number; replied: number; sent: number; failed: number; queued: number }
}
interface CampaignLite { id: number; name: string; fileName: string; totalCount: number; status: string }
interface TemplateLite { id: number; name: string; subject: string }
interface Sender { id: number; email: string; name: string; isDefault: boolean }

const STATUS_META: Record<string, { badge: string; icon: React.ElementType; label: string }> = {
  running: { badge: 'bg-blue-50 text-blue-700', icon: PlayCircle, label: 'Running' },
  paused: { badge: 'bg-amber-50 text-amber-700', icon: PauseCircle, label: 'Paused' },
  completed: { badge: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2, label: 'Completed' },
  cancelled: { badge: 'bg-gray-100 text-gray-500', icon: XCircle, label: 'Cancelled' },
}

export const formatIST = formatDayTime

export const relTime = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'due now'
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return d > 0 ? `in ${d}d ${h}h` : h > 0 ? `in ${h}h ${m}m` : `in ${m}m`
}

export default function CampaignSequences() {
  const router = useRouter()
  const [rows, setRows] = useState<SequenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await backendFetch('/api/sequences')
      if (r.ok) setRows(await r.json())
    } catch { /* noop */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Repeat size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Email Sequences</h1>
            <p className="text-sm text-gray-500">Batched drip: fresh email → follow-up 1 → follow-up 2, batch by batch</p>
          </div>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          <Plus size={16} /> New sequence
        </button>
      </div>

      {wizardOpen && <SequenceWizard onClose={() => setWizardOpen(false)} onCreated={(id) => router.push(`/shopify/sequences/${id}`)} />}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <Repeat size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-700 mb-1">No sequences yet</p>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Import a sheet on the <Link href="/shopify/campaign" className="text-indigo-600 underline">Campaign</Link> page first,
            then start a sequence to drip fresh + follow-up emails to it in batches.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((s) => {
            const meta = STATUS_META[s.status] || STATUS_META.cancelled
            const Icon = meta.icon
            const pct = s.stats.total ? Math.round((s.stats.finished / s.stats.total) * 100) : 0
            // A triggered sequence has no batches or cycles — it runs until paused.
            const triggered = s.audience?.source === 'merchants'
            const trigLabel = s.audience?.trigger === 'both' ? 'install/uninstall' : s.audience?.trigger || 'install'
            return (
              <Link key={s.id} href={`/shopify/sequences/${s.id}`} className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {triggered
                        ? <>{s.stats.total} enrolled · on {trigLabel} · follow-ups +{s.fu1Days}d, +{s.fu2Days}d at {String(s.sendHour).padStart(2, '0')}:00 IST</>
                        : <>{s.stats.total} contacts · {s.totalBatches} batches of {s.batchSize} · every {s.gapDays}d at {String(s.sendHour).padStart(2, '0')}:00 IST</>}
                    </div>
                  </div>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${meta.badge}`}>
                    <Icon size={12} /> {meta.label}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                  {triggered
                    ? <span className="font-medium">{s.status === 'running' ? 'Armed — waiting for events' : 'Triggered sequence'}</span>
                    : <span className="font-medium">Cycle {Math.min(s.currentCycle, s.totalCycles)} of {s.totalCycles}</span>}
                  {!triggered && s.status === 'running' && s.nextRunAt && (
                    <span className="flex items-center gap-1 text-amber-700"><Clock size={12} /> next {relTime(s.nextRunAt)} · {formatIST(s.nextRunAt)}</span>
                  )}
                </div>

                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <span className="flex items-center gap-1"><Mail size={12} className="text-blue-500" /> {s.stats.sent} sent</span>
                  <span className="flex items-center gap-1"><Eye size={12} className="text-emerald-500" /> {s.stats.opened} opened</span>
                  <span className="flex items-center gap-1"><MessageSquare size={12} className="text-indigo-500" /> {s.stats.replied} replied</span>
                  {s.stats.queued > 0 && <span className="text-amber-600">{s.stats.queued} queued</span>}
                  {s.stats.failed > 0 && <span className="text-red-600">{s.stats.failed} failed</span>}
                  <ChevronRight size={14} className="ml-auto text-gray-300" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Create wizard ────────────────────────────────────────────────────────────

// Parse the first sheet of an uploaded workbook into headers + row objects —
// the same shape the Campaign import page produces, so both paths save
// identical campaigns (and both get the same dedupe/validation server-side).
function parseSheetFile(buf: ArrayBuffer): { sheetName: string; headers: string[]; rows: Record<string, string>[] } {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no sheets.')
  const matrix: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const nonEmpty = matrix.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (nonEmpty.length < 2) throw new Error('The sheet needs a header row plus at least one data row.')
  const headers = nonEmpty[0].map((c, i) => String(c).trim() || `Column ${i + 1}`)
  const rows = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim() })
    return obj
  })
  return { sheetName, headers, rows }
}

function SequenceWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  // Which step's "+ New template" was clicked. Holds the setters for that slot so
  // the freshly created template drops straight into it.
  const [tplModal, setTplModal] = useState<{ label: string; apply: (id: number, subject: string) => void } | null>(null)

  // Where the contacts come from. 'sheet' is the batched drip over an imported
  // file; 'merchants' is event-triggered — a store joins when it installs or
  // uninstalls and gets the fresh email straight away.
  const [source, setSource] = useState<'sheet' | 'merchants'>('sheet')
  const [apps, setApps] = useState<{ appId: string; name: string }[]>([])
  const [mAppId, setMAppId] = useState<string>('all')
  const [mTrigger, setMTrigger] = useState<'install' | 'uninstall' | 'both'>('install')
  const [fu1Days, setFu1Days] = useState(2)
  const [fu2Days, setFu2Days] = useState(3)

  const [campaignId, setCampaignId] = useState<number | ''>('')
  const [eligibleCount, setEligibleCount] = useState<number | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [name, setName] = useState('')
  const [batchSize, setBatchSize] = useState(25)
  const [gapDays, setGapDays] = useState(2)
  const [sendHour, setSendHour] = useState(10)
  const [startNow, setStartNow] = useState(true)
  const [senderId, setSenderId] = useState<number | ''>('')
  const [ack, setAck] = useState(false)

  const [freshTemplateId, setFreshTemplateId] = useState<number | ''>('')
  const [freshSubject, setFreshSubject] = useState('')
  const [fu1TemplateId, setFu1TemplateId] = useState<number | ''>('')
  const [fu1Subject, setFu1Subject] = useState('')
  const [fu2TemplateId, setFu2TemplateId] = useState<number | ''>('')
  const [fu2Subject, setFu2Subject] = useState('')

  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadCampaigns = () =>
    backendFetch('/api/campaigns').then((r) => { if (r.ok) r.json().then(setCampaigns) }).catch(() => {})

  // Import a sheet right here: parse it client-side, save it as a campaign
  // (identical to the Campaign page's import) and auto-select it as the source.
  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error || new Error('Could not read file'))
        reader.readAsArrayBuffer(file)
      })
      const parsed = parseSheetFile(buf)
      const res = await backendFetch('/api/campaigns', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          sheetName: parsed.sheetName,
          headers: parsed.headers,
          rows: parsed.rows,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.id) { setError(d.error || 'Could not save the sheet.'); return }
      await loadCampaigns()
      setCampaignId(d.id)
    } catch (e: any) {
      setError(e?.message || 'Could not read that file. Use a .xlsx, .xls or .csv export.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const loadTemplates = () =>
    backendFetch('/api/email/templates').then((r) => { if (r.ok) r.json().then(setTemplates) }).catch(() => {})

  useEffect(() => {
    loadCampaigns()
    loadTemplates()
    backendFetch('/api/email/senders').then((r) => { if (r.ok) r.json().then((s: Sender[]) => {
      setSenders(s)
      setSenderId((cur) => cur || s.find((x) => x.isDefault)?.id || s[0]?.id || '')
    }) }).catch(() => {})
  }, [])

  // App list for the merchant filter — same facets the Merchants page uses.
  useEffect(() => {
    backendFetch('/api/customers?facets=1&pageSize=1')
      .then((r) => { if (r.ok) r.json().then((d) => setApps(d.facets?.apps || [])) })
      .catch(() => {})
  }, [])

  // Default name for a triggered sequence. There's no count to preview — a
  // merchant sequence starts empty and fills up as events arrive.
  useEffect(() => {
    if (source !== 'merchants') return
    const verb = mTrigger === 'both' ? 'install/uninstall' : mTrigger
    setName((cur) => cur.trim() ? cur : `${appLabel(mAppId, apps)} ${verb} sequence`)
  }, [source, mAppId, mTrigger, apps]) // eslint-disable-line react-hooks/exhaustive-deps

  // When a source sheet is picked, pull its headers + eligible contact count.
  useEffect(() => {
    if (source !== 'sheet') return
    if (!campaignId) { setEligibleCount(null); setHeaders([]); return }
    backendFetch(`/api/campaigns/${campaignId}?limit=2000`).then((r) => {
      if (!r.ok) return
      r.json().then((d) => {
        setHeaders(d.headers || [])
        setEligibleCount((d.recipients || []).filter((x: any) => x.status !== 'skipped').length)
        setName((cur) => cur.trim() ? cur : `${d.name} sequence`)
      })
    }).catch(() => {})
  }, [campaignId, source])

  const prefillSubject = (tid: number | '', setter: (s: string) => void, current: string) => {
    if (!tid || current.trim()) return
    const t = templates.find((x) => x.id === tid)
    if (t?.subject) setter(t.subject)
  }
  useEffect(() => { prefillSubject(freshTemplateId, setFreshSubject, freshSubject) }, [freshTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prefillSubject(fu1TemplateId, setFu1Subject, fu1Subject) }, [fu1TemplateId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prefillSubject(fu2TemplateId, setFu2Subject, fu2Subject) }, [fu2TemplateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const batches = eligibleCount ? Math.ceil(eligibleCount / Math.max(1, batchSize)) : 0
  const totalDays = batches ? (batches + 1) * gapDays : 0

  const create = async () => {
    if (source === 'sheet' && !campaignId) { setError('Pick a source sheet (campaign).'); return }
    if (!name.trim()) { setError('Give the sequence a name.'); return }
    if (!freshTemplateId || !fu1TemplateId || !fu2TemplateId) { setError('Pick all three templates (fresh, follow-up 1, follow-up 2).'); return }
    if (!freshSubject.trim() || !fu1Subject.trim() || !fu2Subject.trim()) { setError('All three subjects are required.'); return }
    if (!ack) { setError('Please confirm these contacts have consented to receive email.'); return }
    setCreating(true); setError('')
    try {
      const r = await backendFetch('/api/sequences', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          campaignId: source === 'sheet' ? campaignId : null,
          audience: source === 'merchants'
            ? { source: 'merchants', appId: mAppId, trigger: mTrigger }
            : { source: 'sheet' },
          name, batchSize, gapDays, sendHour, fu1Days, fu2Days,
          // A triggered sequence has nothing to start — it waits for events.
          startNow: source === 'merchants' ? false : startNow,
          freshTemplateId, freshSubject, fu1TemplateId, fu1Subject, fu2TemplateId, fu2Subject,
          senderId: senderId || null,
          // Merchant vars are already named after their merge tags, so no map.
          varMap: source === 'sheet' ? autoVarMap(headers) : {},
        }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setError(d.error || 'Failed to create sequence.'); setCreating(false); return }
      onCreated(d.id)
    } catch {
      setError('Failed to create sequence.')
      setCreating(false)
    }
  }


  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">New sequence</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X size={16} /></button>
      </div>

      {/* Audience source. Merchants drips over stores in the customers table;
          the sheet flow below is unchanged. */}
      <div className="flex gap-2 mb-4">
        {([['sheet', 'Imported sheet'], ['merchants', 'Merchants']] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => { setSource(v); setEligibleCount(null); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              source === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === 'merchants' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">App</span>
              <select className={selCls} value={mAppId} onChange={(e) => setMAppId(e.target.value)}>
                <option value="all">All apps</option>
                {apps.map((a) => <option key={a.appId} value={a.appId}>{a.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Trigger — when the fresh email is sent</span>
              <select className={selCls} value={mTrigger} onChange={(e) => setMTrigger(e.target.value as any)}>
                <option value="install">On install</option>
                <option value="uninstall">On uninstall</option>
                <option value="both">On install or uninstall</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Sequence name</span>
              <input className={selCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Win-back merchants" />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-4 mb-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Follow-up 1 after (days)</span>
              <input type="number" min={1} className={selCls} value={fu1Days} onChange={(e) => setFu1Days(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Follow-up 2 after (days)</span>
              <input type="number" min={1} className={selCls} value={fu2Days} onChange={(e) => setFu2Days(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Follow-up time (IST)</span>
              <select className={selCls} value={sendHour} onChange={(e) => setSendHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Sender</span>
              <select className={selCls} value={senderId} onChange={(e) => setSenderId(e.target.value ? Number(e.target.value) : '')}>
                {senders.map((s) => <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;</option>)}
              </select>
            </label>
          </div>

          <div className="text-xs text-gray-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-4">
            Triggered — no batches. A store joins the moment it {mTrigger === 'both' ? 'installs or uninstalls' : `${mTrigger}s`}
            {mAppId !== 'all' && <> {appLabel(mAppId, apps)}</>}, gets the <b>fresh email on the next poll</b> (within 5 min),
            then <b>follow-up 1 after {fu1Days}d</b> and <b>follow-up 2 {fu2Days}d</b> later at {String(sendHour).padStart(2, '0')}:00 IST.
            Openers and repliers are dropped from the follow-ups. Existing stores are not enrolled — only events from now on.
            {' '}Merge tags: <code>{'{{store_name}}'}</code> <code>{'{{domain}}'}</code> <code>{'{{app_name}}'}</code> <code>{'{{plan}}'}</code>
            {mTrigger !== 'install' && <> <code>{'{{uninstall_reason}}'}</code> <code>{'{{usage_duration}}'}</code></>}.
          </div>
        </>
      )}

      <div className={`grid gap-4 sm:grid-cols-2 mb-4 ${source === 'merchants' ? 'hidden' : ''}`}>
        <div className="block">
          <span className="text-xs font-medium text-gray-600">Source sheet — pick one already imported, or upload a new file</span>
          <div className="flex gap-2 mt-0.5">
            <select className={selCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— pick an imported sheet —</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.fileName}, {c.totalCount} rows)</option>)}
            </select>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap disabled:opacity-50"
              title="Import a .xlsx / .xls / .csv file as a new sheet"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Import sheet
            </button>
          </div>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Sequence name</span>
          <input className={selCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="July outreach" />
        </label>
      </div>

      {/* Batching, gap and send time only apply to a sheet drip — a triggered
          sequence has its own delay inputs above. */}
      <div className={`grid gap-4 sm:grid-cols-4 mb-4 ${source === 'merchants' ? 'hidden' : ''}`}>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Batch size</span>
          <input type="number" min={1} className={selCls} value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value)))} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Gap (days)</span>
          <input type="number" min={1} className={selCls} value={gapDays} onChange={(e) => setGapDays(Math.max(1, Number(e.target.value)))} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Send time (IST)</span>
          <select className={selCls} value={sendHour} onChange={(e) => setSendHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Sender</span>
          <select className={selCls} value={senderId} onChange={(e) => setSenderId(e.target.value ? Number(e.target.value) : '')}>
            {senders.map((s) => <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;</option>)}
          </select>
        </label>
      </div>

      {source === 'sheet' && eligibleCount !== null && (
        <div className="text-xs text-gray-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-4">
          {eligibleCount} valid contacts → <b>{batches} batches</b> of up to {batchSize}. Full run ≈ <b>{totalDays} days</b>
          {' '}(each batch: fresh → +{gapDays}d follow-up 1 → +{gapDays}d follow-up 2; openers/repliers are skipped automatically).
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        {([
          ['Fresh email', freshTemplateId, setFreshTemplateId, freshSubject, setFreshSubject],
          ['Follow-up 1', fu1TemplateId, setFu1TemplateId, fu1Subject, setFu1Subject],
          ['Follow-up 2', fu2TemplateId, setFu2TemplateId, fu2Subject, setFu2Subject],
        ] as [string, number | '', (v: number | '') => void, string, (v: string) => void][]).map(([label, tid, setTid, subj, setSubj]) => (
          <div key={label} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-700">{label}</span>
              <div className="flex items-center gap-2 text-[11px]">
                {/* Build a template right here, without losing the half-filled wizard. */}
                <button
                  type="button"
                  onClick={() => setTplModal({ label, apply: (id: number, subject: string) => { setTid(id); if (subject.trim()) setSubj(subject) } })}
                  className="flex items-center gap-0.5 text-indigo-600 hover:underline"
                >
                  <Plus size={11} /> New
                </button>
                {tid !== '' && (
                  <a href={`/email/templates?id=${tid}`} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-gray-500 hover:underline">
                    <ExternalLink size={11} /> Edit
                  </a>
                )}
              </div>
            </div>
            <select className={`${selCls} mb-2`} value={tid} onChange={(e) => setTid(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input
              className={`${selCls} ${!subj.trim() ? 'border-red-300' : ''}`}
              value={subj}
              onChange={(e) => setSubj(e.target.value)}
              placeholder="Subject (required, {{merge}} ok)"
            />
          </div>
        ))}
      </div>

      {/* Nothing to start on a triggered sequence — it sits armed until an event. */}
      {source === 'sheet' && (
        <label className="flex items-start gap-2 text-xs text-gray-600 mb-4">
          <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} className="mt-0.5" />
          <span>Start immediately (batch 1 gets the fresh email on the next cron tick). Unchecked: starts at the next {String(sendHour).padStart(2, '0')}:00 IST.</span>
        </label>
      )}
      <label className="flex items-start gap-2 text-xs text-gray-600 mb-4">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>I confirm these contacts have consented to receive email from us. Every email includes an unsubscribe link.</span>
      </label>

      {error && <div className="flex items-center gap-2 text-sm text-red-600 mb-3"><AlertCircle size={14} /> {error}</div>}

      <button
        onClick={create}
        disabled={creating}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {creating ? <Loader2 size={16} className="animate-spin" /> : <Repeat size={16} />} Start sequence
      </button>

      {tplModal && (
        <TemplateQuickCreate
          slotLabel={tplModal.label}
          mergeTags={source === 'merchants' ? merchantTags(mTrigger) : headers}
          onClose={() => setTplModal(null)}
          onCreated={async (id, subject) => {
            await loadTemplates()
            tplModal.apply(id, subject)
            setTplModal(null)
          }}
        />
      )}
    </div>
  )
}

/** Merge tags a triggered sequence can offer, given its trigger. */
function merchantTags(trigger: 'install' | 'uninstall' | 'both'): string[] {
  const base = ['store_name', 'name', 'domain', 'app_name', 'plan', 'country', 'email', 'mrr', 'ltv']
  if (trigger === 'install') return base
  return [...base, 'install_date', 'uninstall_date', 'usage_duration', 'usage_duration_days',
    'previous_plan', 'uninstall_reason', 'uninstall_reason_detail', 'shop_contact_name', 'shop_contact_email']
}

/**
 * Minimal template composer, so a sequence can be built in one sitting instead of
 * bouncing to Email → Templates and back. Full editing (layouts, test sends,
 * preview) still lives on that page — the "Edit" link opens it.
 */
function TemplateQuickCreate({
  slotLabel, mergeTags, onClose, onCreated,
}: {
  slotLabel: string
  mergeTags: string[]
  onClose: () => void
  onCreated: (id: number, subject: string) => void | Promise<void>
}) {
  const [layouts, setLayouts] = useState<{ id: number; name: string }[]>([])
  const [name, setName] = useState(`${slotLabel} template`)
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('<p>Hi {{store_name}},</p>\n<p></p>\n<p>— The Team</p>')
  const [layoutId, setLayoutId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    backendFetch('/api/email/layouts')
      .then((r) => { if (r.ok) r.json().then((d) => { const l = Array.isArray(d) ? d : []; setLayouts(l); setLayoutId((c) => c || l[0]?.id || '') }) })
      .catch(() => {})
  }, [])

  // Drop a tag at the cursor rather than at the end — matters once the body grows.
  const insertTag = (tag: string) => {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    if (!el) { setBodyHtml((b) => b + token); return }
    const { selectionStart: s, selectionEnd: e } = el
    setBodyHtml((b) => b.slice(0, s) + token + b.slice(e))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length) })
  }

  const save = async () => {
    if (!name.trim()) { setErr('Give the template a name.'); return }
    if (!subject.trim()) { setErr('Subject is required.'); return }
    setSaving(true); setErr('')
    try {
      const r = await backendFetch('/api/email/templates', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), subject: subject.trim(), bodyHtml, category: 'marketing', layoutId: layoutId || null }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setErr(d.error || 'Failed to save template.'); setSaving(false); return }
      await onCreated(d.id, subject.trim())
    } catch {
      setErr('Failed to save template.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">New template — {slotLabel}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Template name</span>
              <input className={selCls} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Layout (header/footer)</span>
              <select className={selCls} value={layoutId} onChange={(e) => setLayoutId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— none —</option>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Subject</span>
            <input className={selCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="We're sorry to see you go, {{store_name}}" />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Body (HTML)</span>
            <textarea ref={bodyRef} rows={12} className={`${selCls} font-mono text-[12px]`} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
          </label>

          {mergeTags.length > 0 && (
            <div>
              <div className="text-[11px] text-gray-500 mb-1">Click to insert a merge tag:</div>
              <div className="flex flex-wrap gap-1">
                {mergeTags.map((t) => (
                  <button key={t} type="button" onClick={() => insertTag(t)}
                    className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[11px] font-mono text-gray-700 hover:border-indigo-300 hover:bg-indigo-50">
                    {`{{${t}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <div className="flex items-center gap-2 text-sm text-red-600"><AlertCircle size={14} /> {err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save &amp; use
          </button>
        </div>
      </div>
    </div>
  )
}
