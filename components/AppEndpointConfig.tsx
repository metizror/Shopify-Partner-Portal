'use client'

// Admin panel for one app's `shop-lookup` endpoint — the API we call when a
// store uninstalls, to pull install date, plan, usage duration and the last app
// user into the Flow uninstall email.
//
// The token is write-only: the API returns a masked hint, never the value, so
// leaving the field blank on save keeps whatever is stored.

import { useCallback, useEffect, useState } from 'react'
import {
  Plug, Loader2, CheckCircle2, XCircle, Save, Trash2, FlaskConical, AlertTriangle, Info,
} from 'lucide-react'
import { backendFetch } from '@/lib/api-client'

const H = () => ({ 'Content-Type': 'application/json' })
const inp =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200'

interface Endpoint {
  appId: string
  url: string
  authType: string
  authHeader: string | null
  tokenSet: boolean
  tokenHint: string | null
  shopParam: string
  timeoutMs: number
  enabled: boolean
  lastOkAt: string | null
  lastError: string | null
}

interface TestResult {
  ok: boolean
  status: string
  httpStatus: number | null
  error: string | null
  ms: number
  requestUrl: string
  normalized: Record<string, any> | null
  raw: Record<string, any> | null
}

const blank = {
  url: '',
  authType: 'header',
  authHeader: 'x-api-key',
  authToken: '',
  shopParam: 'domain',
  timeoutMs: 8000,
  enabled: true,
}

// How each fetch status reads to an admin.
const STATUS_COPY: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: 'Working', tone: 'ok' },
  stale: { label: "App doesn't know about the uninstall yet — will retry", tone: 'warn' },
  not_found: { label: 'App has no record of this shop (404)', tone: 'warn' },
  unauthorized: { label: 'Token rejected (401/403)', tone: 'bad' },
  failed: { label: 'Request failed', tone: 'bad' },
  no_endpoint: { label: 'No endpoint configured', tone: 'warn' },
}

export default function AppEndpointConfig({ appId }: { appId: string }) {
  const [form, setForm] = useState({ ...blank })
  const [saved, setSaved] = useState<Endpoint | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)

  const [testDomain, setTestDomain] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await backendFetch(`/api/app-endpoints?appId=${encodeURIComponent(appId)}`, { headers: H() })
      const rows: Endpoint[] = r.ok ? await r.json() : []
      const row = rows[0] || null
      setSaved(row)
      if (row) {
        setForm({
          url: row.url,
          authType: row.authType,
          authHeader: row.authHeader || '',
          authToken: '', // never populated — write-only
          shopParam: row.shopParam,
          timeoutMs: row.timeoutMs,
          enabled: row.enabled,
        })
      }
    } catch {
      setSaved(null)
    }
    setLoading(false)
  }, [appId])

  useEffect(() => { load() }, [load])

  const set = (k: string, v: any) => { setForm((f) => ({ ...f, [k]: v })); setMsg(null) }

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await backendFetch('/api/app-endpoints', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ appId, ...form }),
      })
      const j = await r.json()
      if (!r.ok) setMsg({ text: j.error || 'Could not save.', bad: true })
      else {
        setMsg({ text: 'Saved.' })
        setForm((f) => ({ ...f, authToken: '' }))
        await load()
      }
    } catch {
      setMsg({ text: 'Could not save.', bad: true })
    }
    setBusy(false)
  }

  const remove = async () => {
    setBusy(true)
    try {
      await backendFetch(`/api/app-endpoints?appId=${encodeURIComponent(appId)}`, { method: 'DELETE', headers: H() })
      setSaved(null)
      setForm({ ...blank })
      setResult(null)
      setMsg({ text: 'Endpoint removed.' })
    } catch {
      setMsg({ text: 'Could not remove.', bad: true })
    }
    setBusy(false)
  }

  const runTest = async () => {
    const domain = testDomain.trim().toLowerCase()
    if (!domain) { setMsg({ text: 'Enter a store domain to test.', bad: true }); return }
    setTesting(true)
    setResult(null)
    try {
      const r = await backendFetch('/api/app-endpoints/test', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ appId, domain, ...form }),
      })
      setResult(await r.json())
    } catch {
      setMsg({ text: 'Test request failed.', bad: true })
    }
    setTesting(false)
  }

  if (loading) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading endpoint config…
      </div>
    )
  }

  const tone = result ? STATUS_COPY[result.status]?.tone : null

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-purple-600" />
          <h3 className="text-sm font-semibold text-gray-900">Uninstall data endpoint</h3>
        </div>
        {saved && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              !saved.enabled
                ? 'bg-gray-50 text-gray-500 border-gray-200'
                : saved.lastError
                ? 'bg-red-50 text-red-600 border-red-200'
                : saved.lastOkAt
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {!saved.enabled ? 'Disabled' : saved.lastError ? 'Last call failed' : saved.lastOkAt ? 'Healthy' : 'Never called'}
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        Called when a store uninstalls this app, to fill{' '}
        <span className="text-gray-500">{'{{install_date}} {{plan}} {{usage_duration}} {{last_user_email}}'}</span> in
        Flow emails. The store domain is added automatically per call.
      </p>

      {saved?.lastError && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="break-words">{saved.lastError}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Endpoint URL</label>
          <input
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://yourapp.example.com/v2/api/admin/shop-lookup"
            className={inp}
          />
          <p className="text-[11px] text-gray-400 mt-1">Without a query string — the shop param is appended.</p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Auth type</label>
          <select value={form.authType} onChange={(e) => set('authType', e.target.value)} className={`${inp} bg-white`}>
            <option value="header">Custom header</option>
            <option value="bearer">Authorization: Bearer</option>
            <option value="query">Query parameter</option>
            <option value="none">None</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            {form.authType === 'query' ? 'Token param name' : 'Header name'}
          </label>
          <input
            value={form.authHeader}
            onChange={(e) => set('authHeader', e.target.value)}
            placeholder={form.authType === 'query' ? 'token' : 'x-api-key'}
            disabled={form.authType === 'bearer' || form.authType === 'none'}
            className={`${inp} disabled:bg-gray-50 disabled:text-gray-400`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">
            Token
            {saved?.tokenSet && (
              <span className="ml-2 text-gray-400 font-normal">stored: {saved.tokenHint}</span>
            )}
          </label>
          <input
            type="password"
            value={form.authToken}
            onChange={(e) => set('authToken', e.target.value)}
            placeholder={saved?.tokenSet ? 'Leave blank to keep the stored token' : 'Paste the app admin token'}
            autoComplete="new-password"
            className={inp}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Shop parameter name</label>
          <input value={form.shopParam} onChange={(e) => set('shopParam', e.target.value)} placeholder="domain" className={inp} />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Timeout (ms)</label>
          <input
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={form.timeoutMs}
            onChange={(e) => set('timeoutMs', Number(e.target.value))}
            className={inp}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="rounded" />
          Enabled
        </label>
        <span className="flex-1" />
        {saved && (
          <button
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
      </div>

      {msg && (
        <p className={`mt-2 text-xs ${msg.bad ? 'text-red-600' : 'text-emerald-600'}`}>{msg.text}</p>
      )}

      {/* ── Test ─────────────────────────────────────────────────────────── */}
      <div className="mt-6 pt-5 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical className="h-4 w-4 text-gray-400" />
          <h4 className="text-xs font-semibold text-gray-700">Test with a store domain</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={testDomain}
            onChange={(e) => setTestDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runTest() }}
            placeholder="store-name.myshopify.com"
            className={`${inp} flex-1 min-w-[220px]`}
          />
          <button
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Run test
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Uses the values above, so you can test before saving.</p>

        {result && (
          <div className="mt-3">
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                tone === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : tone === 'warn'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {tone === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="font-medium">
                  {STATUS_COPY[result.status]?.label || result.status}
                  {result.httpStatus ? ` · HTTP ${result.httpStatus}` : ''} · {result.ms}ms
                </p>
                {result.error && <p className="mt-0.5 break-words opacity-80">{result.error}</p>}
              </div>
            </div>

            {result.normalized && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                  <tbody>
                    {([
                      ['{{install_date}}', result.normalized.installDate],
                      ['{{uninstall_date}}', result.normalized.uninstallDate],
                      ['{{plan}}', result.normalized.planType],
                      ['{{previous_plan}}', result.normalized.previousPlan],
                      ['{{usage_duration}}', result.normalized.durationText],
                      ['{{usage_duration_days}}', result.normalized.durationDays],
                      ['{{last_user_email}}', result.normalized.lastUserEmail],
                      ['{{last_user_name}}', result.normalized.lastUserName],
                      ['{{last_user_at}}', result.normalized.lastAccessedAt],
                      ['{{shop_contact_email}}', result.normalized.contactEmail],
                      ['{{shop_contact_name}}', result.normalized.contactName],
                    ] as [string, any][]).map(([tag, val]) => (
                      <tr key={tag} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-1.5 bg-gray-50 font-mono text-[11px] text-gray-600 w-56">{tag}</td>
                        <td className="px-3 py-1.5 text-gray-800">
                          {val === null || val === undefined || val === ''
                            ? <span className="text-gray-300">empty</span>
                            : String(val)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.normalized.lastUserEmail && (
                  <div className="flex items-start gap-2 mt-2 text-[11px] text-gray-500">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      This app returned no last-user email — either it doesn&apos;t track app users, or this
                      store hasn&apos;t opened the app since tracking began. Use{' '}
                      <span className="font-mono">{'{{shop_contact_email}}'}</span> in the email as well.
                    </span>
                  </div>
                )}
              </div>
            )}

            {result.raw && (
              <div className="mt-2">
                <button onClick={() => setShowRaw((s) => !s)} className="text-[11px] text-purple-600 hover:underline">
                  {showRaw ? 'Hide' : 'Show'} raw response
                </button>
                {showRaw && (
                  <pre className="mt-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-700 overflow-x-auto">
                    {JSON.stringify(result.raw, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
