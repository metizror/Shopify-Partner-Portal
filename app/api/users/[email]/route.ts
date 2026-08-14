import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/password'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth) return auth

  const { email: rawEmail } = await params
  const email = decodeURIComponent(rawEmail)
  const body = await req.json()

  // Only touch the password when one was actually supplied — `undefined` leaves
  // the column alone, so an edit that doesn't change the password can't blank it
  // or overwrite the hash with an empty string.
  const password = body.password ? await hashPassword(String(body.password)) : undefined

  const user = await prisma.user.update({
    where: { email },
    data: {
      email: body.email ?? email,
      password,
      name: body.name,
      role: body.role,
    },
  })

  return NextResponse.json({ ok: true, id: user.id })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth) return auth

  const { email: rawEmail } = await params
  const email = decodeURIComponent(rawEmail)

  await prisma.user.delete({ where: { email } })
  return NextResponse.json({ ok: true })
}
