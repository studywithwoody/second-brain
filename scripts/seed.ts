import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { closeDirectDb, getDirectDb } from '@kb/db'
import { seedIfEmpty, upsertOwner } from '../packages/pipeline/src/index.ts'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })
process.env.LLM_PROVIDER ||= 'mock'

const db = getDirectDb()
const email = process.env.OWNER_EMAIL || 'owner@example.com'
const { user, workspace } = await upsertOwner(db, email, '擁有者')
const result = await seedIfEmpty(db, workspace.id, user.id)
console.log(result.seeded ? '已寫入力學示範筆記、查核與一筆待確認的圖譜變更' : '知識庫已有筆記，略過示範資料')
await closeDirectDb()
