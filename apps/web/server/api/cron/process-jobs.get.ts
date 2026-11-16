import { processPending } from '@kb/pipeline'
import { JOB_BUDGET_MS, useDb } from '../../utils/context'

export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  const authorization = getHeader(event, 'authorization')
  if (!secret || authorization !== `Bearer ${secret}`) {
    throw createError({ statusCode: 401, message: '未授權' })
  }
  const db = await useDb()
  const done = await processPending(db, undefined, 50, { budgetMs: JOB_BUDGET_MS })
  return { ok: true, processed: done.length }
})
