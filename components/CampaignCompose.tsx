'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Mail, Users, Shuffle, ListChecks, Send, Clock, Loader2, AlertCircle,
  CheckCircle2, XCircle, RefreshCw, Eye, FileSpreadsheet, Trash2, Info,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { applyVars, composeEmailHtml } from '@/lib/email-html'
import { autoVarMap, buildRecipientVars, CAMPAIGN_MERGE_TAGS } from '@/lib/campaign'

const authHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json' })

interface Recipient { id: number; email: string; vars: Record<string, string>; selected: boolean; status: string; sentAt: string | null; error: string | null }
interface Campaign {
  id: number; name: string; fileName: string; sheetName: string | null; headers: string[]
  emailColumn: string | null; subject: string | null; templateId: number | null; senderId: number | null
  varMap: Record<string, string>; status: string; scheduledAt: string | null
  emailEnabled: boolean
  totalCount: number; sentCount: number; failedCount: number; recipients: Recipient[]
}
interface TemplateLite { id: number; name: string; subject: string }
interface TemplateFull { id: number; bodyHtml: string; subject: string; layoutId: number | null }
interface Layout { id: number; headerHtml: string; footerHtml: string }
interface Sender { id: number; email: string; name: string; isDefault: boolean }

const RANDOM_PRESETS = [50, 100, 150]
const badge: Record<string, string> = {
  sent: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-600',
  queued: 'bg-amber-50 text-amber-700', sending: 'bg-blue-50 text-blue-700',
  pending: 'bg-gray-100 text-gray-500', skipped: 'bg-gray-100 text-gray-400',
}

export default function CampaignCompose({ id }: { id: number }) {
  const router = useRouter()
  const [c, setC] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [fullTemplate, setFullTemplate] = useState<TemplateFull | null>(null)

  const [templateId, setTemplateId] = useState<number | ''>('')
  const [subject, setSubject] = useState('')
  const [senderId, setSenderId] = useState<number | ''>('')
  const [varMap, setVarMap] = useState<Record<string, string>>({})

  const [selMode, setSelMode] = useState<'all' | 'random' | 'ids'>('all')
  const [randomN, setRandomN] = useState(50)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [rowQuery, setRowQuery] = useState('')

  const [when, setWhen] = useState<'now' | 'schedule'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [ack, setAck] = useState(false)

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string>('')

  const load = useCallback(async () => {
    const r = await backendFetch(`/api/campaigns/${id}`)
    if (!r.ok) { setError('Campaign not found.'); setLoading(false); return }
    const d: Campaign = await r.json()
    setC(d)
    setTemplateId(d.templateId ?? '')
    setSubject(d.subject ?? '')
    setSenderId(d.senderId ?? '')
    setVarMap(d.varMap && Object.keys(d.varMap).length ? d.varMap : autoVarMap(d.headers))
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
    backendFetch('/api/email/templates').then((r) => { if (r.ok) r.json().then(setTemplates) }).catch(() => {})
    backendFetch('/api/email/senders').then((r) => { if (r.ok) r.json().then((s: Sender[]) => {
      setSenders(s)
      setSenderId((cur) => cur || s.find((x) => x.isDefault)?.id || s[0]?.id || '')
    }) }).catch(() => {})
    backendFetch('/api/email/layouts').then((r) => { if (r.ok) r.json().then(setLayouts) }).catch(() => {})
  }, [load])

  // Fetch the full template (body + layout) for the live preview, and prefill
  // the subject from the template when the campaign has none yet.
  useEffect(() => {
    if (!templateId) { setFullTemplate(null); return }
    backendFetch(`/api/email/templates/${templateId}`)
      .then((r) => { if (r.ok) r.json().then((t: TemplateFull) => { setFullTemplate(t); setSubject((cur) => cur.trim() ? cur : t.subject || '') }) })
      .catch(() => {})
  }, [templateId])

  // Auto-poll while a send is actively progressing, so counts update live.
  // Only polls when THIS environment can send (emailEnabled) — otherwise the
  // queue is held for the live server and would never change here. Also bounded
  // (~2 min) so a stalled send never loops forever; the Refresh button remains.
  useEffect(() => {
    if (c?.status !== 'sending' || !c?.emailEnabled) return
    let polls = 0
    const iv = setInterval(async () => {
      polls++
      await load()
      if (polls >= 24) clearInterval(iv) // ~2 min at 5s, then stop
    }, 5000)
    return () => clearInterval(iv)
  }, [c?.status, c?.emailEnabled, load])

  const eligible = useMemo(() => (c?.recipients || []).filter((r) => r.status !== 'skipped'), [c])
  const filteredEligible = useMemo(() => {
    const q = rowQuery.trim().toLowerCase()
    if (!q) return eligible
    return eligible.filter((r) => r.email.toLowerCase().includes(q) || Object.values(r.vars).some((v) => String(v).toLowerCase().includes(q)))
  }, [eligible, rowQuery])

  const selectedCount = useMemo(() => {
    if (selMode === 'all') return eligible.length
    if (selMode === 'random') return Math.min(randomN, eligible.length)
    return eligible.filter((r) => selectedIds.has(r.id)).length
  }, [selMode, randomN, eligible, selectedIds])

  const changeEmailColumn = async (col: string) => {
    await backendFetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ emailColumn: col, varMap }) })
    await load()
  }

  const previewHtml = useMemo(() => {
    if (!fullTemplate) return ''
    const layout = layouts.find((l) => l.id === fullTemplate.layoutId)
    const sample = eligible[0]?.vars || {}
    const vars = buildRecipientVars(sample, varMap, eligible[0]?.email || 'recipient@example.com')
    return composeEmailHtml({
      header: layout?.headerHtml, body: fullTemplate.bodyHtml,
      footer: `${layout?.footerHtml || ''}<div style="padding:14px 24px;border-top:1px solid #eef0f2;font-size:12px;color:#98a2b3;text-align:center;">You received this email because you are on our contact list. <a href="#" style="color:#98a2b3;">Unsubscribe</a></div>`,
      vars,
    })
  }, [fullTemplate, layouts, eligible, varMap])

  const send = async () => {
    if (!templateId) { setError('Pick an email template first.'); return }
    if (!subject.trim()) { setError('Please enter a subject line.'); return }
    if (!ack) { setError('Please confirm these contacts have consented to receive email.'); return }
    if (selectedCount === 0) { setError('No recipients selected.'); return }
    if (when === 'schedule' && !scheduledAt) { setError('Pick a date & time to schedule.'); return }
    setSending(true); setError(''); setResult('')
    try {
      const selection = selMode === 'ids'
        ? { mode: 'ids', ids: eligible.filter((r) => selectedIds.has(r.id)).map((r) => r.id) }
        : selMode === 'random' ? { mode: 'random', n: randomN } : { mode: 'all' }
      const body = {
        templateId: Number(templateId),
        subject: subject.trim(),
        senderId: senderId ? Number(senderId) : null,
        varMap,
        selection,
        when,
        scheduledAt: when === 'schedule' ? new Date(scheduledAt).toISOString() : undefined,
      }
      const r = await backendFetch(`/api/campaigns/${id}/queue`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || 'Send failed.'); return }
      if (d.scheduled) setResult(`Scheduled ${d.queued} email${d.queued === 1 ? '' : 's'} — they'll send at the chosen time.`)
      else if (d.held) setResult(`Queued ${d.queued} email${d.queued === 1 ? '' : 's'}. Email is disabled on this machine (no BREVO_API_KEY) — the live server will send them.`)
      else setResult(`Sent ${d.sent}, failed ${d.failed}${d.queued > d.sent + d.failed ? `, ${d.queued - d.sent - d.failed} still queued (sending in the background)` : ''}.`)
      await load()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSending(false)
    }
  }

  const retryFailed = async () => {
    setSending(true); setResult('')
    try {
      const r = await backendFetch(`/api/campaigns/${id}/retry`, { method: 'POST', headers: authHeaders(), body: '{}' })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setResult(`Re-queued ${d.requeued} failed. Sent ${d.sent ?? 0}, failed ${d.failed ?? 0}.`)
      await load()
    } finally { setSending(false) }
  }

  const deleteCampaign = async () => {
    if (!confirm('Delete this campaign and all its recipients?')) return
    await backendFetch(`/api/campaigns/${id}`, { method: 'DELETE', headers: authHeaders() })
    router.push('/shopify/campaign')
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-emerald-500" size={26} /></div>
  if (!c) return <div className="px-8 py-12 text-sm text-red-600">{error || 'Not found.'}</div>

  const skippedCount = c.totalCount - eligible.length
  const pendingCount = c.recipients.filter((r) => r.status === 'queued' || r.status === 'sending').length

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 w-full max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/shopify/campaign')} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Mail size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{c.name}</h1>
          <p className="text-sm text-gray-400 flex items-center gap-1.5">
            <FileSpreadsheet size={13} /> {c.fileName} · {eligible.length} sendable
            {skippedCount > 0 && <span className="text-gray-400">· {skippedCount} skipped (no valid email)</span>}
          </p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${badge[c.status] || 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
        <button onClick={deleteCampaign} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Delete"><Trash2 size={16} /></button>
      </div>

      {/* Held notice — this machine can't send; the queue waits for the live server */}
      {!c.emailEnabled && pendingCount > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>{pendingCount} email{pendingCount === 1 ? '' : 's'} queued, but sending is disabled on this machine (no <code>BREVO_API_KEY</code>). They&apos;ll go out from the live server. Auto-refresh is off here.</span>
        </div>
      )}

      {/* Progress bar (once anything has been queued/sent) */}
      {(c.sentCount > 0 || c.failedCount > 0 || pendingCount > 0) && (
        <div className="mb-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={15} />{c.sentCount} sent</span>
            <span className="inline-flex items-center gap-1.5 text-red-600"><XCircle size={15} />{c.failedCount} failed</span>
            {pendingCount > 0 && <span className="inline-flex items-center gap-1.5 text-amber-600"><Clock size={15} />{pendingCount} queued</span>}
            <button onClick={load} className="ml-auto inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-800"><RefreshCw size={13} />Refresh</button>
            {c.failedCount > 0 && <button onClick={retryFailed} disabled={sending} className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-800 disabled:opacity-50"><RefreshCw size={13} />Retry failed</button>}
          </div>
        </div>
      )}

      {error && <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5" />{error}</div>}
      {result && <div className="mb-5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 size={16} className="mt-0.5" />{result}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left: configuration ─────────────────────────────── */}
        <div className="lg:col-span-3 space-y-5">
          {/* Template + sender + email column */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email template</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
                <option value="">Select a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {templates.length === 0 && <p className="mt-1 text-xs text-gray-400">No templates yet — create one in Email → Templates.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject <span className="text-red-500">*</span></label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. A special offer for {{name}}"
                className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 ${subject.trim() ? 'border-gray-200' : 'border-red-300'}`}
              />
              <p className="mt-1 text-xs text-gray-400">Overrides the template&apos;s subject. Supports merge tags like <code className="text-gray-500">{'{{name}}'}</code>.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">From (sender)</label>
                <select value={senderId} onChange={(e) => setSenderId(e.target.value ? Number(e.target.value) : '')} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
                  {senders.length === 0 && <option value="">Default sender</option>}
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.email}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email column</label>
                <select value={c.emailColumn || ''} onChange={(e) => changeEmailColumn(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
                  <option value="">— pick the address column —</option>
                  {c.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Merge mapping */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1"><span className="text-sm font-medium text-gray-700">Personalize merge tags</span></div>
            <p className="text-xs text-gray-400 mb-3">Map <code className="text-gray-500">{'{{tag}}'}</code> tokens in your template to columns from the sheet. Every column is also available as <code className="text-gray-500">{'{{ColumnName}}'}</code>.</p>
            <div className="grid grid-cols-2 gap-2">
              {CAMPAIGN_MERGE_TAGS.filter((t) => t !== 'unsubscribe').map((tag) => (
                <div key={tag} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-500 w-20 shrink-0">{`{{${tag}}}`}</span>
                  <select value={varMap[tag] || ''} onChange={(e) => setVarMap((m) => ({ ...m, [tag]: e.target.value }))} className="flex-1 px-2 py-1.5 rounded-md border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    <option value="">— none —</option>
                    {c.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Recipient selection */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Recipients</span>
              <span className="text-xs text-gray-500">Will send to <b className="text-gray-800">{selectedCount}</b> of {eligible.length}</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <ModeChip icon={Users} label="All valid" active={selMode === 'all'} onClick={() => setSelMode('all')} />
              <ModeChip icon={Shuffle} label="Random" active={selMode === 'random'} onClick={() => setSelMode('random')} />
              <ModeChip icon={ListChecks} label="Specific" active={selMode === 'ids'} onClick={() => setSelMode('ids')} />
            </div>

            {selMode === 'random' && (
              <div className="flex items-center gap-2 flex-wrap">
                {RANDOM_PRESETS.filter((n) => n < eligible.length).map((n) => (
                  <button key={n} onClick={() => setRandomN(n)} className={`px-3 py-1.5 rounded-lg text-sm border ${randomN === n ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{n}</button>
                ))}
                <button onClick={() => setRandomN(eligible.length)} className={`px-3 py-1.5 rounded-lg text-sm border ${randomN >= eligible.length ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>All {eligible.length}</button>
                <input type="number" min={1} max={eligible.length} value={randomN} onChange={(e) => setRandomN(Math.max(1, Math.min(Number(e.target.value) || 1, eligible.length)))} className="w-24 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                <span className="text-xs text-gray-400">random recipients</span>
              </div>
            )}

            {selMode === 'ids' && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <input value={rowQuery} onChange={(e) => setRowQuery(e.target.value)} placeholder="Search…" className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                  <button onClick={() => setSelectedIds(new Set(filteredEligible.map((r) => r.id)))} className="text-xs text-emerald-600 hover:underline">Select all {rowQuery ? 'matching' : ''}</button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:underline">Clear</button>
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {filteredEligible.slice(0, 1000).map((r) => (
                    <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selectedIds.has(r.id)} onChange={(e) => setSelectedIds((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n })} className="accent-emerald-600" />
                      <span className="text-gray-700">{r.email}</span>
                    </label>
                  ))}
                  {filteredEligible.length > 1000 && <p className="px-3 py-2 text-xs text-gray-400">Showing first 1000 — use search to narrow.</p>}
                </div>
              </div>
            )}
          </div>

          {/* When + consent + send */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div className="flex gap-2">
              <ModeChip icon={Send} label="Send now" active={when === 'now'} onClick={() => setWhen('now')} />
              <ModeChip icon={Clock} label="Schedule" active={when === 'schedule'} onClick={() => setWhen('schedule')} />
            </div>
            {when === 'schedule' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Send at (your local time)</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
            )}
            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-emerald-600" />
              <span>These contacts have consented to receive email from us. An unsubscribe link is added to every message.</span>
            </label>
            <button onClick={send} disabled={sending || !templateId || !subject.trim()} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {sending ? <Loader2 size={16} className="animate-spin" /> : when === 'schedule' ? <Clock size={16} /> : <Send size={16} />}
              {sending ? 'Working…' : when === 'schedule' ? `Schedule ${selectedCount} email${selectedCount === 1 ? '' : 's'}` : `Send to ${selectedCount} recipient${selectedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>

        {/* ── Right: live preview ─────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sticky top-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-3"><Eye size={15} /> Preview {eligible[0] && <span className="text-xs text-gray-400 font-normal">· {eligible[0].email}</span>}</div>
            {fullTemplate && (
              <div className="mb-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Subject</p>
                <p className="text-sm text-gray-800 truncate">{applyVars(subject, buildRecipientVars(eligible[0]?.vars || {}, varMap, eligible[0]?.email || '')) || <span className="text-red-400">— required —</span>}</p>
              </div>
            )}
            {fullTemplate ? (
              <iframe title="preview" srcDoc={previewHtml} className="w-full h-[480px] rounded-lg border border-gray-100 bg-[#f4f5f7]" />
            ) : (
              <div className="h-[520px] rounded-lg border border-dashed border-gray-200 flex flex-col items-center justify-center text-center text-sm text-gray-400 gap-2">
                <Info size={20} /> Select a template to preview it with real data.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeChip({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
      <Icon size={15} /> {label}
    </button>
  )
}
