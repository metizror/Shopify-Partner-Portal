import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { getNotifyRecipients, setNotifyRecipients } from '@/services/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/recipients — the team notification addresses.
export async function GET() {
  return NextResponse.json({ emails: await getNotifyRecipients() })
}

// PUT /api/email/recipients  body: { emails: string[] }
export async function PUT(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    if (!Array.isArray(b.emails)) return NextResponse.json({ error: 'emails array required' }, { status: 400 })
    await setNotifyRecipients(b.emails.map((e: unknown) => String(e)))
    return NextResponse.json({ ok: true, emails: await getNotifyRecipients() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 })
  }
}
