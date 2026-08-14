import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/customers/[domain]/contacts  body: { name, email?, role? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const domain = decodeURIComponent((await params).domain)
    const { name, email, role } = await req.json().catch(() => ({}))
    if (!name || !String(name).trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const created = await prisma.contact.create({
      data: {
        domain,
        name: String(name).slice(0, 255),
        email: email ? String(email).slice(0, 255) : null,
        role: role ? String(role).slice(0, 128) : null,
      },
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}

// DELETE /api/customers/[domain]/contacts?id=123
export async function DELETE(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.contact.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
