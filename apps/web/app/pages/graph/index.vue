<script setup lang="ts">
useSeoMeta({ title: '知識圖譜' })
const mode = ref<'2d' | '3d'>('3d')
const lang = ref<'zh-TW' | 'en'>('zh-TW')
onMounted(() => {
  const saved = localStorage.getItem('kb.graphMode')
  if (saved === '2d' || saved === '3d') mode.value = saved
})
watch(mode, value => localStorage.setItem('kb.graphMode', value))
const graph = ref<any>({ nodes: [], edges: [] })
const selected = ref<any>(null)
const error = ref('')
const saving = ref(false)

const api = useRequestFetch()
async function load(requested?: 'zh-TW' | 'en') {
  graph.value = await api('/api/graph', { query: requested ? { lang: requested } : {} })
  lang.value = graph.value.lang
  if (selected.value) selected.value = graph.value.nodes.find((node: any) => node.id === selected.value.id) || null
}
// First load uses the saved workspace language (default 中文).
await load()

async function toggleLang() {
  const next = lang.value === 'en' ? 'zh-TW' : 'en'
  await load(next)
  // Remember the choice for next time.
  $fetch('/api/settings', { method: 'PATCH', body: { graphDisplayLang: next } }).catch(() => {})
}

const links = computed(() => (graph.value.edges || []).map((edge: any) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  label: edge.label,
  highlight: 'idle'
})))

function choose(id: string) {
  selected.value = graph.value.nodes.find((node: any) => node.id === id) || null
}

async function saveNode() {
  if (!selected.value) return
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/graph/nodes/${selected.value.id}`, {
      method: 'PATCH',
      body: {
        labelZh: selected.value.labelZh,
        labelEn: selected.value.labelEn,
        aliases: selected.value.aliases,
        locked: true
      }
    })
    await load()
    choose(selected.value.id)
  } catch (err: any) {
    error.value = err?.data?.message || '無法儲存節點'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="serif text-4xl">知識圖譜</h1>
        <p class="text-sm text-stone-600">{{ graph.nodes.length }} 個節點、{{ (graph.edges || []).length }} 條關係。預設繁體中文；鎖頭代表你手改過，AI 不會覆蓋。</p>
      </div>
      <div class="flex gap-2">
        <UButton size="sm" :variant="mode === '2d' ? 'solid' : 'outline'" @click="mode = '2d'">2D</UButton>
        <UButton size="sm" :variant="mode === '3d' ? 'solid' : 'outline'" color="neutral" @click="mode = '3d'">3D</UButton>
        <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-languages" @click="toggleLang">
          {{ lang === 'en' ? '切換成中文' : 'Switch to English' }}
        </UButton>
      </div>
    </div>
    <p v-if="error" class="mb-2 text-sm text-red-700">{{ error }}</p>
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <GraphCanvas :nodes="graph.nodes" :links="links" :mode="mode" @select="choose" />
      <aside class="rounded-2xl border border-stone-300 bg-white p-4">
        <h2 class="serif text-xl">節點</h2>
        <p v-if="!graph.nodes.length" class="mt-3 text-sm text-stone-500">圖譜還是空的。從一篇筆記產生變更集並接受後，節點會出現在這裡。</p>
        <div v-else-if="selected" class="mt-3 space-y-2 text-sm">
          <p v-if="selected.locked">已鎖定</p>
          <label class="block">中文名稱 <UInput v-model="selected.labelZh" /></label>
          <label class="block">英文名稱 <UInput v-model="selected.labelEn" /></label>
          <p class="text-stone-500">別名：{{ (selected.aliases || []).join('、') || '無' }}</p>
          <UButton :loading="saving" block @click="saveNode">儲存並鎖定</UButton>
          <UButton color="neutral" variant="ghost" block @click="selected = null">回到節點列表</UButton>
        </div>
        <ul v-else class="mt-3 max-h-[480px] space-y-1 overflow-auto text-sm">
          <li v-for="node in graph.nodes" :key="node.id">
            <button class="text-left" @click="choose(node.id)">{{ node.label }} <span v-if="node.locked">🔒</span></button>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>
