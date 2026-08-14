// Prisma client singleton + driver adapter for Prisma v7.
//
// Prisma v7 requires a driver adapter. We use @prisma/adapter-mariadb
// which is compatible with both MySQL and MariaDB.
//
// Dev mode hot-reload (tsx watch) re-imports modules, which would otherwise
// instantiate a new PrismaClient on every change and exhaust DB connections.
// We park the instance on globalThis to survive reloads.

import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const g = globalThis as unknown as { prisma?: PrismaClient }

function parseDatabaseUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    allowPublicKeyRetrieval: true,
  }
}

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const config = parseDatabaseUrl(url)
  const adapter = new PrismaMariaDb(config)
  return new PrismaClient({ adapter, log: ['warn', 'error'] })
}

export const prisma = g.prisma ?? createPrisma()

if (process.env.NODE_ENV !== 'production') g.prisma = prisma

/**
 * No-op kept for backwards compatibility with code that still imports
 * `ensureIndexes`. Prisma migrations now own the schema/indexes.
 */
export async function ensureIndexes(): Promise<void> {
  /* indexes are managed by prisma migrate */
}
