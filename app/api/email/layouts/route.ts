import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/layouts
export async function GET() {
  const rows = await prisma.emailLayout.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json(rows.map((l) => ({ id: l.id, name: l.name, headerHtml: l.headerHtml, footerHtml: l.footerHtml })))
}

// POST /api/email/layouts  body: { name, headerHtml, footerHtml }
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const created = await prisma.emailLayout.create({
      data: { name: String(b.name).slice(0, 128), headerHtml: String(b.headerHtml || ''), footerHtml: String(b.footerHtml || '') },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// PATCH /api/email/layouts?id=1  body: { name?, headerHtml?, footerHtml? }
export async function PATCH(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (typeof b.name === 'string') data.name = b.name.slice(0, 128)
    if (typeof b.headerHtml === 'string') data.headerHtml = b.headerHtml
    if (typeof b.footerHtml === 'string') data.footerHtml = b.footerHtml
    await prisma.emailLayout.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/email/layouts?id=1
export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.emailTemplate.updateMany({ where: { layoutId: id }, data: { layoutId: null } })
    await prisma.emailLayout.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
