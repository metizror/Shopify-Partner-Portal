import { scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

/**
 * Password hashing.
 *
 * scrypt from node's own crypto — no new dependency, and unlike a plain SHA it is
 * deliberately slow and memory-hard, so a stolen `users` table can't be run
 * through a wordlist at any useful rate.
 *
 * Stored format (self-describing, so the cost parameters can be raised later
 * without invalidating existing hashes):
 *
 *   scrypt$<N>$<r>$<p>$<salt-base64>$<key-base64>
 *
 * That is ~130 chars, comfortably inside the VarChar(255) the column already has,
 * so no schema migration is needed.
 */

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

// ~100ms per hash on this hardware. Raising N later is safe: old hashes carry
// their own parameters, and verifyPassword() reads them from the string.
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
// Default maxmem (32MB) is too tight for N=16384,r=8 — 128*N*r is 16MB but node
// also counts scratch space, so give it room.
const MAXMEM = 64 * 1024 * 1024

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** True when `stored` is one of our scrypt strings rather than a legacy plaintext password. */
export function isHashed(stored: string): boolean {
  return stored.startsWith('scrypt$')
}

/**
 * Check a password against the stored value.
 *
 * Legacy plaintext rows still verify — the rows predate hashing and the bulk
 * migration may not have run on every environment yet. Callers should re-hash on
 * a successful legacy match (see the login route); once no plaintext rows remain,
 * the fallback branch can be deleted.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false

  if (!isHashed(stored)) {
    const a = Buffer.from(plain)
    const b = Buffer.from(stored)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const parts = stored.split('$')
  if (parts.length !== 6) return false
  const [, n, r, p, saltB64, keyB64] = parts

  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  const opts = { N: parseInt(n, 10), r: parseInt(r, 10), p: parseInt(p, 10), maxmem: MAXMEM }
  if (!opts.N || !opts.r || !opts.p || !expected.length) return false

  let actual: Buffer
  try {
    actual = await scryptAsync(plain, salt, expected.length, opts)
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Readable random password, for seeding accounts nobody has chosen a password for yet. */
export function generatePassword(): string {
  // Base64url minus lookalike characters, so it survives being read off a screen.
  const raw = randomBytes(18).toString('base64url').replace(/[loIO01]/g, '')
  return raw.slice(0, 16)
}
