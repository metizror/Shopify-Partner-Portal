'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Megaphone,
  UploadCloud,
  FileSpreadsheet,
  Trash2,
  Search,
  Loader2,
  AlertCircle,
  Download,
  Mail,
  Clock,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { backendFetch } from '@/lib/api-client'
import { formatDayTime } from '@/lib/tz'

const authHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json' })

// A parsed sheet: the header row (column names) plus every data row as an
// array of cell strings aligned to those headers.
interface ParsedSheet {
  fileName: string
  sheetName: string
  headers: string[]
  rows: string[][]
  importedAt: string
}

interface SavedCampaign {
  id: number; name: string; fileName: string; status: string
  totalCount: number; sentCount: number; failedCount: number
  scheduledAt: string | null; createdAt: string
}

const STORAGE_KEY = 'campaign_import_v1'
const ACCEPT = '.xlsx,.xls,.csv'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500', sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700', scheduled: 'bg-amber-50 text-amber-700',
  paused: 'bg-gray-100 text-gray-500', cancelled: 'bg-gray-100 text-gray-400',
}

// Scheduled times are shown in IST, matching the rest of the dashboard.
const formatIST = formatDayTime

// Read a File as an ArrayBuffer (SheetJS reads the raw bytes for .xlsx/.xls;
// CSV works the same way).
function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsArrayBuffer(file)
  })
}

// Parse the first sheet into headers + rows. The first non-empty row is taken
// as the header; blank trailing columns are trimmed to the widest data row.
function parseWorkbook(buf: ArrayBuffer, fileName: string): ParsedSheet {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no sheets.')
  const ws = wb.Sheets[sheetName]
  // defval keeps empty cells as '' so columns stay aligned across rows.
  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })

  const nonEmpty = matrix.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (nonEmpty.length === 0) throw new Error('The sheet is empty.')

  const rawHeaders = nonEmpty[0].map((c) => String(c).trim())
  const width = rawHeaders.length
  const headers = rawHeaders.map((h, i) => h || `Column ${i + 1}`)
  const rows = nonEmpty.slice(1).map((r) => {
    const cells = r.map((c) => String(c).trim())
    // pad/truncate to header width
    return Array.from({ length: width }, (_, i) => cells[i] ?? '')
  })

  return {
    fileName,
    sheetName,
    headers,
    rows,
    importedAt: new Date().toISOString(),
  }
}

export default function CampaignImport() {
  const router = useRouter()
  const [data, setData] = useState<ParsedSheet | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SavedCampaign[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const loadSaved = () => {
    backendFetch('/api/campaigns').then((r) => { if (r.ok) r.json().then(setSaved) }).catch(() => {})
  }

  // Restore the last import so the list survives a page refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setData(JSON.parse(raw))
    } catch { /* ignore corrupt cache */ }
    loadSaved()
  }, [])

  const cancelSchedule = async (id: number) => {
    if (!confirm('Cancel this scheduled send? It will not go out.')) return
    await backendFetch(`/api/campaigns/${id}/cancel`, { method: 'POST', headers: authHeaders(), body: '{}' })
    loadSaved()
  }

  const scheduled = saved.filter((s) => s.status === 'scheduled')

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setParsing(true)
    try {
      const buf = await readFile(file)
      const parsed = parseWorkbook(buf, file.name)
      setData(parsed)
      setQuery('')
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)) } catch { /* quota */ }
    } catch (e: any) {
      setError(e?.message || 'Could not read that file. Use a .xlsx, .xls or .csv export.')
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const clearAll = () => {
    setData(null)
    setQuery('')
    setError('')
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.rows
    return data.rows.filter((r) => r.some((c) => c.toLowerCase().includes(q)))
  }, [data, query])

  // Persist the sheet as a campaign, then jump to the compose/send screen.
  const useForEmail = async () => {
    if (!data) return
    setSaving(true)
    setError('')
    try {
      const rows = data.rows.map((r) => {
        const obj: Record<string, string> = {}
        data.headers.forEach((h, i) => { obj[h] = r[i] ?? '' })
        return obj
      })
      const res = await backendFetch('/api/campaigns', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: data.fileName.replace(/\.[^.]+$/, ''),
          fileName: data.fileName,
          sheetName: data.sheetName,
          headers: data.headers,
          rows,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.id) {
        setError(d.error || 'Could not save the campaign. Please try again.')
        return
      }
      router.push(`/shopify/campaign/${d.id}`)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Download the current (filtered) list back out as a CSV.
  const exportCsv = () => {
    if (!data) return
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = [data.headers, ...filtered].map((r) => r.map(esc).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `campaign-${data.fileName.replace(/\.[^.]+$/, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 w-full">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8 pt-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Megaphone size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Campaign</h1>
            <p className="text-sm text-gray-400">Import a campaign list from an Excel or CSV file</p>
          </div>
        </div>
        {data && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Download size={15} />
              Export CSV
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <UploadCloud size={16} />
              Replace file
            </button>
            <button
              onClick={useForEmail}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {saving ? 'Saving…' : 'Send email'}
            </button>
          </div>
        )}
      </header>

      {/* Hidden file input, shared by the dropzone and header button */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Scheduled emails — pending scheduled sends; each drops off once delivered */}
      {scheduled.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
            <Clock size={13} /> Scheduled emails
          </p>
          <div className="flex flex-col gap-2">
            {scheduled.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-white rounded-xl border border-amber-200 shadow-sm px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <Clock size={16} className="text-amber-600" />
                </div>
                <button onClick={() => router.push(`/shopify/campaign/${s.id}`)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {s.scheduledAt ? `Sends ${formatIST(s.scheduledAt)}` : 'Scheduled'} · {s.totalCount} recipients
                  </p>
                </button>
                <button
                  onClick={() => cancelSchedule(s.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors shrink-0"
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved campaigns — jump back into a persisted campaign to send / track it */}
      {saved.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Saved campaigns</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {saved.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/shopify/campaign/${s.id}`)}
                className="text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-emerald-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-gray-900 truncate">{s.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
                </div>
                <p className="text-xs text-gray-400">
                  {s.totalCount} rows · {s.sentCount} sent{s.failedCount > 0 ? ` · ${s.failedCount} failed` : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!data ? (
        /* ── Empty state / dropzone ─────────────────────────────────── */
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          onClick={() => !parsing && inputRef.current?.click()}
          className={`cursor-pointer bg-white rounded-2xl border-2 border-dashed px-6 py-16 flex flex-col items-center text-center transition-colors ${
            dragOver ? 'border-emerald-400 bg-emerald-50/50' : 'border-gray-300 hover:border-emerald-300'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            {parsing ? (
              <Loader2 size={26} className="text-emerald-500 animate-spin" />
            ) : (
              <UploadCloud size={26} className="text-emerald-500" />
            )}
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {parsing ? 'Reading your file…' : 'Import a campaign list'}
          </h2>
          <p className="text-sm text-gray-500 max-w-sm mb-6">
            Drag &amp; drop an Excel or CSV file here, or click to browse. The first row is used as
            column headers.
          </p>
          <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium">
            <FileSpreadsheet size={16} />
            Choose file
          </span>
          <p className="mt-4 text-xs text-gray-400">Supports .xlsx, .xls and .csv</p>
        </div>
      ) : (
        /* ── Imported list ──────────────────────────────────────────── */
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={16} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{data.fileName}</p>
                <p className="text-xs text-gray-400">
                  {data.rows.length} row{data.rows.length === 1 ? '' : 's'} · {data.headers.length} column
                  {data.headers.length === 1 ? '' : 's'} · sheet “{data.sheetName}”
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search rows…"
                  className="w-48 pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
              </div>
              <button
                onClick={clearAll}
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                aria-label="Clear import"
                title="Clear import"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-400 w-12">#</th>
                  {data.headers.map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={data.headers.length + 1} className="px-4 py-10 text-center text-sm text-gray-400">
                      No rows match “{query}”.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50/70">
                      <td className="px-4 py-2.5 text-gray-400 tabular-nums">{ri + 1}</td>
                      {data.headers.map((_, ci) => (
                        <td key={ci} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                          {row[ci]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {query && (
            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
              Showing {filtered.length} of {data.rows.length} rows
            </div>
          )}
        </div>
      )}
    </div>
  )
}
