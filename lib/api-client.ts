// Frontend → API client. Now that frontend and backend live in the same
// Next.js app, requests are same-origin and use relative paths — no
// NEXT_PUBLIC_BACKEND_URL needed.

/**
 * Build an API URL.
 *   '/api/dashboard'    → '/api/dashboard'        (passthrough)
 *   '/data.json'        → '/api/static/data.json' (legacy rewrite, kept so
 *                                                  page.tsx etc don't change)
 */
export function backendUrl(path: string): string {
  if (path.startsWith('/api/')) return path

  // Split the cache-buster querystring before checking extension.
  const qIdx = path.indexOf('?')
  const pathOnly = qIdx >= 0 ? path.slice(0, qIdx) : path
  const qs = qIdx >= 0 ? path.slice(qIdx) : ''

  if (pathOnly.endsWith('.json') || pathOnly.endsWith('.csv')) {
    const clean = pathOnly.startsWith('/') ? pathOnly.slice(1) : pathOnly
    return `/api/static/${clean}${qs}`
  }
  return path
}

/** fetch() wrapper — always relative, never cached. */
export function backendFetch(path: string, init?: RequestInit) {
  return fetch(backendUrl(path), {
    ...(init || {}),
    cache: 'no-store',
  })
}
