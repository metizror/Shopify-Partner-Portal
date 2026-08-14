import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { markContactEngagement } from '@/services/sequences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/sequences/[id]/mark — { contactId, engaged: 'replied'|'opened'|'unsubscribed'|'none' }
// The manual engagement control: marking replied/opened stops all further
// follow-ups to that contact; 'none' undoes a wrong mark.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  const id = Number((await params).id)
  const b = await req.json().catch(() => ({}))
  const engaged = String(b.engaged || '')
  if (!['none', 'opened', 'replied', 'unsubscribed'].includes(engaged)) {
    return NextResponse.json({ error: 'invalid engaged value' }, { status: 400 })
  }
  const contact = await prisma.sequenceContact.findUnique({ where: { id: Number(b.contactId) } })
  if (!contact || contact.sequenceId !== id) return NextResponse.json({ error: 'contact not found' }, { status: 404 })
  const res = await markContactEngagement(contact.id, engaged as any)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
