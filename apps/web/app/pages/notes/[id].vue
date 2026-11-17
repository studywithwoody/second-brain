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
const savedSnapshot = ref('')
function snapshotOf(note: any) {
  return note ? JSON.stringify([note.title, note.path, note.content]) : ''
}
const dirty = computed(() => Boolean(detail.value) && snapshotOf(detail.value.note) !== savedSnapshot.value)
const jobState = ref<any>(null)
const waitingForGraph = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let lastKick = 0
let pollStarted = 0

const jobKindLabel: Record<string, string> = {
  factcheck: 'AI 查核',
  graph_incremental: '圖譜抽取'
}
const activeLabel = computed(() => {
  const active = jobState.value?.active || []
  if (!active.length) return ''
  return active.map((job: any) => `${jobKindLabel[job.kind] || job.kind}${job.status === 'running' ? '進行中' : '排隊中'}`).join('、')
})

async function poll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  try {
    const before = jobState.value
    jobState.value = await $fetch(`/api/jobs`, { query: { documentId: id.value } })
    const active = jobState.value.active || []
    const finishedFactcheck = before?.active?.some((job: any) => job.kind === 'factcheck') && !active.some((job: any) => job.kind === 'factcheck')
    if (finishedFactcheck) await load()
    if (waitingForGraph.value) {
      const graphJob = jobState.value.latest?.graph
      if (jobState.value.pendingChangesetId && !active.some((job: any) => job.kind === 'graph_incremental')) {
        waitingForGraph.value = false
        await navigateTo(`/graph/changesets/${jobState.value.pendingChangesetId}`)
        return
      }
      if (graphJob && (graphJob.status === 'failed' || graphJob.status === 'succeeded') && !active.length && !jobState.value.pendingChangesetId) {
        waitingForGraph.value = false
        error.value = graphJob.status === 'failed' ? `圖譜抽取失敗：${graphJob.lastError || '未知錯誤'}` : '這篇沒有新的圖譜變更。'
      }
      if (jobState.value.pausedBudget) {
        waitingForGraph.value = false
        error.value = '本月 AI 預算已用完，圖譜任務已暫停。'
      }
    }
    if (active.length || waitingForGraph.value) {
      // A Vercel function can be cut off mid-job; nudge the queue every 20s so stale work restarts.
      if (Date.now() - lastKick > 20_000) {
        lastKick = Date.now()
        $fetch('/api/jobs/process', { method: 'POST' }).catch(() => {})
      }
      if (Date.now() - pollStarted < 10 * 60_000) pollTimer = setTimeout(poll, 3000)
    }
  } catch {
    pollTimer = setTimeout(poll, 6000)
  }
}
function startPolling() {
  pollStarted = Date.now()
  lastKick = Date.now()
  poll()
}
onMounted(startPolling)
onBeforeUnmount(() => { if (pollTimer) clearTimeout(pollTimer) })

async function load() {
  error.value = ''
  try {
    detail.value = await api(`/api/notes/${id.value}`)
    savedSnapshot.value = snapshotOf(detail.value?.note)
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
    await $fetch<unknown>(`/api/notes/${id.value}`, {
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

const checking = ref(false)
async function factcheck() {
  // Check what the user sees: save pending edits first.
  if (dirty.value) {
    await save()
    if (error.value) return
  }
  checking.value = true
  error.value = ''
  try {
    const queued = await $fetch<{ blocked?: boolean, estimate?: number }>(`/api/notes/${id.value}/factcheck`, { method: 'POST' })
    if (queued?.blocked) error.value = `本月 AI 預算不足（預估 $${Number(queued.estimate || 0).toFixed(4)}），查核已排隊暫停，調高上限或下個月會自動繼續。`
    await load()
    startPolling()
  } catch (err: any) {
    error.value = err?.data?.message || '查核失敗'
  } finally {
    checking.value = false
  }
}

const factcheckStatus = computed(() => {
  const active = (jobState.value?.active || []).find((job: any) => job.kind === 'factcheck')
  if (active) return active.status === 'running' ? 'running' : 'queued'
  if (dirty.value && detail.value?.factcheck?.status === 'done') return 'outdated'
  return jobState.value?.factcheck?.status || detail.value?.factcheck?.status || 'never'
})
const factcheckInfo: Record<string, { label: string, color: 'neutral' | 'warning' | 'info' | 'success' | 'error', hint: string }> = {
  never: { label: '尚未查核', color: 'neutral', hint: '儲存不會自動查核。需要時按「事實查核」。' },
  outdated: { label: '內容已變更', color: 'warning', hint: '上次查核之後改過內容，下面是舊版本的結果。' },
  queued: { label: '排隊中', color: 'info', hint: 'AI 查核已排隊，通常一分鐘內完成。' },
  running: { label: '查核中', color: 'info', hint: 'AI 正在查核，完成後會自動更新。' },
  paused_budget: { label: '預算暫停', color: 'error', hint: '本月 AI 預算已用完，調高上限或下個月會自動繼續。' },
  failed: { label: '查核失敗', color: 'error', hint: '可以再按一次「事實查核」重試。' },
  done: { label: '已查核', color: 'success', hint: '' }
}

async function buildGraph() {
  // A fact-check is optional: warn, but let the user build the graph anyway.
  if (dirty.value) {
    await save()
    if (error.value) return
  }
  const status = factcheckStatus.value
  if ((status === 'never' || status === 'outdated' || status === 'failed') && !confirm(status === 'never' ? '這篇還沒做事實查核。仍要產生圖譜變更集嗎？' : '目前內容還沒有查核過。仍要產生圖譜變更集嗎？')) return
  const flagged = (detail.value?.claims || []).filter((claim: any) => !claim.review && (claim.verdict === 'contradicted' || claim.verdict === 'uncertain'))
  if (flagged.length && !confirm(`還有 ${flagged.length} 條主張沒覆核。仍要產生圖譜變更集嗎？`)) return
  saving.value = true
  try {
    const queued = await $fetch<{ blocked?: boolean }>(`/api/notes/${id.value}/graph`, { method: 'POST' })
    if (queued?.blocked) {
      error.value = '本月 AI 預算不足，圖譜任務已排隊暫停。'
      return
    }
    waitingForGraph.value = true
    jobState.value = { ...(jobState.value || {}), pendingChangesetId: null }
    startPolling()
  } catch (err: any) {
    error.value = err?.data?.message || '無法建立圖譜變更'
  } finally {
    saving.value = false
  }
}

async function review(claimId: string, decision: string) {
  try {
    const result = await $fetch<{ versionId?: string | null }>(`/api/claims/${claimId}/review`, { method: 'POST', body: { decision, note: reviewNote.value } })
    reviewNote.value = ''
    await load()
    if (result?.versionId) jobState.value = await $fetch(`/api/jobs`, { query: { documentId: id.value } }).catch(() => jobState.value)
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

const reviewLabel: Record<string, string> = {
  accept_fix: '✓ 已接受修正，這條已解決',
  keep_noted: '已保留並註記',
  mark_false_positive: '已標為誤判'
}
const verdictLabel: Record<string, string> = {
  supported: '支持',
  contradicted: '矛盾',
  uncertain: '不確定',
  not_checkable: '無法查證'
}

const folderSegments = computed(() => {
  const path = detail.value?.note?.path || ''
  const parts = path.split('/')
  parts.pop()
  return parts.map((name: string, i: number) => ({
    name,
    fullPath: parts.slice(0, i + 1).join('/')
  }))
})

const fileName = computed({
  get() {
    const path = detail.value?.note?.path || ''
    const parts = path.split('/')
    return parts[parts.length - 1] || ''
  },
  set(val: string) {
    if (!detail.value?.note) return
    const clean = val.replace(/[\/\\]/g, '').trim()
    const parts = (detail.value.note.path || '').split('/')
    parts.pop()
    const folder = parts.join('/')
    detail.value.note.path = folder ? `${folder}/${clean}` : clean
  }
})
</script>

<template>
  <div v-if="detail">
    <!-- 檔案結構 Breadcrumb 與檔名編輯 -->
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <nav class="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
        <NuxtLink to="/notes" class="flex items-center gap-1 font-medium hover:text-stone-900 transition-colors">
          <UIcon name="i-lucide-folder" class="size-3.5 text-stone-500" />
          <span>筆記</span>
        </NuxtLink>
        <template v-for="seg in folderSegments" :key="seg.fullPath">
          <span class="text-stone-300">/</span>
          <NuxtLink
            :to="`/notes?folder=${encodeURIComponent(seg.fullPath)}`"
            class="hover:text-stone-900 hover:underline transition-colors"
          >
            {{ seg.name }}
          </NuxtLink>
        </template>
        <span class="text-stone-300">/</span>
      </nav>

      <div class="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs text-stone-700 transition focus-within:border-stone-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-stone-500">
        <UIcon name="i-lucide-file-text" class="size-3.5 text-stone-400" />
        <span class="text-stone-400 select-none">檔名:</span>
        <input
          v-model="fileName"
          type="text"
          class="min-w-[100px] max-w-[220px] bg-transparent font-mono text-xs text-stone-800 outline-none placeholder:text-stone-400"
          placeholder="檔名"
          title="變更檔名"
        />
        <span class="font-mono text-stone-400 select-none">.md</span>
      </div>
    </div>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <UInput v-model="detail.note.title" class="serif text-2xl" placeholder="筆記標題" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="soft" @click="showHistory = !showHistory">版本</UButton>
        <UButton color="neutral" variant="outline" icon="i-lucide-search-check" :loading="checking || factcheckStatus === 'running' || factcheckStatus === 'queued'" @click="factcheck">事實查核</UButton>
        <UButton :loading="saving" @click="save">儲存</UButton>
      </div>
    </div>
    <UAlert class="mt-3" color="warning" variant="subtle" title="事實查核是輔助，不是權威" description="模型會誤判，網頁來源也可能錯。請看引用與信心分數，再決定要不要改。" />
    <p v-if="error" class="mt-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="activeLabel || waitingForGraph" class="mt-2 flex items-center gap-2 text-sm text-stone-600">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" />
      {{ activeLabel || '等待圖譜抽取' }}…完成後會自動更新{{ waitingForGraph ? '並打開變更預覽' : '' }}
    </p>
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
            <UBadge :color="factcheckInfo[factcheckStatus]?.color || 'neutral'" variant="subtle">{{ factcheckInfo[factcheckStatus]?.label || factcheckStatus }}</UBadge>
          </div>
          <p class="mt-1 text-xs text-stone-500">
            <span v-if="detail.factcheck?.checkedAt">上次查核 {{ new Date(detail.factcheck.checkedAt).toLocaleString() }}。</span>
            {{ factcheckInfo[factcheckStatus]?.hint }}
          </p>
          <UButton
            class="mt-3"
            block
            icon="i-lucide-search-check"
            :loading="checking || factcheckStatus === 'running' || factcheckStatus === 'queued'"
            @click="factcheck"
          >
            事實查核（預估 ${{ detail.estimates.factcheckUsd.toFixed(4) }}）
          </UButton>
          <p v-if="detail.factcheck?.lastError && factcheckStatus === 'failed'" class="mt-2 text-xs text-red-700">{{ detail.factcheck.lastError }}</p>
          <p v-if="!detail.claims.length && factcheckStatus === 'never'" class="mt-3 text-sm text-stone-500">這篇還沒有查核結果。</p>
          <article v-for="claim in detail.claims" :key="claim.id" class="mt-3 border-t border-stone-100 pt-3">
            <div class="flex items-center justify-between gap-2">
              <UBadge :color="claim.verdict === 'contradicted' ? 'error' : claim.verdict === 'supported' ? 'success' : 'warning'" variant="subtle">
                {{ verdictLabel[claim.verdict] || claim.verdict }}
              </UBadge>
              <span class="text-xs text-stone-500">信心 {{ Math.round(claim.confidence * 100) }}%</span>
            </div>
            <p class="mt-2 text-sm">{{ claim.text }}</p>
            <div class="mt-1 text-sm text-stone-600"><MarkdownView :source="claim.reasoning || ''" /></div>
            <div v-if="claim.suggestedFix" class="mt-1 text-sm text-emerald-800"><span class="font-medium">建議修正</span><MarkdownView :source="claim.suggestedFix" /></div>
            <ul class="mt-2 space-y-1 text-xs text-stone-500">
              <li v-for="(cite, index) in claim.citations" :key="index">
                {{ cite.title }}<span v-if="cite.provider === 'mock'">（示範來源）</span>：{{ cite.quote }}
              </li>
            </ul>
            <p v-if="claim.review" class="mt-2 text-xs text-stone-500">{{ reviewLabel[claim.review.decision] || `已覆核：${claim.review.decision}` }}</p>
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
          <UButton class="mt-3" block :loading="waitingForGraph" @click="buildGraph">產生圖譜變更</UButton>
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
