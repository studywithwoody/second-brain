<script setup lang="ts">
useSeoMeta({ title: '設定' })
const data = ref<any>(null)
const error = ref('')
const message = ref('')
const cap = ref(10)
const saving = ref(false)

const api = useRequestFetch()
async function load() {
  data.value = await api('/api/settings')
  cap.value = Number(data.value.workspace?.monthlyBudgetUsd || 10)
}
await load()

async function save() {
  saving.value = true
  error.value = ''
  try {
    await $fetch('/api/settings', {
      method: 'PATCH',
      body: {
        monthlyBudgetUsd: Number(cap.value),
        webSearchEnabled: data.value.workspace.webSearchEnabled,
        graphDisplayLang: data.value.workspace.graphDisplayLang
      }
    })
    message.value = '已儲存'
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '儲存失敗'
  } finally {
    saving.value = false
  }
}

async function rebuild(action?: string) {
  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<any>('/api/graph/rebuild', { method: 'POST', body: action ? { action } : {} })
    message.value = result.estimate ? `已開始重建，預估 $${Number(result.estimate).toFixed(2)}，共 ${result.batchTotal} 批。` : '已更新重建狀態'
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '重建沒有開始'
  } finally {
    saving.value = false
  }
}

async function markRead() {
  await $fetch('/api/notifications/read', { method: 'POST' })
  await load()
}
</script>

<template>
  <div v-if="data" class="max-w-3xl">
    <h1 class="serif text-4xl">設定</h1>
    <p v-if="message" class="mt-2 text-sm text-emerald-800">{{ message }}</p>
    <p v-if="error" class="mt-2 text-sm text-red-700">{{ error }}</p>
    <section class="mt-5 rounded-2xl border border-stone-300 bg-white p-4">
      <h2 class="serif text-2xl">預算</h2>
      <p class="mt-1 text-sm text-stone-600">本月已用 ${{ Number(data.budget.spentUsd).toFixed(4) }}，上限 ${{ Number(data.budget.capUsd).toFixed(2) }}。達 80% 警告，達 100% 暫停並在站內通知；有設定 Resend 時才寄信。</p>
      <label class="mt-3 block text-sm">每月上限（美元）
        <UInput v-model.number="cap" type="number" min="1" max="1000" class="mt-1 max-w-xs" />
      </label>
    </section>
    <section class="mt-4 rounded-2xl border border-stone-300 bg-white p-4">
      <h2 class="serif text-2xl">查核與語言</h2>
      <div class="mt-3 flex items-center justify-between">
        <span>查核使用網路搜尋</span>
        <USwitch v-model="data.workspace.webSearchEnabled" />
      </div>
      <p class="mt-1 text-xs text-stone-500">沒有 Exa / Tavily 金鑰時用示範摘錄，並在畫面上標成示範來源。單篇可以再覆寫。</p>
      <div class="mt-4 flex items-center justify-between">
        <span>圖譜顯示語言</span>
        <select v-model="data.workspace.graphDisplayLang" class="rounded border border-stone-300 bg-white px-2 py-1">
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <UButton class="mt-4" :loading="saving" @click="save">儲存設定</UButton>
    </section>
    <section class="mt-4 rounded-2xl border border-stone-300 bg-white p-4">
      <h2 class="serif text-2xl">從全部筆記重建</h2>
      <p class="mt-1 text-sm text-stone-600">共 {{ data.noteCount }} 篇。開始前會先把目前圖譜做成完整快照。重建以批次覆核，可暫停再繼續；你手動鎖住的節點不會被蓋掉。</p>
      <p v-if="data.rebuild.active" class="mt-2 text-sm">進行中：{{ data.rebuild.active.status }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <UButton :loading="saving" @click="rebuild()">估算並開始</UButton>
        <UButton color="neutral" variant="soft" @click="rebuild('pause')">暫停</UButton>
        <UButton color="neutral" variant="outline" @click="rebuild('resume')">繼續</UButton>
      </div>
    </section>
    <section class="mt-4 rounded-2xl border border-stone-300 bg-white p-4">
      <div class="flex items-center justify-between">
        <h2 class="serif text-2xl">通知</h2>
        <UButton size="xs" color="neutral" variant="ghost" @click="markRead">全部標為已讀</UButton>
      </div>
      <ul class="mt-2 space-y-2 text-sm">
        <li v-for="item in data.notifications" :key="item.id" class="rounded-lg bg-stone-50 p-2" :class="item.readAt ? 'opacity-60' : ''">
          <strong>{{ item.payload?.title }}</strong>
          <p>{{ item.payload?.body }}</p>
        </li>
        <li v-if="!data.notifications.length" class="text-stone-500">還沒有通知。</li>
      </ul>
    </section>
  </div>
</template>
