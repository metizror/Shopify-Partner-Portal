/**
 * Create a dashboard user, or set an existing one's password.
 *
 *   npx tsx scripts/set-password.ts <email> <password> [--name "Full Name"] [--role admin]
 *
 * The password is scrypt-hashed before it is written, so it never lands in the
 * table in plaintext. If the email already exists only the password is changed —
 * name, role and permissions are left alone.
 *
 * Run it on whichever machine's DATABASE_URL you want to touch: locally it picks
 * up .env, on the server run it from the app directory so it reads the server's
 * own .env. It never prints the password back.
 */
import '../lib/env'
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { hashPassword } from '../lib/password'

function parseDatabaseUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 5,
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const [email, password] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !isFlagValue(a))
  if (!email || !password) {
    console.error('usage: npx tsx scripts/set-password.ts <email> <password> [--name "Full Name"] [--role admin]')
    process.exit(1)
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL env var required')

  const adapter = new PrismaMariaDb(parseDatabaseUrl(url))
  const prisma = new PrismaClient({ adapter } as never)

  const hash = await hashPassword(password)
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    await prisma.user.update({ where: { email }, data: { password: hash } })
    console.log(`updated password for ${email} (id ${existing.id}, role ${existing.role})`)
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        password: hash,
        name: flag('name') || email.split('@')[0],
        // Only admins can log in (see app/api/auth/login/route.ts), so any
        // other --role creates a row that exists but cannot sign in.
        role: flag('role') || 'admin',
      },
    })
    console.log(`created ${email} (id ${created.id}, role ${created.role})`)
  }

  await (prisma as unknown as { $disconnect(): Promise<void> }).$disconnect()
}

/** True when this argv entry is the value belonging to a preceding --flag. */
function isFlagValue(arg: string): boolean {
  const i = process.argv.indexOf(arg)
  return i > 0 && process.argv[i - 1].startsWith('--')
}

main().catch((e) => { console.error(e); process.exit(1) })
