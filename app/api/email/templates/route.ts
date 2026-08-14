import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/templates — list (no bodies).
export async function GET() {
  const rows = await prisma.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json(rows.map((t) => ({
    id: t.id, name: t.name, subject: t.subject, category: t.category, layoutId: t.layoutId,
    updatedAt: t.updatedAt.toISOString(),
  })))
}

// POST /api/email/templates  body: { name, subject, bodyHtml, category?, layoutId? }
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const created = await prisma.emailTemplate.create({
      data: {
        name: String(b.name).slice(0, 128),
        subject: String(b.subject || '').slice(0, 255),
        bodyHtml: String(b.bodyHtml || ''),
        category: b.category ? String(b.category).slice(0, 32) : 'transactional',
        layoutId: b.layoutId ? Number(b.layoutId) : null,
      },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
