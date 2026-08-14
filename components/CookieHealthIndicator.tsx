'use client'

import { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from 'lucide-react'
import { backendFetch } from '@/lib/api-client'
import { formatShort } from '@/lib/tz'

interface Health {
  cookie_count: number
  has_session_cookie: boolean
  days_until_expiry: number | null
  session_valid: boolean | null
  session_expired: boolean | null
  health_reason: string | null
  checked_at: string | null
}

function authHeaders(): Record<string, string> {
  return {}
}

function formatIST(iso?: string | null): string {
  if (!iso) return ''
  try {
    return formatShort(iso)
  } catch {
    return iso
  }
}

export default function CookieHealthIndicator() {
  const [health, setHealth] = useState<Health | null>(null)
  const [checking, setChecking] = useState(true)

  const check = useCallback(async (live: boolean) => {
    setChecking(true)
    try {
      const r = await backendFetch(`/api/cookies${live ? '?live=1' : ''}`, { headers: authHeaders() })
      if (r.ok) setHealth(await r.json())
    } catch {
      /* ignore */
    } finally {
      setChecking(false)
    }
  }, [])

  // Show last-known instantly (cached), then run a fresh live check.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await backendFetch('/api/cookies', { headers: authHeaders() })
        if (r.ok && !cancelled) setHealth(await r.json())
      } catch { /* ignore */ }
      if (!cancelled) check(true)
    })()
    return () => { cancelled = true }
  }, [check])

  // Resolve a display state.
  let dot = 'bg-gray-300'
  let Icon = ShieldQuestion
  let iconColor = 'text-gray-400'
  let label = 'Session ?'
  let title = 'Partner session status unknown.'

  if (health) {
    if (!health.has_session_cookie || health.cookie_count === 0) {
      dot = 'bg-red-500'; Icon = ShieldAlert; iconColor = 'text-red-500'
      label = 'No cookies'
      title = 'No Partner session cookies stored. Add them under Cookies.'
    } else if (health.session_valid === true) {
      dot = 'bg-emerald-500'; Icon = ShieldCheck; iconColor = 'text-emerald-500'
      label = 'Session OK'
      title = `Partner session healthy${health.checked_at ? ` · checked ${formatIST(health.checked_at)}` : ''}.`
    } else if (health.session_valid === false && health.session_expired) {
      dot = 'bg-red-500'; Icon = ShieldAlert; iconColor = 'text-red-500'
      label = 'Session expired'
      title = health.health_reason || 'Partner session expired — refresh the cookies.'
    } else if (health.session_valid === false) {
      dot = 'bg-amber-500'; Icon = ShieldQuestion; iconColor = 'text-amber-500'
      label = 'Session ?'
      title = health.health_reason || 'Could not verify the Partner session right now.'
    } else {
      // session_valid === null → never checked live yet
      dot = 'bg-gray-300'; Icon = ShieldQuestion; iconColor = 'text-gray-400'
      label = 'Check session'
      title = 'Partner session not checked yet — click to run a live check.'
    }
  }

  return (
    <button
      onClick={() => check(true)}
      disabled={checking}
      title={`${title}${checking ? ' (checking…)' : ' — click to recheck'}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-70"
    >
      {checking ? (
        <Loader2 size={13} className="text-gray-400 animate-spin" />
      ) : (
        <span className="relative flex items-center">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
        </span>
      )}
      <Icon size={13} className={`hidden sm:inline ${iconColor}`} />
      <span className="hidden md:inline text-[11px] font-medium text-gray-600">{label}</span>
    </button>
  )
}
