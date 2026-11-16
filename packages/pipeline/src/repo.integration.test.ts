import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq, sql } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { graphNodes, openDirectDb, type AppDb } from '@kb/db'
import { randomUUID } from 'node:crypto'
import { applyChangeset, createChangeset, listVersions, loadState, revertToVersion, updateNodeManual } from './graph-repo'
import { upsertOwner } from './account'

process.env.LLM_PROVIDER = 'mock'

const url = process.env.DATABASE_URL_TEST || 'postgresql://kb:kb@127.0.0.1:5432/kb_test'
const opened = openDirectDb(url)
const db: AppDb = opened.db

describe('changeset apply and revert in Postgres', () => {
  let workspaceId = ''
  let userId = ''

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url))
    })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users CASCADE`)
    const owner = await upsertOwner(db, 'owner@example.com', '擁有者')
    workspaceId = owner.workspace.id
    userId = owner.user.id
  })

  afterAll(async () => {
    await opened.close()
  })

  it('applies a changeset, reverts to the previous version, and can undo that revert', async () => {
    const lawId = randomUUID()
    const forceId = randomUUID()
    const edgeId = randomUUID()
    const first = await createChangeset(db, {
      workspaceId,
      kind: 'incremental',
      ops: [
        {
          opType: 'add_node',
          targetId: lawId,
          after: { id: lawId, labelZh: '牛頓第二定律', labelEn: "Newton's second law", aliases: ['F = ma'], type: 'law', locked: false },
          accepted: true,
          confidence: 0.93,
          reason: '抽取',
          source: 'ai'
        },
        {
          opType: 'add_node',
          targetId: forceId,
          after: { id: forceId, labelZh: '力', labelEn: 'force', aliases: [], type: 'quantity', locked: false },
          accepted: true,
          confidence: 0.9,
          reason: '抽取',
          source: 'ai'
        },
        {
          opType: 'add_edge',
          targetId: edgeId,
          after: { id: edgeId, sourceId: lawId, targetId: forceId, relation: 'describes', relationZh: '描述', relationEn: 'describes', confidence: 0.8, locked: false },
          accepted: true,
          confidence: 0.8,
          reason: '共現',
          source: 'ai'
        }
      ]
    })
    await applyChangeset(db, { workspaceId, changesetId: first.id, userId })
    const afterFirst = await loadState(db, workspaceId)
    expect(afterFirst.nodes).toHaveLength(2)
    expect(afterFirst.edges).toHaveLength(1)

    const energyId = randomUUID()
    const second = await createChangeset(db, {
      workspaceId,
      kind: 'incremental',
      ops: [{
        opType: 'add_node',
        targetId: energyId,
        after: { id: energyId, labelZh: '動能', labelEn: 'kinetic energy', aliases: [], type: 'quantity', locked: false },
        accepted: true,
        confidence: 0.88,
        reason: '抽取',
        source: 'ai'
      }]
    })
    await applyChangeset(db, { workspaceId, changesetId: second.id, userId })
    expect((await loadState(db, workspaceId)).nodes).toHaveLength(3)

    const versions = await listVersions(db, workspaceId)
    const version1 = versions.find(item => item.versionNo === 1)
    const version2 = versions.find(item => item.versionNo === 2)
    expect(version1 && version2).toBeTruthy()

    const revert = await revertToVersion(db, workspaceId, version1!.id)
    await applyChangeset(db, { workspaceId, changesetId: revert.changesetId, userId })
    const restored = await loadState(db, workspaceId)
    expect(restored.nodes.map(node => node.labelZh).sort()).toEqual(['力', '牛頓第二定律'])
    expect(restored.edges).toHaveLength(1)

    const undo = await revertToVersion(db, workspaceId, version2!.id)
    await applyChangeset(db, { workspaceId, changesetId: undo.changesetId, userId })
    const redone = await loadState(db, workspaceId)
    expect(redone.nodes.map(node => node.labelZh).sort()).toEqual(['力', '動能', '牛頓第二定律'])
    const history = await listVersions(db, workspaceId)
    expect(Math.max(...history.map(item => item.versionNo))).toBeGreaterThan(2)
  })

  it('does not let an AI update overwrite a manually locked node', async () => {
    const nodeId = randomUUID()
    const created = await createChangeset(db, {
      workspaceId,
      kind: 'incremental',
      ops: [{
        opType: 'add_node',
        targetId: nodeId,
        after: { id: nodeId, labelZh: '動量守恆', labelEn: 'Conservation of momentum', aliases: [], type: 'law', locked: false },
        accepted: true,
        confidence: 0.9,
        reason: '抽取',
        source: 'ai'
      }]
    })
    await applyChangeset(db, { workspaceId, changesetId: created.id, userId })
    await updateNodeManual(db, { workspaceId, userId, nodeId, locked: true, labelEn: 'Conservation of momentum' })
    const attack = await createChangeset(db, {
      workspaceId,
      kind: 'incremental',
      ops: [{
        opType: 'update_node',
        targetId: nodeId,
        before: { id: nodeId, labelZh: '動量守恆' },
        after: { labelZh: '被覆蓋的名稱', labelEn: 'overwritten' },
        accepted: true,
        confidence: 0.99,
        reason: 'AI 想改名',
        source: 'ai'
      }]
    })
    const result = await applyChangeset(db, { workspaceId, changesetId: attack.id, userId })
    expect(result.status).toBe('rejected')
    const [row] = await db.select().from(graphNodes).where(eq(graphNodes.id, nodeId))
    expect(row?.labelZh).toBe('動量守恆')
    expect(row?.locked).toBe(true)
  })
})
