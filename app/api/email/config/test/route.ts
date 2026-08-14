import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { testEmailProvider, sendProviderTestEmail } from '@/services/email-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/email/config/test           — check the saved credentials, no send.
// POST /api/email/config/test  { to }   — send one real message to `to`.
//
// Two checks because they fail differently. Credentials can be perfect while
// every send is refused: the server authenticates you, then rejects the From
// with "553 Sender is not allowed to relay". Only the second form catches that,
// so it is the one to reach for when mail is silently not arriving.
//
// Always 200, with ok:false and the provider's own words in `detail`. The page
// renders that string verbatim, and "brevo 401: Key not found" tells you what
// to fix in a way that a red X does not.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const to = typeof body?.to === 'string' ? body.to.trim() : ''

  const result = to ? await sendProviderTestEmail(to) : await testEmailProvider()
  return NextResponse.json(result)
}
