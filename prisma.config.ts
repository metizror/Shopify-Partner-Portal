import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env so DATABASE_URL is available to prisma generate / migrate
config({ path: resolve(__dirname, '.env') })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})
