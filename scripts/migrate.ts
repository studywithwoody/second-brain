import { config } from 'dotenv'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { openDirectDb } from '@kb/db'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('請設定 DATABASE_URL_UNPOOLED（直接連線）或 DATABASE_URL')
  process.exit(1)
}
const opened = openDirectDb(url)
await migrate(opened.db, {
  migrationsFolder: fileURLToPath(new URL('../packages/db/migrations', import.meta.url))
})
await opened.close()
console.log('migration 已套用')
