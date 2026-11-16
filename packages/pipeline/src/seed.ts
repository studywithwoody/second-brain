import { and, eq, isNull } from 'drizzle-orm'
import { documents, graphNodes, workspaces, type AppDb } from '@kb/db'
import { applyChangeset, listChangesets, updateNodeManual } from './graph-repo'
import { enqueueFactcheck, enqueueGraph, processPending } from './jobs'
import { saveNote } from './notes'

const NOTES = [
  {
    path: '物理/力學/牛頓運動定律',
    content: `---
title: 牛頓運動定律
tags: [物理, 力學]
---

# 牛頓運動定律

[[牛頓]] 在《自然哲學的數學原理》整理了三條運動定律，用來描述 [[力]] 如何改變運動。

牛頓第一定律：若物體不受外力，或所受淨力為零，將保持靜止或等速直線運動。

牛頓第二定律是 F = mv。這是常見的記錯寫法，正確關係應寫成力等於質量乘加速度。

加速度與淨力成正比、與 [[質量]] 成反比。動量的變化見 [[動量守恆]]。還沒寫的主題是 [[角動量]]。

$$F = ma$$
`
  },
  {
    path: '物理/力學/動量守恆',
    content: `---
title: 動量守恆
tags: [物理, 力學]
---

# 動量守恆

在沒有外力的系統中，總 [[動量]] 保持不變。這條定律與 [[牛頓運動定律]] 的第三定律密切相關：兩物體互相作用的力大小相等、方向相反。

碰撞前後，若外力可忽略，動量的向量和守恆。
`
  },
  {
    path: '物理/能量/力學能守恆',
    content: `---
title: 力學能守恆
tags: [物理, 能量]
---

# 力學能守恆

若只有保守力作功，[[動能]] 與 [[位能]] 的總和守恆。重力位能可寫成 $mgh$，動能是 $\\tfrac{1}{2}mv^2$。

摩擦這類非保守力會把力學能轉成熱，此時力學能不守恆。
`
  },
  {
    path: '物理/電磁/庫侖定律',
    content: `---
title: 庫侖定律
tags: [物理, 電磁]
---

# 庫侖定律

兩個點 [[電荷]] 之間的靜電力，大小與電荷量乘積成正比，與距離平方成反比。

$$F = k \\frac{q_1 q_2}{r^2}$$

這裡的力與 [[牛頓運動定律]] 裡的 [[力]] 是同一個物理量。
`
  }
]

export async function seedIfEmpty(db: AppDb, workspaceId: string, userId: string) {
  const existing = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.workspaceId, workspaceId),
    isNull(documents.deletedAt)
  )).limit(1)
  if (existing.length) return { seeded: false }
  await db.update(workspaces).set({ webSearchEnabled: true }).where(eq(workspaces.id, workspaceId))
  const saved = []
  for (const note of NOTES) {
    saved.push(await saveNote(db, {
      workspaceId,
      userId,
      path: note.path,
      content: note.content
    }))
    const queued = await enqueueFactcheck(db, workspaceId, saved.at(-1)!.documentId)
    if (!queued.blocked) await processPending(db, workspaceId, 2)
  }
  const momentum = saved.find(item => item.title === '動量守恆')
  const newton = saved.find(item => item.title === '牛頓運動定律')
  if (momentum) {
    await enqueueGraph(db, workspaceId, momentum.documentId)
    await processPending(db, workspaceId, 2)
    const changes = await listChangesets(db, workspaceId)
    const pending = changes.find(item => item.documentId === momentum.documentId && item.status === 'pending')
    if (pending) await applyChangeset(db, { workspaceId, changesetId: pending.id, userId })
    const [node] = await db.select().from(graphNodes).where(and(
      eq(graphNodes.workspaceId, workspaceId),
      eq(graphNodes.labelZh, '動量守恆')
    )).limit(1)
    if (node) {
      await updateNodeManual(db, {
        workspaceId,
        userId,
        nodeId: node.id,
        locked: true
      })
    }
  }
  if (newton) {
    await enqueueGraph(db, workspaceId, newton.documentId)
    await processPending(db, workspaceId, 2)
  }
  return { seeded: true }
}
