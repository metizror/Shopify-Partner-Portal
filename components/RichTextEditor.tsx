'use client'

// A dependency-free WYSIWYG editor for email bodies. Writes plain HTML (the same
// string that gets sent), so there is no intermediate format to translate — the
// preview pane renders exactly what this produces. "</>" flips to raw-HTML mode
// for hand-tuning.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2, ImageIcon,
  AlignLeft, AlignCenter, AlignRight, Code2, Minus, Quote, Eraser, Braces,
  Table as TableIcon, Trash2,
} from 'lucide-react'

// Email clients strip <style> blocks, so every table rule has to ride along as an
// inline attribute. These are the styles the editor writes into the HTML itself —
// the .rte rules further down only affect how it looks while you're editing.
const TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:0 0 12px;font-size:14px'
const TD_STYLE = 'border:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top'
const TH_STYLE = `${TD_STYLE};background:#f9fafb;font-weight:600`

/** Email-safe table markup: presentation role, explicit borders, no CSS classes. */
function tableHtml(rows: number, cols: number, headerRow: boolean): string {
  const cell = (tag: 'td' | 'th', text: string) =>
    `<${tag} style="${tag === 'th' ? TH_STYLE : TD_STYLE}">${text}</${tag}>`
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    const head = headerRow && r === 0
    const cells = Array.from({ length: cols }, (_, c) =>
      cell(head ? 'th' : 'td', head ? `Column ${c + 1}` : '&nbsp;'),
    ).join('')
    out.push(`<tr>${cells}</tr>`)
  }
  // The trailing paragraph gives the caret somewhere to land after the table —
  // without it a table at the end of the body is impossible to type past.
  return `<table role="presentation" cellpadding="8" cellspacing="0" border="0" style="${TABLE_STYLE}"><tbody>${out.join('')}</tbody></table><p><br></p>`
}

/** An optgroup in the "Merge tag" dropdown. `hint` is appended to the group
 *  label to explain when the tags resolve (e.g. "uninstall flows only"). */
export interface MergeTagGroup {
  label: string
  tags: readonly string[]
  hint?: string
}

interface Props {
  value: string
  onChange: (html: string) => void
  /** Flat tag list. Ignored when `mergeTagGroups` is supplied. */
  mergeTags?: readonly string[]
  /** Grouped tag list — renders <optgroup>s instead of a flat list. */
  mergeTagGroups?: readonly MergeTagGroup[]
  minHeight?: number
}

type PendingLink = 'link' | 'image' | null

const btn = 'h-7 w-7 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900'
const btnOn = 'h-7 w-7 inline-flex items-center justify-center rounded bg-gray-900 text-white'

export default function RichTextEditor({ value, onChange, mergeTags = [], mergeTagGroups, minHeight = 280 }: Props) {
  // Normalise both prop shapes to one grouped list; an ungrouped list becomes a
  // single anonymous group so the render path below stays simple.
  const groups: readonly MergeTagGroup[] =
    mergeTagGroups && mergeTagGroups.length
      ? mergeTagGroups.filter((g) => g.tags.length)
      : mergeTags.length
      ? [{ label: '', tags: mergeTags }]
      : []
  const hasTags = groups.some((g) => g.tags.length > 0)

  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [source, setSource] = useState(false)
  const [pending, setPending] = useState<PendingLink>(null)
  const [url, setUrl] = useState('')
  const [gridOpen, setGridOpen] = useState(false)
  const [grid, setGrid] = useState({ r: 2, c: 3 })
  const [headerRow, setHeaderRow] = useState(true)
  const [inTable, setInTable] = useState(false)
  const [, force] = useState(0)

  // Push `value` in only when it differs from what the DOM already holds —
  // re-writing innerHTML on every keystroke would reset the caret to the top.
  useEffect(() => {
    const el = ref.current
    if (!el || source) return
    if (el.innerHTML !== value) el.innerHTML = value || ''
  }, [value, source])

  const emit = () => { const el = ref.current; if (el) onChange(el.innerHTML) }

  const saveSel = () => {
    const s = window.getSelection()
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0)
  }
  const restoreSel = () => {
    const r = savedRange.current
    ref.current?.focus()
    if (r) {
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    }
  }

  const exec = useCallback((cmd: string, arg?: string) => {
    restoreSel()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(cmd, false, arg)
    emit()
    force((n) => n + 1) // refresh the active-state highlights
  }, [])

  const active = (cmd: string) => {
    try { return document.queryCommandState(cmd) } catch { return false }
  }

  const applyUrl = () => {
    const clean = url.trim()
    if (clean) exec(pending === 'image' ? 'insertImage' : 'createLink', clean)
    setPending(null)
    setUrl('')
  }

  const insertTag = (tag: string) => {
    restoreSel()
    document.execCommand('insertText', false, `{{${tag}}}`)
    emit()
  }

  // --- Tables -------------------------------------------------------------
  // execCommand has no table support, so insertion is raw HTML and the
  // row/column edits below walk the DOM by hand.

  const insertTable = (rows: number, cols: number) => {
    restoreSel()
    document.execCommand('insertHTML', false, tableHtml(rows, cols, headerRow))
    emit()
    setGridOpen(false)
    // The caret lands in the paragraph after the table, so the row/column bar
    // stays hidden until the user clicks into a cell.
    setInTable(false)
    force((n) => n + 1)
  }

  /** The td/th holding the caret, or null when the caret is outside a table. */
  const cellFromSelection = (): HTMLTableCellElement | null => {
    if (typeof window === 'undefined') return null
    const s = window.getSelection()
    const live = s && s.rangeCount && ref.current?.contains(s.anchorNode) ? s.anchorNode : null
    let n: Node | null = live || savedRange.current?.startContainer || null
    while (n && n !== ref.current) {
      const tag = (n as HTMLElement).tagName
      if (tag === 'TD' || tag === 'TH') return n as HTMLTableCellElement
      n = n.parentNode
    }
    return null
  }

  const syncSel = () => { saveSel(); setInTable(!!cellFromSelection()); force((n) => n + 1) }

  const newCell = (head: boolean) => {
    const el = document.createElement(head ? 'th' : 'td')
    el.setAttribute('style', head ? TH_STYLE : TD_STYLE)
    el.innerHTML = '&nbsp;'
    return el
  }

  type TableOp = 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol' | 'delTable'

  const tableOp = (op: TableOp) => {
    const cell = cellFromSelection()
    const row = cell?.parentElement as HTMLTableRowElement | null
    const table = cell?.closest('table')
    if (!cell || !row || !table) return
    const idx = Array.from(row.cells).indexOf(cell)
    const rows = Array.from(table.rows)

    if (op === 'rowAbove' || op === 'rowBelow') {
      const tr = document.createElement('tr')
      // A new row is always body cells, even when cloned off the header row.
      for (let i = 0; i < row.cells.length; i++) tr.appendChild(newCell(false))
      row.parentElement?.insertBefore(tr, op === 'rowAbove' ? row : row.nextSibling)
    } else if (op === 'colLeft' || op === 'colRight') {
      const at = op === 'colLeft' ? idx : idx + 1
      for (const r of rows) {
        r.insertBefore(newCell(r.cells[0]?.tagName === 'TH'), r.cells[at] || null)
      }
    } else if (op === 'delRow') {
      if (rows.length <= 1) table.remove()
      else row.remove()
    } else if (op === 'delCol') {
      if (row.cells.length <= 1) table.remove()
      else for (const r of rows) r.cells[idx]?.remove()
    } else {
      table.remove()
    }

    // The saved range may now point at a detached node.
    savedRange.current = null
    setInTable(!!table.isConnected)
    emit()
    force((n) => n + 1)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-purple-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        <select
          onChange={(e) => { exec('formatBlock', e.target.value); e.target.selectedIndex = 0 }}
          disabled={source}
          className="h-7 text-xs border border-gray-200 rounded bg-white px-1.5 text-gray-600 mr-1 disabled:opacity-40"
        >
          <option value="">Style</option>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="pre">Code block</option>
        </select>

        <Tool icon={Bold} cmd="bold" exec={exec} active={active} disabled={source} title="Bold" />
        <Tool icon={Italic} cmd="italic" exec={exec} active={active} disabled={source} title="Italic" />
        <Tool icon={Underline} cmd="underline" exec={exec} active={active} disabled={source} title="Underline" />
        <Tool icon={Strikethrough} cmd="strikeThrough" exec={exec} active={active} disabled={source} title="Strikethrough" />
        <Sep />
        <Tool icon={List} cmd="insertUnorderedList" exec={exec} active={active} disabled={source} title="Bullet list" />
        <Tool icon={ListOrdered} cmd="insertOrderedList" exec={exec} active={active} disabled={source} title="Numbered list" />
        <Tool icon={Quote} cmd="formatBlock" arg="blockquote" exec={exec} active={() => false} disabled={source} title="Quote" />
        <Sep />
        <Tool icon={AlignLeft} cmd="justifyLeft" exec={exec} active={active} disabled={source} title="Align left" />
        <Tool icon={AlignCenter} cmd="justifyCenter" exec={exec} active={active} disabled={source} title="Align center" />
        <Tool icon={AlignRight} cmd="justifyRight" exec={exec} active={active} disabled={source} title="Align right" />
        <Sep />
        <button type="button" title="Link" disabled={source} onMouseDown={(e) => { e.preventDefault(); saveSel(); setPending('link') }} className={`${btn} disabled:opacity-40`}><Link2 className="h-3.5 w-3.5" /></button>
        <button type="button" title="Image" disabled={source} onMouseDown={(e) => { e.preventDefault(); saveSel(); setPending('image') }} className={`${btn} disabled:opacity-40`}><ImageIcon className="h-3.5 w-3.5" /></button>
        <div className="relative inline-flex">
          <button
            type="button"
            title="Insert table"
            disabled={source}
            onMouseDown={(e) => { e.preventDefault(); saveSel(); setGridOpen((o) => !o) }}
            className={`${gridOpen ? btnOn : btn} disabled:opacity-40`}
          >
            <TableIcon className="h-3.5 w-3.5" />
          </button>
          {gridOpen && (
            // preventDefault everywhere inside keeps the caret in the editor while
            // the picker is open, so the table lands where the user left off.
            <div onMouseDown={(e) => e.preventDefault()} className="absolute z-20 top-8 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
              <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(8, 14px)' }}>
                {Array.from({ length: 48 }, (_, i) => {
                  const r = Math.floor(i / 8) + 1
                  const c = (i % 8) + 1
                  const on = r <= grid.r && c <= grid.c
                  return (
                    <button
                      key={i}
                      type="button"
                      onMouseEnter={() => setGrid({ r, c })}
                      onClick={() => insertTable(r, c)}
                      className={`h-3.5 w-3.5 rounded-[2px] border ${on ? 'bg-purple-500 border-purple-500' : 'bg-white border-gray-200'}`}
                    />
                  )
                })}
              </div>
              <div className="flex items-center justify-between gap-3 mt-2 text-[11px] text-gray-500">
                <label className="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} className="h-3 w-3" />
                  Header row
                </label>
                <span className="tabular-nums">{grid.r} × {grid.c}</span>
              </div>
            </div>
          )}
        </div>
        <Tool icon={Minus} cmd="insertHorizontalRule" exec={exec} active={() => false} disabled={source} title="Divider" />
        <label title="Text color" className={`${btn} cursor-pointer relative disabled:opacity-40`}>
          <span className="h-3.5 w-3.5 rounded-sm border border-gray-300 bg-gradient-to-br from-gray-900 to-purple-500" />
          <input type="color" disabled={source} onMouseDown={saveSel} onChange={(e) => exec('foreColor', e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <Tool icon={Eraser} cmd="removeFormat" exec={exec} active={() => false} disabled={source} title="Clear formatting" />

        {hasTags && (
          <>
            <Sep />
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 pl-0.5"><Braces className="h-3 w-3" /></span>
            <select
              onMouseDown={saveSel}
              onChange={(e) => { if (e.target.value) insertTag(e.target.value); e.target.selectedIndex = 0 }}
              disabled={source}
              className="h-7 text-xs border border-gray-200 rounded bg-white px-1.5 text-gray-600 disabled:opacity-40"
            >
              <option value="">Merge tag</option>
              {groups.map((g, i) =>
                g.label ? (
                  <optgroup key={g.label} label={g.hint ? `${g.label} — ${g.hint}` : g.label}>
                    {g.tags.map((t) => <option key={t} value={t}>{`{{${t}}}`}</option>)}
                  </optgroup>
                ) : (
                  g.tags.map((t) => <option key={`${i}-${t}`} value={t}>{`{{${t}}}`}</option>)
                ),
              )}
            </select>
          </>
        )}

        <span className="flex-1" />
        <button
          type="button"
          title="Edit HTML source"
          onClick={() => setSource((s) => !s)}
          className={source ? btnOn : btn}
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Table controls — only while the caret sits inside a table */}
      {inTable && !source && (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-gray-100 bg-purple-50/50">
          <span className="text-[11px] font-medium text-gray-500 mr-1">Table</span>
          <TblBtn onClick={() => tableOp('rowAbove')}>+ Row above</TblBtn>
          <TblBtn onClick={() => tableOp('rowBelow')}>+ Row below</TblBtn>
          <TblBtn onClick={() => tableOp('colLeft')}>+ Col left</TblBtn>
          <TblBtn onClick={() => tableOp('colRight')}>+ Col right</TblBtn>
          <Sep />
          <TblBtn onClick={() => tableOp('delRow')} danger>Delete row</TblBtn>
          <TblBtn onClick={() => tableOp('delCol')} danger>Delete column</TblBtn>
          <TblBtn onClick={() => tableOp('delTable')} danger><Trash2 className="h-3 w-3" /> Table</TblBtn>
        </div>
      )}

      {/* Link / image URL bar */}
      {pending && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 bg-purple-50/60">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl() } if (e.key === 'Escape') setPending(null) }}
            placeholder={pending === 'image' ? 'https://…/image.png' : 'https://…'}
            className="flex-1 h-7 px-2 text-xs border border-gray-200 rounded bg-white focus:outline-none"
          />
          <button type="button" onClick={applyUrl} className="h-7 px-2.5 text-xs rounded bg-gray-900 text-white">Apply</button>
          <button type="button" onClick={() => { setPending(null); setUrl('') }} className="h-7 px-2 text-xs rounded text-gray-500 hover:bg-gray-100">Cancel</button>
        </div>
      )}

      {/* Editor surface */}
      {source ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{ minHeight }}
          className="w-full px-3 py-2 font-mono text-xs text-gray-700 resize-y focus:outline-none"
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={() => { saveSel(); emit() }}
          onKeyUp={syncSel}
          onMouseUp={syncSel}
          style={{ minHeight }}
          className="rte px-4 py-3 text-sm text-gray-800 leading-relaxed focus:outline-none overflow-auto"
        />
      )}

      <style>{`
        .rte:empty:before { content: 'Write your email…'; color: #9ca3af; }
        .rte p { margin: 0 0 12px; }
        .rte h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px; }
        .rte h2 { font-size: 18px; font-weight: 700; margin: 0 0 10px; }
        .rte h3 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
        .rte ul { list-style: disc; padding-left: 22px; margin: 0 0 12px; }
        .rte ol { list-style: decimal; padding-left: 22px; margin: 0 0 12px; }
        .rte a { color: #7c3aed; text-decoration: underline; }
        .rte img { max-width: 100%; height: auto; }
        .rte blockquote { border-left: 3px solid #e5e7eb; padding-left: 12px; color: #6b7280; margin: 0 0 12px; }
        .rte pre { background: #f3f4f6; padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
        .rte hr { border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0; }
        /* Mirrors the inline styles written into the HTML, plus an empty-cell
           outline so a blank table is still visible while editing. */
        .rte table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
        .rte th, .rte td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
        .rte th { background: #f9fafb; font-weight: 600; }
        .rte td:empty, .rte th:empty { min-width: 40px; height: 1.4em; }
      `}</style>
    </div>
  )
}

function Sep() { return <span className="w-px h-4 bg-gray-200 mx-1" /> }

function TblBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      // Same trick as Tool: never let the click steal focus from the caret.
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] border bg-white ${danger ? 'border-red-100 text-red-500 hover:bg-red-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  )
}

function Tool({ icon: Icon, cmd, arg, exec, active, disabled, title }: {
  icon: React.ElementType
  cmd: string
  arg?: string
  exec: (cmd: string, arg?: string) => void
  active: (cmd: string) => boolean
  disabled?: boolean
  title: string
}) {
  const on = !disabled && !arg && active(cmd)
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // onMouseDown + preventDefault keeps the text selection alive through the click.
      onMouseDown={(e) => { e.preventDefault(); exec(cmd, arg) }}
      className={`${on ? btnOn : btn} disabled:opacity-40`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}
