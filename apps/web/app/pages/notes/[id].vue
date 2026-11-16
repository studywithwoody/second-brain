<script setup lang="ts">
const route = useRoute()
const id = computed(() => String(route.params.id))
const detail = ref<any>(null)
const error = ref('')
const saving = ref(false)
const tab = ref<'edit' | 'preview'>('edit')
const suggestions = ref<Array<{ id: string, title: string }>>([])
const showHistory = ref(false)
const historyContent = ref('')
const reviewNote = ref('')

const api = useRequestFetch()
async function load() {
  error.value = ''
  try {
    detail.value = await api(`/api/notes/${id.value}`)
  } catch (err: any) {
    error.value = err?.data?.message || '找不到這篇筆記'
  }
}
await load()
useSeoMeta({ title: () => detail.value?.note?.title || '筆記' })

const allNotes = ref<Array<{ id: string, title: string }>>([])
onMounted(async () => {
  const result = await $fetch<{ notes: Array<{ id: string, title: string }> }>('/api/notes')
  allNotes.value = result.notes
})

async function save() {
  if (!detail.value) return
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/notes/${id.value}`, {
      method: 'PATCH',
      body: {
        title: detail.value.note.title,
        path: detail.value.note.path,
        content: detail.value.note.content,
        tags: detail.value.note.tags,
        webSearchOverride: detail.value.note.webSearchOverride
      }
    })
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '儲存失敗'
  } finally {
    saving.value = false
  }
}

async function factcheck() {
  saving.value = true
  try {
    await $fetch(`/api/notes/${id.value}/factcheck`, { method: 'POST' })
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '查核失敗'
  } finally {
    saving.value = false
  }
}

async function buildGraph() {
  const flagged = (detail.value?.claims || []).filter((claim: any) => !claim.review && (claim.verdict === 'contradicted' || claim.verdict === 'uncertain'))
  if (flagged.length && !confirm(`還有 ${flagged.length} 條主張沒覆核。仍要產生圖譜變更集嗎？`)) return
  saving.value = true
  try {
    await $fetch(`/api/notes/${id.value}/graph`, { method: 'POST' })
    const changes = await $fetch<{ changesets: Array<{ id: string, documentId: string, status: string }> }>('/api/graph/changesets')
    const pending = changes.changesets.find(item => item.documentId === id.value && item.status === 'pending')
    if (pending) await navigateTo(`/graph/changesets/${pending.id}`)
  } catch (err: any) {
    error.value = err?.data?.message || '無法建立圖譜變更'
  } finally {
    saving.value = false
  }
}

async function review(claimId: string, decision: string) {
  try {
    await $fetch(`/api/claims/${claimId}/review`, { method: 'POST', body: { decision, note: reviewNote.value } })
    reviewNote.value = ''
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '覆核失敗'
  }
}

async function onInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  const upto = el.value.slice(0, el.selectionStart)
  const match = upto.match(/\[\[([^\]\n]*)$/)
  if (!match) {
    suggestions.value = []
    return
  }
  const result = await $fetch<{ notes: Array<{ id: string, title: string }> }>('/api/notes/suggest', { query: { q: match[1] } })
  suggestions.value = result.notes
}

function insertLink(title: string) {
  const note = detail.value.note
  note.content = note.content.replace(/\[\[[^\]\n]*$/, `[[${title}]]`)
  suggestions.value = []
}

async function openVersion(versionId: string) {
  const version = await $fetch<{ contentMd: string }>(`/api/notes/${id.value}/versions/${versionId}`)
  historyContent.value = version.contentMd
}

async function restore(versionId: string) {
  const version = await $fetch<{ contentMd: string }>(`/api/notes/${id.value}/versions/${versionId}`)
  detail.value.note.content = version.contentMd
  showHistory.value = false
  await save()
}

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    save()
  }
}

const verdictLabel: Record<string, string> = {
  supported: '支持',
  contradicted: '矛盾',
  uncertain: '不確定',
  not_checkable: '無法查證'
}
</script>

<template>
  <div v-if="detail">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <UInput v-model="detail.note.title" class="serif text-2xl" />
        <UInput v-model="detail.note.path" class="mt-2 max-w-xl" placeholder="資料夾/標題" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="soft" @click="showHistory = !showHistory">版本</UButton>
        <UButton color="neutral" variant="outline" :loading="saving" @click="factcheck">重新查核</UButton>
        <UButton :loading="saving" @click="save">儲存</UButton>
      </div>
    </div>
    <UAlert class="mt-3" color="warning" variant="subtle" title="事實查核是輔助，不是權威" description="模型會誤判，網頁來源也可能錯。請看引用與信心分數，再決定要不要改。" />
    <p v-if="error" class="mt-2 text-sm text-red-700">{{ error }}</p>
    <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section class="rounded-2xl border border-stone-300 bg-white">
        <div class="flex gap-2 border-b border-stone-200 p-2">
          <UButton size="sm" :variant="tab === 'edit' ? 'solid' : 'ghost'" @click="tab = 'edit'">編輯</UButton>
          <UButton size="sm" :variant="tab === 'preview' ? 'solid' : 'ghost'" color="neutral" @click="tab = 'preview'">預覽</UButton>
          <span class="ml-auto self-center text-xs text-stone-500">Ctrl/⌘ + S 儲存</span>
        </div>
        <div class="grid lg:grid-cols-2">
          <textarea
            v-model="detail.note.content"
            class="min-h-[480px] w-full resize-y border-0 bg-transparent p-4 font-mono text-sm leading-7 outline-none lg:block lg:border-r lg:border-stone-200"
            :class="tab === 'preview' ? 'hidden' : ''"
            @input="onInput"
            @keydown="onKey"
          />
          <div class="hidden p-4 lg:block" :class="tab === 'edit' ? '' : ''">
            <MarkdownView :source="detail.note.content" :notes="allNotes" />
          </div>
        </div>
        <div v-if="tab === 'preview'" class="p-4 lg:hidden">
          <MarkdownView :source="detail.note.content" :notes="allNotes" />
        </div>
        <ul v-if="suggestions.length" class="border-t border-stone-200 p-2 text-sm">
          <li v-for="item in suggestions" :key="item.id">
            <button class="px-2 py-1" @click="insertLink(item.title)">[[{{ item.title }}]]</button>
          </li>
        </ul>
      </section>
      <aside class="space-y-4">
        <section class="rounded-2xl border border-stone-300 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="serif text-xl">查核</h2>
            <span class="text-xs text-stone-500">預估 ${{ detail.estimates.factcheckUsd.toFixed(4) }}</span>
          </div>
          <p v-if="!detail.claims.length" class="mt-3 text-sm text-stone-500">這篇還沒有查核結果。儲存後會自動跑一次。</p>
          <article v-for="claim in detail.claims" :key="claim.id" class="mt-3 border-t border-stone-100 pt-3">
            <div class="flex items-center justify-between gap-2">
              <UBadge :color="claim.verdict === 'contradicted' ? 'error' : claim.verdict === 'supported' ? 'success' : 'warning'" variant="subtle">
                {{ verdictLabel[claim.verdict] || claim.verdict }}
              </UBadge>
              <span class="text-xs text-stone-500">信心 {{ Math.round(claim.confidence * 100) }}%</span>
            </div>
            <p class="mt-2 text-sm">{{ claim.text }}</p>
            <p class="mt-1 text-sm text-stone-600">{{ claim.reasoning }}</p>
            <p v-if="claim.suggestedFix" class="mt-1 text-sm text-emerald-800">建議：{{ claim.suggestedFix }}</p>
            <ul class="mt-2 space-y-1 text-xs text-stone-500">
              <li v-for="(cite, index) in claim.citations" :key="index">
                {{ cite.title }}<span v-if="cite.provider === 'mock'">（示範來源）</span>：{{ cite.quote }}
              </li>
            </ul>
            <p v-if="claim.review" class="mt-2 text-xs text-stone-500">已覆核：{{ claim.review.decision }}</p>
            <div v-else-if="claim.verdict === 'contradicted' || claim.verdict === 'uncertain'" class="mt-2 flex flex-wrap gap-1">
              <UButton size="xs" @click="review(claim.id, 'accept_fix')">接受修正</UButton>
              <UButton size="xs" color="neutral" variant="soft" @click="review(claim.id, 'keep_noted')">保留並註記</UButton>
              <UButton size="xs" color="neutral" variant="ghost" @click="review(claim.id, 'mark_false_positive')">標為誤判</UButton>
            </div>
          </article>
          <UInput v-model="reviewNote" class="mt-3" placeholder="覆核註記（可空）" />
        </section>
        <section class="rounded-2xl border border-stone-300 bg-white p-4">
          <h2 class="serif text-xl">更新圖譜</h2>
          <p class="mt-1 text-sm text-stone-600">預估 ${{ detail.estimates.graphUsd.toFixed(4) }}。這只會產生變更集，不會直接改圖。</p>
          <UButton class="mt-3" block @click="buildGraph">產生圖譜變更</UButton>
          <div class="mt-3 flex items-center justify-between text-sm">
            <span>這篇使用網路搜尋</span>
            <USwitch
              :model-value="detail.note.webSearchOverride === true"
              @update:model-value="detail.note.webSearchOverride = $event ? true : false"
            />
          </div>
        </section>
        <section class="rounded-2xl border border-stone-300 bg-white p-4 text-sm">
          <h2 class="serif text-xl">連結</h2>
          <p class="mt-2 text-stone-500">反向連結</p>
          <NuxtLink v-for="link in detail.backlinks" :key="link.id" :to="`/notes/${link.id}`" class="block py-1 text-orange-800">
            {{ link.title }}
          </NuxtLink>
          <p v-if="!detail.backlinks.length" class="text-stone-400">還沒有其他筆記指向這裡</p>
          <p class="mt-3 text-stone-500">這篇指出</p>
          <p v-for="link in detail.outbound" :key="link.title" class="py-1">
            <NuxtLink v-if="link.documentId" :to="`/notes/${link.documentId}`">{{ link.title }}</NuxtLink>
            <NuxtLink v-else :to="`/notes?new=${encodeURIComponent(link.title)}`" class="unresolved">{{ link.title }}（尚未建立）</NuxtLink>
          </p>
        </section>
      </aside>
    </div>
    <section v-if="showHistory" class="mt-4 rounded-2xl border border-stone-300 bg-white p-4">
      <h2 class="serif text-xl">文件版本</h2>
      <ul class="mt-2 divide-y">
        <li v-for="version in detail.versions" :key="version.id" class="flex items-center justify-between py-2 text-sm">
          <button @click="openVersion(version.id)">{{ new Date(version.createdAt).toLocaleString() }} · {{ version.source }}</button>
          <UButton size="xs" color="neutral" variant="soft" @click="restore(version.id)">還原為新版本</UButton>
        </li>
      </ul>
      <pre v-if="historyContent" class="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-3 text-xs">{{ historyContent }}</pre>
    </section>
  </div>
  <p v-else class="text-stone-500">{{ error || '載入中…' }}</p>
</template>
