import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/customers/[domain]/comments  body: { body, author? }
// Adds a manual note to the customer's activity timeline.
export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const domain = decodeURIComponent((await params).domain)
    const { body, author } = await req.json().catch(() => ({}))
    if (!body || !String(body).trim()) return NextResponse.json({ error: 'empty comment' }, { status: 400 })
    const created = await prisma.timelineComment.create({
      data: { domain, body: String(body).slice(0, 5_000), author: author ? String(author).slice(0, 255) : null },
    })
    return NextResponse.json({ ok: true, id: created.id, at: created.createdAt.toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
