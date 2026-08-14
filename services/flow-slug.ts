// URL slug helpers for flows: generate a unique, human-readable handle from a
// flow name, and resolve a URL segment (slug OR numeric id) back to a flow id.

import { prisma } from '@/lib/db'

// Static sibling routes under /flows — a slug must never collide with these.
const RESERVED = new Set(['new', 'all', 'templates', 'overview', 'schedules'])

export function slugify(s: string): string {
  const base = (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return base || 'flow'
}

/** A slug unique across flows (append -2, -3… on collision). */
export async function uniqueFlowSlug(name: string, excludeId?: number): Promise<string> {
  let base = slugify(name)
  if (RESERVED.has(base)) base = `${base}-flow`
  let slug = base
  let i = 1
  // Bounded loop — 200 attempts is far beyond any realistic collision count.
  while (i < 200) {
    const existing = await prisma.flow.findUnique({ where: { slug }, select: { id: true } })
    if (!existing || existing.id === excludeId) return slug
    i++
    slug = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

/** Resolve a URL segment (slug or numeric id) to a flow id, or null. */
export async function resolveFlowId(key: string): Promise<number | null> {
  if (/^\d+$/.test(key)) {
    const f = await prisma.flow.findUnique({ where: { id: Number(key) }, select: { id: true } })
    return f?.id ?? null
  }
  const f = await prisma.flow.findUnique({ where: { slug: key }, select: { id: true } })
  return f?.id ?? null
}
