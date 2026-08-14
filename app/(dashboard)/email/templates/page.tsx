'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, FileText, Trash2, Send, Save, Eye } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import RichTextEditor from '@/components/RichTextEditor'
import { applyVars, composeEmailHtml, MERGE_TAGS, SAMPLE_VARS } from '@/lib/email-html'

const H = () => ({ 'Content-Type': 'application/json' })

interface TplRow { id: number; name: string; subject: string; category: string; layoutId: number | null }
interface TplFull extends TplRow { bodyHtml: string }
interface Layout { id: number; name: string; headerHtml: string; footerHtml: string }
interface Sender { id: number; email: string; name: string; isDefault: boolean }

const CATEGORIES = ['transactional', 'onboarding', 'engagement', 'internal']
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200'

export default function EmailTemplatesPage() {
  const [list, setList] = useState<TplRow[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [sel, setSel] = useState<TplFull | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadList = useCallback(() => backendFetch('/api/email/templates').then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])), [])
  useEffect(() => {
    Promise.all([
      loadList(),
      backendFetch('/api/email/layouts').then((r) => r.json()).then((d) => setLayouts(Array.isArray(d) ? d : [])),
      backendFetch('/api/email/senders').then((r) => r.json()).then((d) => setSenders(Array.isArray(d) ? d : [])),
    ]).finally(() => setLoading(false))
  }, [loadList])

  const open = useCallback(async (id: number) => {
    const t = await backendFetch(`/api/email/templates/${id}`).then((r) => r.json())
    if (!t.error) { setSel(t); setDirty(false); setMsg(null) }
  }, [])

  // ?id=<n> deep-links straight into a template — used by the "Edit" link on the
  // sequence wizard's template slots.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('id'))
    if (id) open(id)
  }, [open])

  const createNew = async () => {
    const r = await backendFetch('/api/email/templates', {
      method: 'POST', headers: H(),
      body: JSON.stringify({ name: 'Untitled template', subject: 'Hello {{name}}', bodyHtml: '<p>Hi {{name}},</p>\n<p>Write your message here.</p>', category: 'transactional' }),
    })
    const d = await r.json()
    if (d.id) { await loadList(); open(d.id) }
  }

  const save = async () => {
    if (!sel) return
    setSaving(true)
    const r = await backendFetch(`/api/email/templates/${sel.id}`, {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ name: sel.name, subject: sel.subject, bodyHtml: sel.bodyHtml, category: sel.category, layoutId: sel.layoutId }),
    })
    setSaving(false)
    if (r.ok) { setDirty(false); setMsg('Saved'); loadList(); setTimeout(() => setMsg(null), 1500) }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this template?')) return
    await backendFetch(`/api/email/templates/${id}`, { method: 'DELETE' })
    if (sel?.id === id) setSel(null)
    loadList()
  }

  const sendTest = async () => {
    if (!sel || !testEmail) return
    setMsg('Sending…')
    const r = await backendFetch('/api/email/test', { method: 'POST', headers: H(), body: JSON.stringify({ templateId: sel.id, to: testEmail }) })
    const d = await r.json()
    setMsg(d.ok ? `Sent to ${d.sentTo}` : `Error: ${d.error}`)
  }

  const set = (patch: Partial<TplFull>) => { setSel((s) => (s ? { ...s, ...patch } : s)); setDirty(true) }

  // Rendered by the SAME composeEmailHtml() the send path uses (services/email.ts),
  // so this pane is exactly what Brevo delivers — not an approximation.
  const preview = useMemo(() => {
    if (!sel) return ''
    const layout = layouts.find((l) => l.id === sel.layoutId)
    return composeEmailHtml({
      header: layout?.headerHtml,
      body: sel.bodyHtml,
      footer: layout?.footerHtml,
      vars: SAMPLE_VARS,
    })
  }, [sel, layouts])

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Reusable emails your flows can send</p>
        </div>
        <button onClick={createNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> New Template</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 mt-6">
        {/* List */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {loading ? (
            <div className="py-12 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
          ) : list.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-gray-400">No templates yet.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {list.map((t) => (
                <li key={t.id}>
                  <button onClick={() => open(t.id)} className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3 ${sel?.id === t.id ? 'bg-purple-50' : ''}`}>
                    <FileText className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{t.name}</span>
                      <span className="block text-xs text-gray-400 truncate">{t.subject}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor */}
        {!sel ? (
          <div className="bg-white border border-gray-200 rounded-xl flex items-center justify-center py-24 text-sm text-gray-400">
            Select a template, or create a new one.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Fields */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Edit template</h3>
                <button onClick={() => remove(sel.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
              <Field label="Name"><input value={sel.name} onChange={(e) => set({ name: e.target.value })} className={inp} /></Field>
              <Field label="Subject"><input value={sel.subject} onChange={(e) => set({ subject: e.target.value })} className={inp} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={sel.category} onChange={(e) => set({ category: e.target.value })} className={`${inp} bg-white`}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Layout">
                  <select value={sel.layoutId ?? ''} onChange={(e) => set({ layoutId: e.target.value ? Number(e.target.value) : null })} className={`${inp} bg-white`}>
                    <option value="">None</option>
                    {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Body">
                <RichTextEditor
                  value={sel.bodyHtml}
                  onChange={(html) => set({ bodyHtml: html })}
                  mergeTags={MERGE_TAGS}
                />
              </Field>
              <p className="text-[11px] text-gray-400">Merge tags: {MERGE_TAGS.map((t) => `{{${t}}}`).join(' ')} — insert from the toolbar, or type them directly.</p>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
                <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" className={`${inp} flex-1`} />
                <button onClick={sendTest} disabled={!testEmail} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50"><Send className="h-3.5 w-3.5" /> Test</button>
              </div>
              {msg && <p className="text-xs text-gray-500">{msg}</p>}
            </div>

            {/* Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3"><Eye className="h-4 w-4 text-gray-400" /> Preview</h3>
              <div className="text-xs text-gray-400 mb-2">Subject: <span className="text-gray-700">{applyVars(sel.subject, SAMPLE_VARS)}</span></div>
              <iframe title="preview" srcDoc={preview} className="w-full h-[520px] border border-gray-100 rounded-lg bg-[#f4f5f7]" />
              <p className="text-[11px] text-gray-400 mt-2">Exactly what recipients receive — merge tags filled with sample data.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
