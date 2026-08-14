import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PUT /api/customers/[domain]/fields  body: { key, value }
// Sets (or clears) a custom field value for this customer.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const domain = decodeURIComponent((await params).domain)
    const { key, value } = await req.json().catch(() => ({}))
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
    const def = await prisma.customFieldDef.findUnique({ where: { key: String(key) } })
    if (!def) return NextResponse.json({ error: 'unknown field' }, { status: 400 })
    const val = value == null ? null : String(value).slice(0, 2_000)
    await prisma.customFieldValue.upsert({
      where: { domain_fieldKey: { domain, fieldKey: String(key) } },
      create: { domain, fieldKey: String(key), value: val },
      update: { value: val },
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
