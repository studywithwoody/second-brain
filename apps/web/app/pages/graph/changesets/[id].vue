<script setup lang="ts">
import { buildPreview, cascadeAcceptance, displayLabel } from '@kb/graph'

const route = useRoute()
const id = computed(() => String(route.params.id))
const detail = ref<any>(null)
const error = ref('')
const busy = ref(false)
const note = ref('')
const lang = ref<'zh-TW' | 'en'>('zh-TW')
const mode = ref<'2d' | '3d'>('2d')

function labelOf(node: { labelZh: string, labelEn: string }) {
  return displayLabel(node, lang.value)
}

const api = useRequestFetch()
async function load() {
  detail.value = await api(`/api/graph/changesets/${id.value}`)
}
await load()
useSeoMeta({ title: '圖譜差異' })

const preview = computed(() => {
  if (!detail.value) return { nodes: [], edges: [] }
  return buildPreview(detail.value.current, cascadeAcceptance(detail.value.ops))
})

const nodes = computed(() => preview.value.nodes.map(node => ({
  ...node,
  label: labelOf(node)
})))
const links = computed(() => preview.value.edges.map(edge => ({
  id: edge.id,
  source: edge.sourceId,
  target: edge.targetId,
  label: lang.value === 'en' ? edge.relationEn : edge.relationZh,
  highlight: edge.highlight
})))

function toggle(op: any) {
  op.accepted = !op.accepted
  detail.value.ops = cascadeAcceptance(detail.value.ops)
}

function acceptAll() {
  for (const op of detail.value.ops) {
    if (!String(op.reason).includes('鎖定')) op.accepted = true
  }
  detail.value.ops = cascadeAcceptance(detail.value.ops)
}

async function applySelected() {
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch<any>(`/api/graph/changesets/${id.value}/apply`, {
      method: 'POST',
      body: { opIds: detail.value.ops.filter((op: any) => op.accepted).map((op: any) => op.id) }
    })
    if (result.finalized?.version) await navigateTo('/graph/history')
    else if (result.staged) await navigateTo('/settings')
    else await navigateTo('/graph')
  } catch (err: any) {
    error.value = err?.data?.message || '套用失敗'
  } finally {
    busy.value = false
  }
}

async function reject() {
  busy.value = true
  try {
    await $fetch(`/api/graph/changesets/${id.value}/reject`, { method: 'POST', body: { note: note.value } })
    await navigateTo('/graph')
  } catch (err: any) {
    error.value = err?.data?.message || '退回失敗'
  } finally {
    busy.value = false
  }
}

function opTitle(op: any) {
  const after = op.after || {}
  const before = op.before || {}
  return after.labelZh || before.labelZh || after.relationZh || before.relationZh || ''
}

const opLabel: Record<string, string> = {
  add_node: '新增節點',
  update_node: '修改節點',
  merge_nodes: '合併節點',
  remove_node: '刪除節點',
  add_edge: '新增關係',
  update_edge: '修改關係',
  remove_edge: '刪除關係'
}
</script>

<template>
  <div v-if="detail">
    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="serif text-4xl">差異預覽</h1>
        <p class="text-sm text-stone-600">
          {{ detail.changeset.kind === 'rebuild' ? `重建第 ${detail.changeset.batchNo} / ${detail.changeset.batchTotal} 批。這一批先暫存，全部核准後才產生一個新版本。` : '綠色是新增，橘色是修改，紅色是刪除。沒勾的不會寫進圖譜。' }}
        </p>
      </div>
      <div class="flex gap-2">
        <UButton size="sm" :variant="mode === '2d' ? 'solid' : 'outline'" @click="mode = '2d'">2D</UButton>
        <UButton size="sm" color="neutral" :variant="mode === '3d' ? 'solid' : 'outline'" @click="mode = '3d'">3D</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="lang = lang === 'en' ? 'zh-TW' : 'en'">{{ lang === 'en' ? 'English' : '中文' }}</UButton>
      </div>
    </div>
    <p v-if="error" class="mb-2 text-sm text-red-700">{{ error }}</p>
    <div class="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section class="rounded-2xl border border-stone-300 bg-white p-3">
        <article v-for="op in detail.ops" :key="op.id" class="border-b border-stone-100 py-3 text-sm">
          <label class="flex gap-2">
            <input :checked="op.accepted" type="checkbox" :disabled="String(op.reason).includes('鎖定') || detail.changeset.status !== 'pending'" @change="toggle(op)">
            <span>
              <span :class="op.opType.startsWith('add') ? 'hl-add' : op.opType.startsWith('remove') ? 'hl-remove' : 'hl-update'">
                {{ opLabel[op.opType] || op.opType }}
                <span v-if="opTitle(op)">· {{ opTitle(op) }}</span>
              </span>
              <span class="mt-1 block">{{ op.reason }}</span>
              <span class="text-xs text-stone-500">信心 {{ Math.round(op.confidence * 100) }}%</span>
            </span>
          </label>
        </article>
        <p v-if="!detail.ops.length" class="py-6 text-sm text-stone-500">這一批沒有新的節點或關係。</p>
        <div v-if="detail.changeset.status === 'pending'" class="mt-3 grid gap-2">
          <UButton :loading="busy" @click="acceptAll(); applySelected()">全部接受</UButton>
          <UButton color="neutral" variant="soft" :loading="busy" @click="applySelected()">套用勾選</UButton>
          <UInput v-model="note" placeholder="退回時給 AI 的意見" />
          <UButton color="error" variant="ghost" :loading="busy" @click="reject">退回</UButton>
        </div>
        <p v-else class="mt-3 text-sm text-stone-500">狀態：{{ detail.changeset.status }}</p>
      </section>
      <GraphCanvas :nodes="nodes" :links="links" :mode="mode" />
    </div>
  </div>
</template>
