'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, XCircle, RefreshCw, Star, Plus, Trash2, Users, AlertTriangle, Send } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'

const H = () => ({ 'Content-Type': 'application/json' })
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200'

type Provider = 'brevo' | 'smtp'

interface Config {
  provider: Provider
  configured: boolean
  source: 'database' | 'env' | 'none'
  brevoApiKeyMasked: string
  brevoFromEnv: boolean
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPasswordMasked: string
  smtpSecure: boolean
}

/**
 * Two-click remove: "Remove" arms, "Remove for good" fires, anything else
 * cancels. `warn` is shown while armed — the place to say what stops working.
 */
function ClearButton({ armed, busy, warn, onArm, onCancel, onConfirm }: {
  armed: boolean; busy: boolean; warn?: string
  onArm: () => void; onCancel: () => void; onConfirm: () => void
}) {
  if (!armed) {
    return (
      <button onClick={onArm} disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40">
        <Trash2 className="h-3.5 w-3.5" /> Remove
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      {warn && <span className="text-xs text-amber-600">{warn}</span>}
      <button onClick={onConfirm} disabled={busy}
        className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">Remove for good</button>
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
    </div>
  )
}

interface LiveSender { email: string; name: string; verified: boolean }
interface SavedSender { id: number; email: string; name: string; isDefault: boolean; verified: boolean }

export default function EmailConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Typed-in secrets. Empty means "leave whatever is saved alone" — the masked
  // value is all the server ever sends back, so there is nothing to round-trip.
  const [brevoKey, setBrevoKey] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtp, setSmtp] = useState({ host: '', port: 587, user: '', secure: false })
  const [provider, setProvider] = useState<Provider>('brevo')

  const [senders, setSenders] = useState<LiveSender[]>([])
  const [saved, setSaved] = useState<SavedSender[]>([])
  const [senderErr, setSenderErr] = useState<string | null>(null)
  const [senderBusy, setSenderBusy] = useState(false)
  const [picked, setPicked] = useState('')
  // Hand-entered from-address, for anything the provider cannot enumerate:
  // aliases, domain relays, every SMTP account but the login itself.
  const [manual, setManual] = useState({ email: '', name: '' })

  // Who the internal alerts go to. Same list the flow steps use, edited here so
  // the whole email setup is one page.
  const [recipients, setRecipients] = useState<string[]>([])
  const [recEmail, setRecEmail] = useState('')

  // Which "Remove" button is armed. Two clicks rather than a confirm() dialog:
  // deleting a key is one keystroke from unrecoverable (the server never sends
  // it back, so a mis-click means digging it out of Brevo again), and a modal
  // that blocks the page is a heavier interruption than the risk warrants.
  const [confirmClear, setConfirmClear] = useState<'brevo' | 'smtp' | null>(null)

  // Same idea for a saved from-address: the id awaiting confirmation. Deleting
  // the default one silently repoints every flow and campaign that relies on
  // it, so it should never happen on a single mis-aimed click.
  const [confirmSender, setConfirmSender] = useState<number | null>(null)

  // And for a team recipient: the address awaiting confirmation. Cheap to
  // retype, but removing the last one leaves install alerts with nowhere to go
  // and nothing else on the page would say so.
  const [confirmRecipient, setConfirmRecipient] = useState<string | null>(null)

  // Kept out of `msg` (which auto-clears after 4s): a 553 is long and you want
  // to read it, copy it, and still see it while you change a setting.
  const [testTo, setTestTo] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadConfig = useCallback(async () => {
    const d: Config = await backendFetch('/api/email/config').then((r) => r.json())
    setCfg(d)
    setProvider(d.provider)
    setSmtp({ host: d.smtpHost || '', port: d.smtpPort || 587, user: d.smtpUser || '', secure: !!d.smtpSecure })
    setLoading(false)
  }, [])

  const loadSenders = useCallback(async () => {
    setSenderBusy(true)
    try {
      const d = await backendFetch('/api/email/config/senders').then((r) => r.json())
      const live: LiveSender[] = Array.isArray(d?.senders) ? d.senders : []
      const rows: SavedSender[] = Array.isArray(d?.saved) ? d.saved : []
      setSenders(live)
      setSaved(rows)
      setSenderErr(d?.ok ? null : d?.error || null)

      // Show the address that is actually in force, rather than an empty
      // "Select an address…". The dropdown is the only thing on this page that
      // does not survive a reload, so leaving it blank reads as "my choice was
      // discarded" even though the default is saved and working.
      //
      // Only fills a blank selection: someone part-way through choosing a
      // different address keeps their pick when the list refreshes underneath
      // them.
      const current = rows.find((s) => s.isDefault)
      if (current && live.some((s) => s.email.toLowerCase() === current.email.toLowerCase())) {
        setPicked((p) => p || current.email)
      }
    } finally {
      setSenderBusy(false)
    }
  }, [])

  const loadRecipients = useCallback(async () => {
    const d = await backendFetch('/api/email/recipients').then((r) => r.json())
    setRecipients(Array.isArray(d?.emails) ? d.emails : [])
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])
  useEffect(() => { if (!loading) { loadSenders(); loadRecipients() } }, [loading, loadSenders, loadRecipients])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { provider }
      if (brevoKey.trim()) body.brevoApiKey = brevoKey.trim()
      if (smtpPassword.trim()) body.smtpPassword = smtpPassword.trim()
      body.smtpHost = smtp.host
      body.smtpPort = smtp.port
      body.smtpUser = smtp.user
      body.smtpSecure = smtp.secure

      const r = await backendFetch('/api/email/config', { method: 'PUT', headers: H(), body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok || d.error) { flash(false, d.error || 'Save failed'); return }
      setBrevoKey(''); setSmtpPassword('')
      await loadConfig()
      await loadSenders()
      flash(true, 'Saved')
    } finally {
      setSaving(false)
    }
  }

  // Wipe one provider's credentials. '' is the API's "clear this field" —
  // absent means "leave alone", which is what Save sends for a blank box.
  //
  // Clearing the provider currently in use is allowed and only warned about.
  // Someone rotating a leaked key wants it gone now, and refusing until they
  // have configured a replacement is how a leaked key stays live.
  const clearProvider = async (which: 'brevo' | 'smtp') => {
    setSaving(true)
    setConfirmClear(null)
    try {
      const body = which === 'brevo'
        ? { brevoApiKey: '' }
        : { smtpHost: '', smtpUser: '', smtpPassword: '', smtpSecure: false }

      const r = await backendFetch('/api/email/config', { method: 'PUT', headers: H(), body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok || d.error) { flash(false, d.error || 'Could not remove'); return }

      if (which === 'brevo') setBrevoKey('')
      else { setSmtpPassword(''); setSmtp({ host: '', port: 587, user: '', secure: false }) }
      await loadConfig()
      await loadSenders()
      flash(true, which === 'brevo' ? 'Brevo API key removed' : 'SMTP details removed')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setSaving(true)
    try {
      const d = await backendFetch('/api/email/config/test', { method: 'POST', headers: H() }).then((r) => r.json())
      flash(!!d.ok, d.detail || (d.ok ? 'OK' : 'Failed'))
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setSaving(true)
    setTestMsg(null)
    try {
      const d = await backendFetch('/api/email/config/test', {
        method: 'POST', headers: H(), body: JSON.stringify({ to: testTo.trim() }),
      }).then((r) => r.json())
      setTestMsg({ ok: !!d.ok, text: d.detail || (d.ok ? 'Sent' : 'Failed') })
    } finally {
      setSaving(false)
    }
  }

  // Import the chosen provider address into email_senders, where the rest of
  // the app (flows, campaigns, sequences) reads its from-address options.
  const useSender = async (makeDefault: boolean) => {
    const match = senders.find((s) => s.email === picked)
    if (!match) return
    setSenderBusy(true)
    try {
      const r = await backendFetch('/api/email/config/senders', {
        method: 'POST', headers: H(),
        body: JSON.stringify({ email: match.email, name: match.name, makeDefault }),
      })
      const d = await r.json()
      if (d.ok) { await loadSenders(); flash(true, makeDefault ? `Default from-address is now ${match.email}` : `${match.email} added`) }
      else flash(false, d.error || 'failed')
    } finally {
      setSenderBusy(false)
    }
  }

  // Add a from-address the provider does not list. Stored unverified, which is
  // only a warning: whether the server will relay it is between you and the
  // server, and plenty of working setups look like this.
  const addManual = async () => {
    const email = manual.email.trim().toLowerCase()
    if (!/.+@.+\..+/.test(email)) { flash(false, 'Enter a valid email address'); return }
    setSenderBusy(true)
    try {
      const d = await backendFetch('/api/email/config/senders', {
        method: 'POST', headers: H(),
        body: JSON.stringify({ email, name: manual.name.trim() || undefined }),
      }).then((r) => r.json())
      if (!d.ok) { flash(false, d.error || 'failed'); return }
      setManual({ email: '', name: '' })
      await loadSenders()
      flash(true, `${email} added`)
    } finally {
      setSenderBusy(false)
    }
  }

  const makeDefaultSaved = async (id: number, email: string) => {
    setSenderBusy(true)
    try {
      const d = await backendFetch(`/api/email/senders?id=${id}`, {
        method: 'PATCH', headers: H(), body: JSON.stringify({ isDefault: true }),
      }).then((r) => r.json())
      if (!d.ok) { flash(false, d.error || 'failed'); return }
      await loadSenders()
      flash(true, `Default from-address is now ${email}`)
    } finally {
      setSenderBusy(false)
    }
  }

  const removeSaved = async (id: number) => {
    setSenderBusy(true)
    setConfirmSender(null)
    try {
      await backendFetch(`/api/email/senders?id=${id}`, { method: 'DELETE', headers: H() })
      await loadSenders()
      flash(true, 'Address removed')
    } finally {
      setSenderBusy(false)
    }
  }

  const saveRecipients = async (next: string[]) => {
    const prev = recipients
    setRecipients(next)
    const r = await backendFetch('/api/email/recipients', {
      method: 'PUT', headers: H(), body: JSON.stringify({ emails: next }),
    })
    if (!r.ok) { setRecipients(prev); flash(false, 'Could not save recipients') }
  }

  const addRecipient = () => {
    const e = recEmail.trim().toLowerCase()
    if (!/.+@.+\..+/.test(e)) { flash(false, 'Enter a valid email address'); return }
    if (recipients.some((x) => x.toLowerCase() === e)) { setRecEmail(''); return }
    saveRecipients([...recipients, e])
    setRecEmail('')
  }

  if (loading) {
    return <div className="py-20 text-center"><div className="inline-block w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" /></div>
  }

  // Nothing to remove when nothing is stored. A key coming from BREVO_API_KEY
  // in .env is not this page's to delete — no Remove button for it, or the
  // click would appear to do nothing and the key would still be in use.
  const hasBrevo = !!cfg?.brevoApiKeyMasked && !cfg.brevoFromEnv
  const hasSmtp = !!(cfg?.smtpHost || cfg?.smtpUser || cfg?.smtpPasswordMasked)

  const savedEmails = new Set(saved.map((s) => s.email.toLowerCase()))
  const defaultSender = saved.find((s) => s.isDefault)
  const isDefault = (email: string) => !!email && !!defaultSender && defaultSender.email.toLowerCase() === email.toLowerCase()

  return (
    <div className="px-4 md:px-8 py-6 max-w-[820px] mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Email Configuration</h1>
      <p className="text-sm text-gray-500 mt-1">How this dashboard sends mail — install alerts, flows, campaigns and sequences all use it.</p>

      {/* Status */}
      <div className={`mt-6 rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${cfg?.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
        {cfg?.configured ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {cfg?.configured
          ? <>Sending via <strong>{cfg.provider === 'smtp' ? 'SMTP' : 'Brevo'}</strong>{cfg.source === 'env' && <span className="text-emerald-600"> — using BREVO_API_KEY from .env. Save a key below to manage it from here instead.</span>}</>
          : <>Email is not configured yet. Nothing will be delivered until you finish this page.</>}
      </div>

      {/* Provider choice */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700">Provider</h2>
        <p className="text-xs text-gray-400 mt-0.5">Both sets of credentials are kept. Only the selected one is used to send, so you can switch back without retyping anything.</p>
        <div className="flex gap-3 mt-4">
          {(['brevo', 'smtp'] as Provider[]).map((p) => (
            <button key={p} onClick={() => setProvider(p)}
              className={`flex-1 text-left px-4 py-3 rounded-lg border transition ${provider === p ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="text-sm font-medium text-gray-900">{p === 'brevo' ? 'Brevo API key' : 'SMTP server'}</div>
              <div className="text-xs text-gray-500 mt-0.5">{p === 'brevo' ? 'Sender addresses are listed for you automatically' : 'Any SMTP host — Gmail, Zoho, Postmark, your own relay'}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Brevo */}
      <div className={`mt-4 bg-white border rounded-xl p-5 ${provider === 'brevo' ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Brevo</h2>
          <div className="flex items-center gap-3">
            {provider !== 'brevo' && !confirmClear && <span className="text-xs text-gray-400">Saved, not active</span>}
            {hasBrevo && (
              <ClearButton armed={confirmClear === 'brevo'} busy={saving}
                warn={provider === 'brevo' ? 'This is the provider in use — sending will stop.' : undefined}
                onArm={() => setConfirmClear('brevo')} onCancel={() => setConfirmClear(null)}
                onConfirm={() => clearProvider('brevo')} />
            )}
          </div>
        </div>
        <label className="block text-xs text-gray-500 mt-4 mb-1">API key</label>
        <input type="password" value={brevoKey} onChange={(e) => setBrevoKey(e.target.value)}
          placeholder={cfg?.brevoApiKeyMasked || 'xkeysib-…'} className={inp} autoComplete="new-password" />
        <p className="text-xs text-gray-400 mt-1">
          {cfg?.brevoApiKeyMasked
            ? `A key is saved (${cfg.brevoApiKeyMasked}). Type a new one to replace it, or leave blank to keep it.`
            : 'Brevo → SMTP & API → API keys.'}
        </p>
      </div>

      {/* SMTP */}
      <div className={`mt-4 bg-white border rounded-xl p-5 ${provider === 'smtp' ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700">SMTP</h2>
          <div className="flex items-center gap-3">
            {provider !== 'smtp' && !confirmClear && <span className="text-xs text-gray-400">Saved, not active</span>}
            {hasSmtp && (
              <ClearButton armed={confirmClear === 'smtp'} busy={saving}
                warn={provider === 'smtp' ? 'This is the provider in use — sending will stop.' : undefined}
                onArm={() => setConfirmClear('smtp')} onCancel={() => setConfirmClear(null)}
                onConfirm={() => clearProvider('smtp')} />
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Host</label>
            <input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.yourhost.com" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Port</label>
            <input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            <input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder="you@yourdomain.com" className={inp} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={cfg?.smtpPasswordMasked || '••••••••'} className={inp} autoComplete="new-password" />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700">
          <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} className="rounded border-gray-300" />
          Use implicit TLS (port 465)
        </label>
        <p className="text-xs text-gray-400 mt-1">Leave this off for port 587 — the connection is upgraded with STARTTLS instead. Picking the wrong one usually looks like the send hanging.</p>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800">Save</button>
        <button onClick={test} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50">Test connection</button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</span>}
      </div>

      {/* A real send. "Test connection" only logs in — a server can accept the
          login and still refuse the From, which is what a silent no-mail
          problem usually turns out to be. */}
      <div className="mt-3 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700">Send a test email</h2>
        <p className="text-xs text-gray-500 mt-1">
          Sends one real message from your default from-address, through the same code every alert uses. If this fails, the error below is the exact reason your install and uninstall emails are not arriving.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendTest() }}
            placeholder="you@yourcompany.com" className={inp} />
          <button onClick={sendTest} disabled={saving || !testTo.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50 whitespace-nowrap">
            <Send className="h-4 w-4" /> Send test
          </button>
        </div>
        {testMsg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${testMsg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
            {testMsg.text}
          </div>
        )}
      </div>

      {/* From address */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">From address</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {provider === 'brevo'
                ? 'Every verified sender on this Brevo account. Pick one to make it available across flows, campaigns and sequences.'
                : 'SMTP cannot list addresses, so this is your SMTP username — the one address the account is certain to be allowed to send as. Add aliases by hand under Email → Senders.'}
            </p>
          </div>
          <button onClick={loadSenders} disabled={senderBusy} className="text-gray-400 hover:text-purple-600 disabled:opacity-40" title="Refresh from provider">
            <RefreshCw className={`h-4 w-4 ${senderBusy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {senderErr && <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">{senderErr}</div>}

        {senders.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <select value={picked} onChange={(e) => setPicked(e.target.value)} className={inp}>
              <option value="">Select an address…</option>
              {senders.map((s) => (
                <option key={s.email} value={s.email} disabled={!s.verified}>
                  {s.name} &lt;{s.email}&gt;{s.verified ? '' : ' — unverified'}
                  {isDefault(s.email) ? ' ✓ default' : savedEmails.has(s.email.toLowerCase()) ? ' ✓ added' : ''}
                </option>
              ))}
            </select>
            <button onClick={() => useSender(false)} disabled={!picked || senderBusy || savedEmails.has(picked.toLowerCase())}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50 whitespace-nowrap">
              <Plus className="h-4 w-4" /> Add
            </button>
            <button onClick={() => useSender(true)} disabled={!picked || senderBusy || isDefault(picked)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800 whitespace-nowrap">
              <Star className="h-4 w-4" /> {isDefault(picked) ? 'Default' : 'Use as default'}
            </button>
          </div>
        )}

        {/* Any address, not only the ones the provider can enumerate. */}
        <div className="mt-5 pt-5 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Or add an address by hand — an alias, or any mailbox your server is allowed to send as.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addManual() }}
              placeholder="alerts@yourdomain.com" className={inp} />
            <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addManual() }}
              placeholder="From name (optional)" className={inp} />
            <button onClick={addManual} disabled={!manual.email.trim() || senderBusy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 disabled:opacity-40 hover:bg-gray-50 whitespace-nowrap">
              <Plus className="h-4 w-4" /> Add address
            </button>
          </div>
        </div>

        {/* Everything the from-dropdowns across the app will offer. */}
        {saved.length > 0 && (
          <div className="mt-5 border border-gray-100 rounded-lg divide-y divide-gray-50">
            {saved.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 group">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 truncate">{s.name} <span className="text-gray-400">&lt;{s.email}&gt;</span></div>
                  <div className="flex items-center gap-2 text-[11px] mt-0.5">
                    {s.isDefault && <span className="inline-flex items-center gap-1 text-purple-600"><Star className="h-3 w-3 fill-purple-600" /> Default</span>}
                    {s.verified
                      ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Confirmed by provider</span>
                      : <span className="inline-flex items-center gap-1 text-amber-600" title="Your provider does not list this address. It still works if the server is allowed to send as it — otherwise sends are rejected."><AlertTriangle className="h-3 w-3" /> Not listed by provider</span>}
                  </div>
                </div>
                {confirmSender === s.id ? (
                  <div className="flex items-center gap-2">
                    {s.isDefault && <span className="text-xs text-amber-600">This is the default from-address.</span>}
                    <button onClick={() => removeSaved(s.id)} disabled={senderBusy}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">Remove</button>
                    <button onClick={() => setConfirmSender(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                ) : (
                  <>
                    {!s.isDefault && (
                      <button onClick={() => makeDefaultSaved(s.id, s.email)} disabled={senderBusy}
                        className="text-xs text-gray-400 hover:text-purple-600 disabled:opacity-40 whitespace-nowrap">Make default</button>
                    )}
                    <button onClick={() => setConfirmSender(s.id)} disabled={senderBusy}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 disabled:opacity-20"><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500">
          {defaultSender
            ? <>Mail is sent from <strong className="text-gray-800">{defaultSender.name} &lt;{defaultSender.email}&gt;</strong> unless a flow, campaign or sequence picks another one.</>
            : <>No default from-address yet — pick one above, or set one under Email → Senders.</>}
        </div>
      </div>

      {/* Team recipients */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" /> Team recipients</h2>
        <p className="text-xs text-gray-500 mt-1">
          Who receives internal notifications — install and uninstall alerts, and any flow step that sends “to my team”. Add as many people as you like.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <input value={recEmail} onChange={(e) => setRecEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRecipient() }}
            placeholder="teammate@yourcompany.com" className={inp} />
          <button onClick={addRecipient} disabled={!recEmail.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800 whitespace-nowrap">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {confirmRecipient && recipients.length === 1 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            That is the only recipient — remove it and install and uninstall alerts will have nowhere to go.
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          {recipients.length === 0
            ? <span className="text-sm text-gray-300">No recipients yet — internal alerts have nowhere to go.</span>
            : recipients.map((e) => (
              confirmRecipient === e ? (
                <span key={e} className="inline-flex items-center gap-2 pl-3 pr-2 py-1 rounded-full bg-red-50 border border-red-200 text-sm text-gray-700">
                  {e}
                  <button onClick={() => { setConfirmRecipient(null); saveRecipients(recipients.filter((x) => x !== e)) }}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600">Remove</button>
                  <button onClick={() => setConfirmRecipient(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </span>
              ) : (
                <span key={e} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-gray-100 text-sm text-gray-700">
                  {e}
                  <button onClick={() => setConfirmRecipient(e)} className="text-gray-400 hover:text-red-500">
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </span>
              )
            ))}
        </div>
      </div>
    </div>
  )
}
