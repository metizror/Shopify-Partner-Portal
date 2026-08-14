'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

/* ── Profile ─────────────────────────────────────────────────────────────── */

/**
 * Mirrors PublicProfile in lib/user-profile.ts — role is the entire permission
 * model. The sections[]/canAdd/canEdit/canDelete/canSync/ownerFilter/orgs fields
 * that used to live here were never checked by any API route, and the helpers
 * built on them (canEditItem/canAddItem/canDeleteItem) had no callers once the
 * Projects, Automations and Partners pages were removed.
 */
export interface UserProfile {
  email: string
  name: string
  role: string
}

/* ── Context ─────────────────────────────────────────────────────────────── */

/**
 * Auth state.
 *
 * This file used to hold a hardcoded user table (plaintext passwords, committed
 * to git), pull the whole user table — passwords included — from /api/users, and
 * compare the password in the browser. All three are gone: credentials are only
 * ever checked by POST /api/auth/login, and the browser holds nothing but an
 * httpOnly session cookie it cannot read.
 */
interface AuthContextType {
  isAuthenticated: boolean
  user: UserProfile | null
  /** Resolves to null when signed in, otherwise the message to display. */
  login: (email: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Ask the server who the cookie belongs to. The profile comes from the DB on
  // every load, so a role change takes effect on the next refresh and there is
  // no cached profile in localStorage for anyone to edit.
  useEffect(() => {
    let cancelled = false

    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        setUser(data?.user ?? null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  /**
   * Returns null on success, or a message to show the user.
   *
   * It returns the server's message rather than a bare false because one failure
   * is not like the others: a rate-limited admin typing the *correct* password
   * needs to be told they are throttled, not "invalid email or password" — which
   * would send them off resetting a password that was never the problem.
   */
  const login = async (email: string, password: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email, password }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.user) {
        return typeof data?.error === 'string' ? data.error : 'Invalid email or password'
      }
      setUser(data.user)
      return null
    } catch {
      return 'Could not reach the server. Check your connection and try again.'
    }
  }

  const logout = async (): Promise<void> => {
    // Clear locally first so the UI never sits on a stale session if the request
    // fails; the cookie is httpOnly, so only the server can actually expire it.
    setUser(null)
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } catch {}
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        user,
        login,
        logout,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
