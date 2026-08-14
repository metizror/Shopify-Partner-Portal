// Fixed-window rate limiting, held in this process's memory.
//
// In memory rather than in the database on purpose: a limiter that writes a row
// per attempt hands an attacker a way to hammer your database instead of your
// login, and this dashboard is a single self-hosted Node process. The cost is
// that counters are per-process and reset on restart. If you ever run several
// instances behind a load balancer, each keeps its own tally and the effective
// limit multiplies by the instance count — swap the Map for Redis at that point.

interface Window {
  count: number
  /** Epoch ms at which the window expires and the counter starts over. */
  resetAt: number
}

/**
 * Above this many live keys the map is swept for expired windows, and if it is
 * still oversized the soonest-to-expire entries are evicted. Without a ceiling,
 * a caller keyed on a spoofable value (a forwarded IP header) could grow the map
 * until the process runs out of memory — the limiter would become the outage it
 * was added to prevent.
 */
const MAX_KEYS = 10_000

const windows = new Map<string, Window>()

function sweep(now: number): void {
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k)
  }
  if (windows.size <= MAX_KEYS) return
  // Still oversized after dropping expired entries: evict whatever expires
  // soonest. Those callers get a fresh allowance, which is the safe direction to
  // fail — an evicted attacker is merely back to square one, whereas evicting
  // nothing means falling over.
  const byExpiry = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  for (const [k] of byExpiry.slice(0, windows.size - MAX_KEYS)) windows.delete(k)
}

export interface RateLimitResult {
  allowed: boolean
  /** Attempts left in the current window; 0 once blocked. */
  remaining: number
  /** Whole seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number
}

/**
 * Count one attempt against `key` and report whether it may proceed.
 *
 * Call this only for attempts that should count. Rate limiting successful
 * requests would lock out the legitimate user who just proved who they are.
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  if (windows.size > MAX_KEYS) sweep(now)

  const existing = windows.get(key)
  const w = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs }
  w.count += 1
  windows.set(key, w)

  return {
    allowed: w.count <= limit,
    remaining: Math.max(0, limit - w.count),
    retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  }
}

/**
 * Report on `key` without counting an attempt, so a caller can reject a blocked
 * client before doing the expensive work (a database read, a scrypt comparison)
 * that the limit exists to protect.
 */
export function peek(key: string, limit: number): RateLimitResult {
  const now = Date.now()
  const w = windows.get(key)
  if (!w || w.resetAt <= now) return { allowed: true, remaining: limit, retryAfter: 0 }
  return {
    allowed: w.count <= limit,
    remaining: Math.max(0, limit - w.count),
    retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  }
}

/** Clear a key's window — call after a success so one bad streak isn't sticky. */
export function reset(key: string): void {
  windows.delete(key)
}

/**
 * Best-effort client IP.
 *
 * Behind nginx or any reverse proxy the socket address is the proxy's, so the
 * forwarded header is the only source. That header is trivially spoofed by a
 * direct caller, which is why it must never be the *only* thing a limit is keyed
 * on: pair it with something the attacker cannot vary, such as the account name
 * they are trying to break into. Returns null when there is no header to read,
 * so callers can decide rather than all collapsing onto one bucket.
 */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  // Leftmost entry is the original client; proxies append themselves rightwards.
  const first = fwd?.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip')?.trim() || null
}
