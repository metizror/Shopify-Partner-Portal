/**
 * One-off migration: replace every plaintext password in the `users` table with
 * an scrypt hash.
 *
 *   npx tsx scripts/hash-passwords.ts          # dry run — reports, changes nothing
 *   npx tsx scripts/hash-passwords.ts --write  # actually rewrites the rows
 *
 * Idempotent: rows already holding a `scrypt$...` value are skipped, so running
 * it twice is harmless and it is safe to re-run after a deploy.
 *
 * Nobody's password changes — the same password they use today keeps working.
 * This only changes how it is *stored*, so a leaked DB dump no longer hands over
 * everyone's actual password.
 *
 * The login route also upgrades rows lazily on successful login, so this script
 * is the bulk path, not the only path.
 */
import '../lib/env'
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { hashPassword, isHashed } from '../lib/password'

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

async function main() {
  const write = process.argv.includes('--write')
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL env var required')

  const adapter = new PrismaMariaDb(parseDatabaseUrl(url))
  const prisma = new PrismaClient({ adapter } as never)

  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } })
  let hashed = 0
  let already = 0

  for (const u of users) {
    if (isHashed(u.password)) {
      already++
      console.log(`skip (already hashed): ${u.email}`)
      continue
    }
    if (!u.password) {
      console.log(`WARN empty password, left alone: ${u.email}`)
      continue
    }
    if (write) {
      await prisma.user.update({ where: { id: u.id }, data: { password: await hashPassword(u.password) } })
      console.log(`hashed: ${u.email}`)
    } else {
      console.log(`would hash: ${u.email}`)
    }
    hashed++
  }

  console.log(
    write
      ? `\ndone — ${hashed} hashed, ${already} already hashed, ${users.length} total`
      : `\ndry run — ${hashed} would be hashed, ${already} already hashed, ${users.length} total.\nRe-run with --write to apply.`,
  )

  await (prisma as unknown as { $disconnect(): Promise<void> }).$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
