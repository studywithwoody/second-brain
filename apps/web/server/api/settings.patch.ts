import { setBudgetCap, workspaceLang, workspaceWebSearch } from '@kb/pipeline'
import { requireOwner, useDb, withApi } from '../utils/context'

export default defineEventHandler((event) => withApi(async () => {
  const user = await requireOwner(event)
  const body = await readBody(event)
  const db = await useDb()
  if (typeof body.monthlyBudgetUsd === 'number') await setBudgetCap(db, user.workspaceId, body.monthlyBudgetUsd)
  if (typeof body.webSearchEnabled === 'boolean') await workspaceWebSearch(db, user.workspaceId, body.webSearchEnabled)
  if (body.graphDisplayLang === 'zh-TW' || body.graphDisplayLang === 'en') {
    await workspaceLang(db, user.workspaceId, body.graphDisplayLang)
  }
  return { ok: true }
}))
