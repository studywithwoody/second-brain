import { getDirectDb } from '@kb/db'
import { processPending } from '@kb/pipeline'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('AI worker 需要 DATABASE_URL_UNPOOLED（Neon 直接連線，不要用 pooler）')
  process.exit(1)
}

const db = getDirectDb(url)
console.log('知庫 AI worker 已啟動')

for (;;) {
  try {
    const done = await processPending(db, undefined, 1)
    if (!done.length) await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (error) {
    console.error(error)
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
}
