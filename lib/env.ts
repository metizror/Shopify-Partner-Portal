// Load the env files before any other module reads process.env. Used only by
// CLI scripts in scripts/ — Next.js itself auto-loads env files for the app.
//
// Import this BEFORE any module that reads env at import time:
//   import '@/lib/env'
//   import { prisma } from '@/lib/db'  // safe, DATABASE_URL is already loaded
import dotenv from 'dotenv'
import path from 'path'

// .env.local first: dotenv never overwrites an already-set var, so whichever is
// loaded first wins — matching Next.js, where .env.local overrides .env. This
// project keeps its secrets in .env; .env.local is optional.
for (const f of ['.env.local', '.env']) {
  dotenv.config({ path: path.resolve(process.cwd(), f) })
}
