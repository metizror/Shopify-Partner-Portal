'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, Layout as LayoutIcon, Trash2, Save, Eye } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { composeEmailHtml, SAMPLE_VARS } from '@/lib/email-html'

const H = () => ({ 'Content-Type': 'application/json' })
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200'

interface Layout { id: number; name: string; headerHtml: string; footerHtml: string }

// Starting point for a new layout — neutral on purpose. This is an editor:
// whoever creates the layout puts their own name in. Nothing here is sent
// without being saved first, so there is no branding to inherit from env.
const DEFAULT_HEADER = '<div style="background:#111827;padding:16px;text-align:center"><span style="color:#fff;font-weight:bold;font-size:18px">Your Brand</span></div>'
const DEFAULT_FOOTER = '<div style="background:#f9fafb;padding:16px;text-align:center;color:#6b7280;font-size:12px">© Your Company · <a href="#" style="color:#6b7280">Unsubscribe</a></div>'

export default function EmailLayoutsPage() {
  const [list, setList] = useState<Layout[]>([])
  const [sel, setSel] = useState<Layout | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => backendFetch('/api/email/layouts').then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).finally(() => setLoading(false)), [])
  useEffect(() => { load() }, [load])

  const createNew = async () => {
    const r = await backendFetch('/api/email/layouts', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'Untitled layout', headerHtml: DEFAULT_HEADER, footerHtml: DEFAULT_FOOTER }) })
    const d = await r.json()
    if (d.id) { await load(); setSel({ id: d.id, name: 'Untitled layout', headerHtml: DEFAULT_HEADER, footerHtml: DEFAULT_FOOTER }); setDirty(false) }
  }
  const save = async () => {
    if (!sel) return
    const r = await backendFetch(`/api/email/layouts?id=${sel.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ name: sel.name, headerHtml: sel.headerHtml, footerHtml: sel.footerHtml }) })
    if (r.ok) { setDirty(false); setMsg('Saved'); load(); setTimeout(() => setMsg(null), 1500) }
  }
  const remove = async (id: number) => {
    if (!window.confirm('Delete this layout? Templates using it will be unlinked.')) return
    await backendFetch(`/api/email/layouts?id=${id}`, { method: 'DELETE' })
    if (sel?.id === id) setSel(null)
    load()
  }
  const set = (patch: Partial<Layout>) => { setSel((s) => (s ? { ...s, ...patch } : s)); setDirty(true) }

  // Same email shell the send path uses, so the header/footer sit exactly where
  // they will in a real send.
  const preview = useMemo(() => sel
    ? composeEmailHtml({
        header: sel.headerHtml,
        body: '<p>Your email content appears here.</p><p>A second paragraph, so you can see the spacing.</p>',
        footer: sel.footerHtml,
        vars: SAMPLE_VARS,
      })
    : '', [sel])

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Layouts</h1>
          <p className="text-sm text-gray-500 mt-1">Header &amp; footer wrappers shared across templates</p>
        </div>
        <button onClick={createNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> New Layout</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 mt-6">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          {loading ? (
            <div className="py-12 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
          ) : list.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-gray-400">No layouts yet.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {list.map((l) => (
                <li key={l.id}>
                  <button onClick={() => { setSel(l); setDirty(false) }} className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 ${sel?.id === l.id ? 'bg-purple-50' : ''}`}>
                    <LayoutIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{l.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!sel ? (
          <div className="bg-white border border-gray-200 rounded-xl flex items-center justify-center py-24 text-sm text-gray-400">Select a layout, or create one.</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Edit layout</h3>
                <button onClick={() => remove(sel.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">Name</label><input value={sel.name} onChange={(e) => set({ name: e.target.value })} className={inp} /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Header HTML</label><textarea value={sel.headerHtml} onChange={(e) => set({ headerHtml: e.target.value })} rows={6} className={`${inp} font-mono text-xs resize-y`} /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Footer HTML</label><textarea value={sel.footerHtml} onChange={(e) => set({ footerHtml: e.target.value })} rows={6} className={`${inp} font-mono text-xs resize-y`} /></div>
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <button onClick={save} disabled={!dirty} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"><Save className="h-3.5 w-3.5" /> Save</button>
                {msg && <span className="text-xs text-emerald-600">{msg}</span>}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3"><Eye className="h-4 w-4 text-gray-400" /> Preview</h3>
              <iframe title="layout-preview" srcDoc={preview} className="w-full h-[420px] border border-gray-100 rounded-lg bg-[#f4f5f7]" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
