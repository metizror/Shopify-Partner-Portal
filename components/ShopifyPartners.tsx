'use client'

import { useState, useEffect } from 'react'
import { ShoppingBag, KeyRound, Building2, Hash, Save, Pencil, Trash2, Eye, EyeOff, Plus, X, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'

interface Partner {
  id: number
  partnerId: string
  orgName: string
  tokenMasked: string
}

type Counts = { installs: number; uninstalls: number }

interface PartnerForm {
  partnerId: string
  orgName: string
  apiToken: string
}

const EMPTY_FORM: PartnerForm = { partnerId: '', orgName: '', apiToken: '' }

// Auth rides on the httpOnly session cookie, which fetch sends automatically for
// same-origin requests — nothing secret is left for the client to carry.
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

export default function ShopifyPartners() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [stats, setStats] = useState<Record<string, Counts>>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [form, setForm] = useState<PartnerForm>(EMPTY_FORM)
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadPartners = async () => {
    try {
      const r = await backendFetch('/api/shopify-partners')
      if (r.ok) setPartners(await r.json())
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const r = await backendFetch('/api/shopify-apps/event-stats')
      if (r.ok) {
        const d = await r.json()
        setStats(d.byPartner || {})
      }
    } catch { /* ignore */ }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await backendFetch('/api/jobs/run/sync-today', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setSyncMsg(d.error || 'Sync failed.')
      } else {
        const res = d.result || {}
        setSyncMsg(`Synced ${res.updated ?? 0} app${res.updated === 1 ? '' : 's'}.`)
        await loadStats()
      }
    } catch {
      setSyncMsg('Could not reach the server.')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => { loadPartners(); loadStats() }, [])

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowToken(false)
    setError('')
    setModalOpen(true)
  }

  const openEdit = (p: Partner) => {
    setEditing(p)
    setForm({ partnerId: p.partnerId, orgName: p.orgName, apiToken: '' })
    setShowToken(false)
    setError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setError('')
  }

  const handleSave = async () => {
    const partnerId = form.partnerId.trim()
    const orgName = form.orgName.trim()
    const apiToken = form.apiToken.trim()

    if (!partnerId || !orgName || (!editing && !apiToken)) {
      setError('Partner ID, organisation name and API token are all required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const r = editing
        ? await backendFetch(`/api/shopify-partners/${editing.id}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ partnerId, orgName, apiToken }),
          })
        : await backendFetch('/api/shopify-partners', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ partnerId, orgName, apiToken }),
          })

      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      await loadPartners()
      setModalOpen(false)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: Partner) => {
    if (!confirm(`Remove "${p.orgName}" (Partner ID ${p.partnerId})?`)) return
    try {
      const r = await backendFetch(`/api/shopify-partners/${p.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (r.ok) setPartners((prev) => prev.filter((x) => x.id !== p.id))
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 w-full">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8 pt-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <ShoppingBag size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Shopify Partners</h1>
            <p className="text-sm text-gray-400">Connected Shopify Partner organisations</p>
          </div>
        </div>
        {partners.length > 0 && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {syncMsg && <span className="text-xs text-gray-500 hidden md:inline">{syncMsg}</span>}
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              title="Pull today's install/uninstall counts for all apps"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <Plus size={16} />
              Add Partner
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={26} className="text-emerald-500 animate-spin" />
        </div>
      ) : partners.length === 0 ? (
        /* ── Empty state ──────────────────────────────────────────── */
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 px-6 py-16 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <ShoppingBag size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">No Shopify partners yet</h2>
          <p className="text-sm text-gray-500 max-w-sm mb-6">
            You haven&apos;t connected any Shopify Partner organisation. Add one to get started.
          </p>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <Plus size={16} />
            Add Shopify Partner
          </button>
        </div>
      ) : (
        /* ── Partners list ────────────────────────────────────────── */
        <div className="flex flex-col gap-4">
          {partners.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <Building2 size={16} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.orgName}</p>
                    <p className="text-xs text-gray-400">Partner ID: {p.partnerId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                    aria-label="Edit partner"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                    aria-label="Delete partner"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <KeyRound size={13} className="text-gray-400" />
                <span className="font-mono break-all">{p.tokenMasked}</span>
              </div>
              {/* Today's install/uninstall counts (IST) across this partner's apps */}
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                  <CheckCircle2 size={13} />{stats[p.partnerId]?.installs ?? 0} installs today
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium">
                  <XCircle size={13} />{stats[p.partnerId]?.uninstalls ?? 0} uninstalls today
                </span>
                <span className="ml-auto text-[10px] text-gray-400">today (IST) · via Partner API</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add / Edit modal ───────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 md:p-7">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 p-1 rounded-md text-gray-400 hover:text-gray-600 disabled:opacity-40"
              aria-label="Close"
              disabled={saving}
            >
              <X size={18} />
            </button>

            <h2 className="text-base font-semibold text-gray-900 mb-1">
              {editing ? 'Edit Shopify Partner' : 'Add Shopify Partner'}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {editing ? 'Update your Shopify Partner details.' : 'Enter your Shopify Partner details.'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <Hash size={14} className="text-gray-400" />
                  Shopify Partner ID
                </label>
                <input
                  type="text"
                  value={form.partnerId}
                  onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                  placeholder="e.g. 1234567"
                  disabled={saving}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <Building2 size={14} className="text-gray-400" />
                  Shopify Organisation Name
                </label>
                <input
                  type="text"
                  value={form.orgName}
                  onChange={(e) => setForm({ ...form, orgName: e.target.value })}
                  placeholder="e.g. Acme Apps"
                  disabled={saving}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <KeyRound size={14} className="text-gray-400" />
                  Shopify Partner API token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={form.apiToken}
                    onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
                    placeholder={editing ? 'Leave blank to keep current token' : 'Partner API access token'}
                    disabled={saving}
                    className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-end gap-3 mt-7">
              <button
                onClick={closeModal}
                disabled={saving}
                className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? 'Connecting…' : editing ? 'Save Changes' : 'Save & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
