import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isEmailConfigured } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/email/overview — counts + setup checklist state for the Email home.
export async function GET() {
  try {
    const [templates, layouts, senders, verifiedSenders] = await Promise.all([
      prisma.emailTemplate.count(),
      prisma.emailLayout.count(),
      prisma.emailSender.count(),
      prisma.emailSender.count({ where: { verified: true } }),
    ])
    const brevoConfigured = await isEmailConfigured()
    const steps = [
      { key: 'sender', label: 'Add an email sender', done: senders > 0 },
      { key: 'verified', label: 'Verify a sender / domain', done: verifiedSenders > 0 },
      { key: 'layout', label: 'Add a layout (optional)', done: layouts > 0, optional: true },
      { key: 'template', label: 'Create your first template', done: templates > 0 },
    ]
    return NextResponse.json({ templates, layouts, senders, verifiedSenders, brevoConfigured, steps })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
