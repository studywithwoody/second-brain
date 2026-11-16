import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type AppDb = PostgresJsDatabase<typeof schema>

type GlobalDb = {
  __kbDb?: AppDb
  __kbSql?: ReturnType<typeof postgres>
  __kbUrl?: string
}

const globalDb = globalThis as unknown as GlobalDb

export function openDirectDb(url: string) {
  const sql = postgres(url, { prepare: false, max: 8, idle_timeout: 20 })
  const db = drizzlePg(sql, { schema })
  return {
    db,
    close: () => sql.end({ timeout: 5 })
  }
}

export function getDirectDb(url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '') {
  if (!url) throw new Error('缺少 DATABASE_URL 或 DATABASE_URL_UNPOOLED')
  if (!globalDb.__kbDb || globalDb.__kbUrl !== url) {
    const sql = postgres(url, { prepare: false, max: 8, idle_timeout: 20 })
    globalDb.__kbSql = sql
    globalDb.__kbDb = drizzlePg(sql, { schema })
    globalDb.__kbUrl = url
  }
  return globalDb.__kbDb
}

export async function closeDirectDb() {
  await globalDb.__kbSql?.end({ timeout: 5 })
  globalDb.__kbDb = undefined
  globalDb.__kbSql = undefined
  globalDb.__kbUrl = undefined
}

function isNeonUrl(url: string) {
  if (process.env.DATABASE_DRIVER === 'postgres') return false
  if (process.env.DATABASE_DRIVER === 'neon') return true
  return url.includes('neon.tech')
}

export async function getAppDb(): Promise<AppDb> {
  const pooled = process.env.DATABASE_URL || ''
  const direct = process.env.DATABASE_URL_UNPOOLED || pooled
  if (!pooled && !direct) throw new Error('缺少 DATABASE_URL')
  if (pooled && isNeonUrl(pooled)) {
    if (globalDb.__kbDb && globalDb.__kbUrl === `neon:${pooled}`) return globalDb.__kbDb
    const { Pool, neonConfig } = await import('@neondatabase/serverless')
    const ws = (await import('ws')).default
    neonConfig.webSocketConstructor = ws
    const pool = new Pool({ connectionString: pooled })
    const { drizzle } = await import('drizzle-orm/neon-serverless')
    globalDb.__kbDb = drizzle(pool, { schema }) as unknown as AppDb
    globalDb.__kbUrl = `neon:${pooled}`
    return globalDb.__kbDb
  }
  return getDirectDb(direct)
}

export function databaseTarget() {
  const pooled = process.env.DATABASE_URL || ''
  return {
    driver: pooled && isNeonUrl(pooled) ? 'neon-serverless' : 'postgres.js',
    pooled: Boolean(pooled),
    direct: Boolean(process.env.DATABASE_URL_UNPOOLED || pooled)
  }
}
