'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Clock, Pencil } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { scheduleLabel } from '@/services/flow-constants'

const H = () => ({ 'Content-Type': 'application/json' })
const cls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Sched { id: number; name: string; freq: string; hour: number; minute: number; weekday: number; flows: number }
const blank = { id: 0, name: '', freq: 'daily', hour: 9, minute: 0, weekday: 1 }

export default function FlowSchedulesPage() {
  const [list, setList] = useState<Sched[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<typeof blank>({ ...blank })
  const editing = form.id > 0

  const load = useCallback(() => backendFetch('/api/flows/schedules').then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).finally(() => setLoading(false)), [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.name.trim()) return
    const body = JSON.stringify({ name: form.name, freq: form.freq, hour: form.hour, minute: form.minute, weekday: form.weekday })
    const r = editing
      ? await backendFetch(`/api/flows/schedules?id=${form.id}`, { method: 'PATCH', headers: H(), body })
      : await backendFetch('/api/flows/schedules', { method: 'POST', headers: H(), body })
    if (r.ok) { setForm({ ...blank }); load() }
  }
  const remove = async (id: number) => {
    if (!window.confirm('Delete this schedule? Flows using it will fall back to a custom schedule.')) return
    await backendFetch(`/api/flows/schedules?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-[820px] mx-auto">
      <Link href="/flows" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ArrowLeft className="h-4 w-4" /> Flows</Link>
      <h1 className="text-2xl font-bold text-gray-900">Schedules</h1>
      <p className="text-sm text-gray-500 mt-1">Reusable timers your scheduled flows can share. Edit one here and every flow using it updates.</p>

      {/* Add / edit */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Every morning" className={cls} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Frequency</label>
            <select value={form.freq} onChange={(e) => setForm({ ...form, freq: e.target.value })} className={cls}><option value="hourly">Every hour</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
          {form.freq === 'weekly' && (
            <div><label className="block text-xs text-gray-500 mb-1">Day of week</label>
              <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} className={cls}>{WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
          )}
          {form.freq !== 'hourly' && (
            <div><label className="block text-xs text-gray-500 mb-1">Time (IST)</label>
              <div className="flex items-center gap-2">
                <select value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className={cls}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}</select>
                <span className="text-gray-400">:</span>
                <select value={form.minute} onChange={(e) => setForm({ ...form, minute: Number(e.target.value) })} className={cls}>{[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}</select>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={save} disabled={!form.name.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"><Plus className="h-4 w-4" /> {editing ? 'Save changes' : 'Add schedule'}</button>
          {editing && <button onClick={() => setForm({ ...blank })} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>}
        </div>
      </div>

      {/* List */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
        {loading ? <div className="py-12 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
          : list.length === 0 ? <div className="py-12 text-center text-sm text-gray-400">No schedules yet.</div> : list.map((s) => (
          <div key={s.id} className="flex items-center gap-4 px-5 py-4 group">
            <span className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0"><Clock className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900">{s.name}</div>
              <div className="text-xs text-gray-400">{scheduleLabel(s as any)} · used by {s.flows} flow{s.flows === 1 ? '' : 's'}</div>
            </div>
            <button onClick={() => setForm({ id: s.id, name: s.name, freq: s.freq, hour: s.hour, minute: s.minute, weekday: s.weekday })} className="text-gray-300 hover:text-purple-600"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => remove(s.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
