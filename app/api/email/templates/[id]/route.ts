import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/templates/[id] — full template (for the editor).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const t = await prisma.emailTemplate.findUnique({ where: { id } })
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    id: t.id, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml, category: t.category, layoutId: t.layoutId,
  })
}

// PATCH /api/email/templates/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number((await params).id)
    const b = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (typeof b.name === 'string') data.name = b.name.slice(0, 128)
    if (typeof b.subject === 'string') data.subject = b.subject.slice(0, 255)
    if (typeof b.bodyHtml === 'string') data.bodyHtml = b.bodyHtml
    if (typeof b.category === 'string') data.category = b.category.slice(0, 32)
    if ('layoutId' in b) data.layoutId = b.layoutId ? Number(b.layoutId) : null
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    await prisma.emailTemplate.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/email/templates/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number((await params).id)
    await prisma.emailTemplate.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
