import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCustomerDetail } from '@/services/customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/customers/[domain] — full CRM detail.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  try {
    const domain = decodeURIComponent((await params).domain)
    const detail = await getCustomerDetail(domain)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// PATCH /api/customers/[domain] — update user-owned CRM fields (tags/notes/owner).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const domain = decodeURIComponent((await params).domain)
    const body = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (Array.isArray(body.tags)) data.tags = body.tags.map((t: unknown) => String(t)).slice(0, 50)
    if (typeof body.notes === 'string') data.notes = body.notes.slice(0, 10_000)
    if ('accountOwner' in body) data.accountOwner = body.accountOwner ? String(body.accountOwner).slice(0, 255) : null
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    const updated = await prisma.customer.update({ where: { domain }, data })
    return NextResponse.json({
      ok: true,
      tags: Array.isArray(updated.tags) ? updated.tags : [],
      notes: updated.notes || '',
      accountOwner: updated.accountOwner,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
