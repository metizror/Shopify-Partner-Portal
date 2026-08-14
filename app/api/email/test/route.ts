import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { sendTemplateEmail, SAMPLE_VARS } from '@/services/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/email/test  body: { templateId, to, senderId? }
// Renders the template with sample data and emails it to `to`.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    const templateId = Number(b.templateId)
    const to = String(b.to || '')
    if (!templateId || !/.+@.+\..+/.test(to)) return NextResponse.json({ error: 'templateId and valid `to` required' }, { status: 400 })
    const res = await sendTemplateEmail(templateId, to, SAMPLE_VARS, b.senderId ? Number(b.senderId) : null)
    return NextResponse.json(res.ok ? { ok: true, sentTo: to } : { error: res.error }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
