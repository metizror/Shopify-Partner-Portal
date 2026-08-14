import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/password'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Note the absent `password`. This endpoint used to return every user's
// plaintext password to the browser, which then did the login comparison in JS.
// Credentials are verified server-side by /api/auth/login now; nothing outside
// this process needs to read them back.
function rowToConfig(u: { id: number; email: string; name: string; role: string }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth) return auth
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } })
  return NextResponse.json(users.map(rowToConfig))
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth) return auth

  const body = await req.json()
  const { email, password, name, role } = body

  if (!email || !password || !name || !role) {
    return NextResponse.json({ error: 'email, password, name, role are required' }, { status: 400 })
  }

  const user = await prisma.user.create({
    data: {
      email,
      // Hashed here so a plaintext password never reaches the table, whatever
      // the caller sends.
      password: await hashPassword(String(password)),
      name,
      // Any role other than 'admin' creates a row that cannot log in — see
      // app/api/auth/login/route.ts.
      role,
    },
  })
  return NextResponse.json(rowToConfig(user), { status: 201 })
}
