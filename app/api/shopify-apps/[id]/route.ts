import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const { id } = await params
  await prisma.shopifyApp.delete({ where: { id: parseInt(id, 10) } })
  return NextResponse.json({ ok: true })
}
