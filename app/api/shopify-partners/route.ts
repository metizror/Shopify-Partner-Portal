import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { verifyPartnerConnection } from '@/services/shopify-partner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••'
  return `${token.slice(0, 4)}${'•'.repeat(Math.max(4, token.length - 8))}${token.slice(-4)}`
}

export async function GET() {
  const rows = await prisma.shopifyPartner.findMany({ orderBy: { createdAt: 'desc' } })
  // Never expose the raw token to the client — return a masked version only.
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      partnerId: r.partnerId,
      orgName: r.orgName,
      tokenMasked: maskToken(r.apiToken),
    })),
  )
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const partnerId = String(body.partnerId ?? '').trim()
  const orgName = String(body.orgName ?? '').trim()
  const apiToken = String(body.apiToken ?? '').trim()

  if (!partnerId || !orgName || !apiToken) {
    return NextResponse.json({ error: 'Partner ID, organisation name and API token are all required.' }, { status: 400 })
  }

  // Partner ID must be unique.
  const existing = await prisma.shopifyPartner.findUnique({ where: { partnerId } })
  if (existing) {
    return NextResponse.json({ error: `A partner with ID "${partnerId}" already exists.` }, { status: 409 })
  }

  // Only persist after the connection is verified against the Shopify Partner API.
  const check = await verifyPartnerConnection(partnerId, apiToken)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 })
  }

  try {
    const row = await prisma.shopifyPartner.create({ data: { partnerId, orgName, apiToken } })
    return NextResponse.json(
      { id: row.id, partnerId: row.partnerId, orgName: row.orgName, tokenMasked: maskToken(row.apiToken) },
      { status: 201 },
    )
  } catch (e: any) {
    // Unique-constraint backstop in case of a race.
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `A partner with ID "${partnerId}" already exists.` }, { status: 409 })
    }
    throw e
  }
}
