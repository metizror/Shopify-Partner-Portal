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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const { id } = await params
  const rowId = parseInt(id, 10)
  const body = await req.json().catch(() => ({}))

  const current = await prisma.shopifyPartner.findUnique({ where: { id: rowId } })
  if (!current) return NextResponse.json({ error: 'Partner not found.' }, { status: 404 })

  const partnerId = String(body.partnerId ?? '').trim()
  const orgName = String(body.orgName ?? '').trim()
  // Token is optional on edit — blank means "keep the existing token".
  const newToken = String(body.apiToken ?? '').trim()
  const apiToken = newToken || current.apiToken

  if (!partnerId || !orgName) {
    return NextResponse.json({ error: 'Partner ID and organisation name are required.' }, { status: 400 })
  }

  // Partner ID must stay unique across other rows.
  if (partnerId !== current.partnerId) {
    const clash = await prisma.shopifyPartner.findUnique({ where: { partnerId } })
    if (clash) {
      return NextResponse.json({ error: `A partner with ID "${partnerId}" already exists.` }, { status: 409 })
    }
  }

  // Re-verify the connection whenever the Partner ID or token changes.
  if (partnerId !== current.partnerId || newToken) {
    const check = await verifyPartnerConnection(partnerId, apiToken)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }
  }

  try {
    const row = await prisma.shopifyPartner.update({
      where: { id: rowId },
      data: { partnerId, orgName, apiToken },
    })
    return NextResponse.json({
      id: row.id,
      partnerId: row.partnerId,
      orgName: row.orgName,
      tokenMasked: maskToken(row.apiToken),
    })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `A partner with ID "${partnerId}" already exists.` }, { status: 409 })
    }
    throw e
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const { id } = await params
  await prisma.shopifyPartner.delete({ where: { id: parseInt(id, 10) } })
  return NextResponse.json({ ok: true })
}
