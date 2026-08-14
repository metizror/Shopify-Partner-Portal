'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Mail, Trash2, Star, CheckCircle2 } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'

const H = () => ({ 'Content-Type': 'application/json' })
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200'

interface Sender { id: number; email: string; name: string; isDefault: boolean; verified: boolean }

export default function EmailSettingsPage() {
  const [senders, setSenders] = useState<Sender[]>([])
  const [form, setForm] = useState({ email: '', name: '' })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Team notification recipients (flow "Send email → my team").
  const [recipients, setRecipients] = useState<string[]>([])
  const [recEmail, setRecEmail] = useState('')
  const [recMsg, setRecMsg] = useState<string | null>(null)

  const load = useCallback(() => backendFetch('/api/email/senders').then((r) => r.json()).then((d) => setSenders(Array.isArray(d) ? d : [])).finally(() => setLoading(false)), [])
  const loadRecipients = useCallback(() => backendFetch('/api/email/recipients').then((r) => r.json()).then((d) => setRecipients(Array.isArray(d?.emails) ? d.emails : [])), [])
  useEffect(() => { load(); loadRecipients() }, [load, loadRecipients])

  const saveRecipients = async (next: string[]) => {
    setRecipients(next)
    const r = await backendFetch('/api/email/recipients', { method: 'PUT', headers: H(), body: JSON.stringify({ emails: next }) })
    if (r.ok) { setRecMsg('Saved'); setTimeout(() => setRecMsg(null), 1200) }
  }
  const addRecipient = () => {
    const e = recEmail.trim()
    if (!/.+@.+\..+/.test(e) || recipients.includes(e)) { setRecEmail(''); return }
    saveRecipients([...recipients, e]); setRecEmail('')
  }
  const removeRecipient = (e: string) => saveRecipients(recipients.filter((x) => x !== e))

  const add = async () => {
    setErr(null)
    const r = await backendFetch('/api/email/senders', { method: 'POST', headers: H(), body: JSON.stringify(form) })
    const d = await r.json()
    if (d.ok) { setForm({ email: '', name: '' }); load() } else setErr(d.error || 'failed')
  }
  const makeDefault = async (id: number) => {
    await backendFetch(`/api/email/senders?id=${id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ isDefault: true }) })
    load()
  }
  const remove = async (id: number) => {
    if (!window.confirm('Remove this sender?')) return
    await backendFetch(`/api/email/senders?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-[820px] mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
      <p className="text-sm text-gray-500 mt-1">Notification recipients and the from-addresses your emails are sent from</p>

      {/* Notification recipients */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Notification recipients</h2>
            <p className="text-xs text-gray-400 mt-0.5">Who gets flow emails when a Send email action is set to “my team” (e.g. install / uninstall alerts). Not the store merchant.</p>
          </div>
          {recMsg && <span className="text-xs text-emerald-600">{recMsg}</span>}
        </div>
        <div className="flex gap-2 mt-4">
          <input value={recEmail} onChange={(e) => setRecEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRecipient()} placeholder="alerts@yourteam.com" className={inp} />
          <button onClick={addRecipient} disabled={!recEmail.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"><Plus className="h-4 w-4" /> Add</button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {recipients.length === 0 ? <span className="text-sm text-gray-300">No recipients yet.</span> : recipients.map((e) => (
            <span key={e} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
              {e}<button onClick={() => removeRecipient(e)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        Senders must be verified in Brevo before mail will deliver. Add the same address here to use it as a from-address in templates &amp; flows.
      </div>

      {/* Add sender */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1"><label className="block text-xs text-gray-500 mb-1">From email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@yourdomain.com" className={inp} /></div>
        <div className="flex-1"><label className="block text-xs text-gray-500 mb-1">From name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your Brand" className={inp} /></div>
        <button onClick={add} disabled={!form.email} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"><Plus className="h-4 w-4" /> Add</button>
      </div>
      {err && <p className="text-xs text-red-500 mt-2">{err}</p>}

      {/* Sender list */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
        {loading ? (
          <div className="py-10 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
        ) : senders.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No senders yet.</div>
        ) : (
          senders.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3 group">
              <span className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0"><Mail className="h-4 w-4 text-gray-500" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900">{s.name} <span className="text-gray-400 font-normal">&lt;{s.email}&gt;</span></div>
                <div className="flex items-center gap-2 text-xs mt-0.5">
                  {s.verified ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Verified</span> : <span className="text-amber-600">Unverified</span>}
                  {s.isDefault && <span className="inline-flex items-center gap-1 text-purple-600"><Star className="h-3 w-3 fill-purple-600" /> Default</span>}
                </div>
              </div>
              {!s.isDefault && <button onClick={() => makeDefault(s.id)} className="text-xs text-gray-400 hover:text-purple-600">Make default</button>}
              <button onClick={() => remove(s.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
