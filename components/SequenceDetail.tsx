'use client'

// Sequence detail (/shopify/sequences/[id]) — the admin visuals:
// pipeline board (one column per batch, showing fresh/FU-1/FU-2 progress),
// funnel stats, per-contact table with read-only auto-detected status, and the
// per-cycle activity timeline.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Repeat, Loader2, AlertCircle, Clock, Mail, Eye, MessageSquare,
  RefreshCw, Search, Trash2, Info, PauseCircle, PlayCircle, XCircle, CheckCircle2,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { formatIST, relTime } from '@/components/CampaignSequences'

const authHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json' })

interface KindStats { sent: number; queued: number; failed: number; skipped?: number }
interface BatchStats {
  batchNo: number; size: number
  fresh: KindStats; fu1: KindStats; fu2: KindStats
  opened: number; replied: number; done: number
}
interface ContactEmail { kind: string; status: string; sentAt: string | null }
interface Contact {
  id: number; email: string; vars: Record<string, string>; batchNo: number
  nextDueAt: string | null
  stage: string; engaged: string
  openedAt: string | null; repliedAt: string | null; lastSentAt: string | null
  error: string | null; emails: ContactEmail[]
}
// A batched cycle entry has `cycle`; a triggered enrolment logs `event`/`domain` instead.
interface Activity {
  at: string; cycle?: number; fresh: number
  fu1?: number; fu1Skipped?: number; fu2?: number; fu2Skipped?: number
  event?: string; domain?: string | null
  /** Set when the store matched but could not be enrolled (e.g. no email). */
  skipped?: string
}
interface Sequence {
  id: number; name: string; campaignId: number | null; status: string
  audience?: { source: 'sheet' | 'merchants'; appId?: string | null; trigger?: 'install' | 'uninstall' | 'both' } | null
  batchSize: number; gapDays: number; sendHour: number; fu1Days: number; fu2Days: number
  freshSubject: string; fu1Subject: string; fu2Subject: string
  currentCycle: number; totalCycles: number; totalBatches: number
  nextRunAt: string | null; activity: Activity[]
  emailEnabled: boolean; queuedTotal: number
  batches: BatchStats[]; contacts: Contact[]
  createdAt: string
}

const STAGE_BADGE: Record<string, { cls: string; label: string }> = {
  waiting: { cls: 'bg-gray-100 text-gray-500', label: 'Waiting' },
  fresh_sent: { cls: 'bg-blue-50 text-blue-700', label: 'Fresh sent' },
  fu1_sent: { cls: 'bg-amber-50 text-amber-700', label: 'FU-1 sent' },
  fu2_sent: { cls: 'bg-orange-50 text-orange-700', label: 'FU-2 sent' },
  finished: { cls: 'bg-emerald-50 text-emerald-700', label: 'Done' },
}
const ENGAGED_BADGE: Record<string, { cls: string; label: string }> = {
  opened: { cls: 'bg-emerald-50 text-emerald-700', label: '👁 Opened' },
  replied: { cls: 'bg-indigo-50 text-indigo-700', label: '💬 Replied' },
  unsubscribed: { cls: 'bg-red-50 text-red-600', label: 'Unsubscribed' },
  bounced: { cls: 'bg-amber-50 text-amber-700', label: '⚠ Bounced' },
}

// Read-only per-contact status. Engagement is detected automatically (tracking
// pixel + Brevo webhook), so there is nothing here to click — the row just
// reports where the contact got to.
function contactStatus(x: Contact): { cls: string; label: string } {
  if (x.engaged === 'opened') return { cls: 'text-emerald-600', label: 'Opened' }
  if (x.engaged === 'replied') return { cls: 'text-indigo-600', label: 'Replied' }
  if (x.engaged === 'unsubscribed') return { cls: 'text-red-600', label: 'Unsubscribed' }
  if (x.engaged === 'bounced') return { cls: 'text-amber-600', label: 'Bounced' }
  if (x.lastSentAt) return { cls: 'text-gray-600', label: 'Sent' }
  return { cls: 'text-gray-400', label: 'Not sent' }
}

export default function SequenceDetail({ id }: { id: number }) {
  const router = useRouter()
  const [c, setC] = useState<Sequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [batchFilter, setBatchFilter] = useState<number | 0>(0)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await backendFetch(`/api/sequences/${id}`)
    if (!r.ok) { setError('Sequence not found.'); setLoading(false); return }
    setC(await r.json())
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // Auto-refresh only while this environment is actively sending queued
  // emails — bounded so it can never loop forever (same rule as campaigns).
  useEffect(() => {
    if (!c?.emailEnabled || !c?.queuedTotal) return
    let polls = 0
    const iv = setInterval(async () => {
      polls++
      await load()
      if (polls >= 24) clearInterval(iv)
    }, 5000)
    return () => clearInterval(iv)
  }, [c?.emailEnabled, c?.queuedTotal, load])

  const action = async (a: 'pause' | 'resume' | 'cancel') => {
    if (a === 'cancel' && !confirm('Cancel this sequence? Queued emails are voided; already-sent emails stay recorded.')) return
    setBusy(true)
    await backendFetch(`/api/sequences/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ action: a }) })
    await load()
    setBusy(false)
  }

  const remove = async () => {
    if (!confirm('Delete this sequence and all its history?')) return
    await backendFetch(`/api/sequences/${id}`, { method: 'DELETE', headers: authHeaders() })
    router.push('/shopify/sequences')
  }

  const funnel = useMemo(() => {
    if (!c) return null
    const sum = (f: (b: BatchStats) => number) => c.batches.reduce((n, b) => n + f(b), 0)
    const freshSent = sum((b) => b.fresh.sent)
    const opened = sum((b) => b.opened)
    const replied = sum((b) => b.replied)
    return {
      total: c.contacts.length,
      freshSent,
      opened,
      replied,
      fu1Sent: sum((b) => b.fu1.sent),
      fu2Sent: sum((b) => b.fu2.sent),
      done: sum((b) => b.done),
      openRate: freshSent ? Math.round(((opened + replied) / freshSent) * 100) : 0,
    }
  }, [c])

  const filteredContacts = useMemo(() => {
    if (!c) return []
    const q = query.trim().toLowerCase()
    return c.contacts.filter((x) =>
      (batchFilter === 0 || x.batchNo === batchFilter) &&
      (!q || x.email.toLowerCase().includes(q) || Object.values(x.vars || {}).some((v) => String(v).toLowerCase().includes(q))))
  }, [c, query, batchFilter])

  if (loading) return <div className="p-10 flex items-center gap-2 text-gray-500 text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (error || !c) return (
    <div className="p-10">
      <div className="flex items-center gap-2 text-red-600 text-sm mb-4"><AlertCircle size={16} /> {error || 'Not found.'}</div>
      <button onClick={() => router.push('/shopify/sequences')} className="text-sm text-indigo-600 underline">← Back to sequences</button>
    </div>
  )

  // Which cycle serves each step of batch b: fresh at cycle b, FU-1 at b+1, FU-2 at b+2.
  const stepDone = (batchNo: number, step: 0 | 1 | 2) => c.currentCycle >= batchNo + step
  // Triggered sequences have no batches or cycles — stores enrol on the event.
  const triggered = c.audience?.source === 'merchants'
  const trigLabel = c.audience?.trigger === 'both' ? 'install or uninstall' : `${c.audience?.trigger || 'install'}`

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/shopify/sequences')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></button>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0"><Repeat size={20} className="text-indigo-600" /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{c.name}</h1>
            <p className="text-xs text-gray-500">
              {triggered
                ? <>{c.contacts.length} enrolled · triggered on {trigLabel} · follow-ups +{c.fu1Days}d then +{c.fu2Days}d at {String(c.sendHour).padStart(2, '0')}:00 IST</>
                : <>{c.contacts.length} contacts · {c.totalBatches} batches of {c.batchSize} · every {c.gapDays}d at {String(c.sendHour).padStart(2, '0')}:00 IST</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} />
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Refresh"><RefreshCw size={16} /></button>
          {c.status === 'running' && <button disabled={busy} onClick={() => action('pause')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"><PauseCircle size={14} /> Pause</button>}
          {c.status === 'paused' && <button disabled={busy} onClick={() => action('resume')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"><PlayCircle size={14} /> Resume</button>}
          {(c.status === 'running' || c.status === 'paused') && <button disabled={busy} onClick={() => action('cancel')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50"><XCircle size={14} /> Cancel</button>}
          <button onClick={remove} className="p-2 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={16} /></button>
        </div>
      </div>

      {/* ── Next run / held banners ── */}
      {triggered ? (
        c.status === 'running' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-800">
            <Clock size={15} className="shrink-0" />
            <span>Armed — every store that {trigLabel === 'install or uninstall' ? 'installs or uninstalls' : `${trigLabel}s`} is enrolled and gets the fresh email within 5 minutes. Runs until you pause it.</span>
          </div>
        )
      ) : c.status === 'running' && c.nextRunAt && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-800">
          <Clock size={15} className="shrink-0" />
          <span>Cycle {Math.min(c.currentCycle + 1, c.totalCycles)} of {c.totalCycles} runs <b>{relTime(c.nextRunAt)}</b> — {formatIST(c.nextRunAt)}</span>
        </div>
      )}
      {!c.emailEnabled && c.queuedTotal > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>{c.queuedTotal} email{c.queuedTotal === 1 ? '' : 's'} queued, but sending is disabled on this machine (no <code>BREVO_API_KEY</code>). They&apos;ll go out from the live server.</span>
        </div>
      )}

      {/* ── Funnel strip ── */}
      {funnel && (
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-6">
          {([
            ['Contacts', funnel.total, 'text-gray-900'],
            ['Fresh sent', funnel.freshSent, 'text-blue-600'],
            ['Opened', funnel.opened, 'text-emerald-600'],
            ['Replied', funnel.replied, 'text-indigo-600'],
            ['FU-1 sent', funnel.fu1Sent, 'text-amber-600'],
            ['FU-2 sent', funnel.fu2Sent, 'text-orange-600'],
            ['Done', funnel.done, 'text-gray-700'],
            ['Open rate', `${funnel.openRate}%`, 'text-emerald-700'],
          ] as [string, number | string, string][]).map(([label, val, cls]) => (
            <div key={label} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-center">
              <div className={`text-lg font-bold ${cls}`}>{val}</div>
              <div className="text-[11px] text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pipeline board — batches only exist on a sheet drip ── */}
      {!triggered && (
        <>
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Pipeline</h2>
      <div className="overflow-x-auto pb-2 mb-6">
        <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
          {c.batches.map((b) => {
            const active = c.currentCycle >= b.batchNo && c.currentCycle < b.batchNo + 2
            const doneAll = c.currentCycle >= b.batchNo + 2
            return (
              <div key={b.batchNo} className={`w-56 shrink-0 rounded-xl border p-3 ${doneAll ? 'border-emerald-200 bg-emerald-50/40' : active ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-900">Batch {b.batchNo}</span>
                  <span className="text-[11px] text-gray-500">{b.size} contacts</span>
                </div>
                <StepRow label="Fresh" stats={b.fresh} reached={stepDone(b.batchNo, 0)} />
                <StepRow label="Follow-up 1" stats={b.fu1} reached={stepDone(b.batchNo, 1)} />
                <StepRow label="Follow-up 2" stats={b.fu2} reached={stepDone(b.batchNo, 2)} />
                <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-3 text-[11px] text-gray-600">
                  <span className="flex items-center gap-1"><Eye size={11} className="text-emerald-500" /> {b.opened}</span>
                  <span className="flex items-center gap-1"><MessageSquare size={11} className="text-indigo-500" /> {b.replied}</span>
                  {doneAll && <span className="ml-auto flex items-center gap-1 text-emerald-600"><CheckCircle2 size={11} /> done</span>}
                  {active && <span className="ml-auto text-indigo-600 font-medium">active</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
        </>
      )}

      {/* ── Contacts ── */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900">Contacts ({filteredContacts.length})</h2>
        <div className="flex items-center gap-2">
          {!triggered && (
            <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" value={batchFilter} onChange={(e) => setBatchFilter(Number(e.target.value))}>
              <option value={0}>All batches</option>
              {c.batches.map((b) => <option key={b.batchNo} value={b.batchNo}>Batch {b.batchNo}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-56" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">{triggered ? 'Next follow-up' : 'Batch'}</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Engagement</th>
                <th className="px-3 py-2">Last sent</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.slice(0, 1000).map((x) => {
                const stage = STAGE_BADGE[x.stage] || STAGE_BADGE.waiting
                const eng = ENGAGED_BADGE[x.engaged]
                return (
                  <tr key={x.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{x.email}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-[12px]">
                      {triggered ? (x.nextDueAt ? formatIST(x.nextDueAt) : '—') : `B${x.batchNo}`}
                    </td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${stage.cls}`}>{stage.label}</span></td>
                    <td className="px-3 py-2">
                      {eng ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${eng.cls}`}>{eng.label}</span> : <span className="text-[11px] text-gray-400">—</span>}
                      {x.error && <span className="ml-1 text-[11px] text-red-500" title={x.error}>⚠</span>}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-gray-500 whitespace-nowrap">{x.lastSentAt ? formatIST(x.lastSentAt) : '—'}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap text-[12px] font-medium ${contactStatus(x).cls}`}>
                      {contactStatus(x).label}
                    </td>
                  </tr>
                )
              })}
              {filteredContacts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">No contacts match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Activity timeline ── */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Activity</h2>
      {c.activity.length === 0 ? (
        <p className="text-sm text-gray-400 mb-8">{triggered ? 'No stores have been enrolled yet.' : 'No cycles have run yet.'}</p>
      ) : (
        <ul className="space-y-2 mb-8">
          {[...c.activity].reverse().map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <Mail size={14} className={`mt-0.5 shrink-0 ${a.skipped ? 'text-amber-500' : 'text-indigo-500'}`} />
              {a.skipped ? (
                // Matched the trigger but couldn't be enrolled — surfaced so a
                // silently-empty sequence is explainable.
                <span><b>{formatIST(a.at)}</b> — {a.domain || 'a store'} {a.event === 'uninstall' ? 'uninstalled' : 'installed'}, <span className="text-amber-600">not enrolled ({a.skipped})</span></span>
              ) : a.event ? (
                // Triggered enrolment: one line per store that fired the trigger.
                <span><b>{formatIST(a.at)}</b> — {a.domain || 'a store'} {a.event === 'uninstall' ? 'uninstalled' : 'installed'}, enrolled &amp; fresh email queued</span>
              ) : (
                <span>
                  <b>{formatIST(a.at)}</b> — Cycle {a.cycle}:
                  {a.fresh > 0 && <> {a.fresh} fresh queued</>}
                  {(a.fu1 || 0) > 0 && <>{a.fresh > 0 ? ',' : ''} {a.fu1} follow-up 1</>}
                  {(a.fu1Skipped || 0) > 0 && <> ({a.fu1Skipped} skipped — engaged)</>}
                  {(a.fu2 || 0) > 0 && <>{a.fresh + (a.fu1 || 0) > 0 ? ',' : ''} {a.fu2} follow-up 2</>}
                  {(a.fu2Skipped || 0) > 0 && <> ({a.fu2Skipped} skipped — engaged)</>}
                  {a.fresh + (a.fu1 || 0) + (a.fu2 || 0) === 0 && <> nothing to send</>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-blue-50 text-blue-700', paused: 'bg-amber-50 text-amber-700',
    completed: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500',
  }
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-500'}`}>{status}</span>
}

// One step row on a pipeline card: shows sent/queued/failed once the step's
// cycle has been reached; a muted "pending" before that.
function StepRow({ label, stats, reached }: { label: string; stats: KindStats; reached: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px] py-1">
      <span className={reached ? 'text-gray-700 font-medium' : 'text-gray-400'}>{label}</span>
      {reached ? (
        <span className="flex items-center gap-2">
          {stats.sent > 0 && <span className="text-emerald-600">✓ {stats.sent}</span>}
          {stats.queued > 0 && <span className="text-amber-600">⏳ {stats.queued}</span>}
          {stats.failed > 0 && <span className="text-red-600">✗ {stats.failed}</span>}
          {(stats.skipped || 0) > 0 && <span className="text-gray-400">↷ {stats.skipped}</span>}
          {stats.sent + stats.queued + stats.failed + (stats.skipped || 0) === 0 && <span className="text-gray-400">0 due</span>}
        </span>
      ) : (
        <span className="text-gray-300">pending</span>
      )}
    </div>
  )
}
