<script setup lang="ts">
useSeoMeta({ title: '圖譜版本' })
const versions = ref<any[]>([])
const error = ref('')
const busy = ref('')
const api = useRequestFetch()
async function load() {
  const result = await api<{ versions: any[] }>('/api/graph/versions')
  versions.value = result.versions
}
await load()

async function revert(id: string) {
  busy.value = id
  error.value = ''
  try {
    const result = await $fetch<{ changesetId: string }>(`/api/graph/versions/${id}/revert`, { method: 'POST' })
    await navigateTo(`/graph/changesets/${result.changesetId}`)
  } catch (err: any) {
    error.value = err?.data?.message || '無法建立還原變更'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <h1 class="serif text-4xl">圖譜版本</h1>
    <p class="mt-2 max-w-2xl text-stone-600">還原不會改寫歷史。它會做出一個新的變更集，你確認後成為下一個版本，所以還原本身也能再還原。</p>
    <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
    <ol class="mt-5 space-y-3">
      <li v-for="version in versions" :key="version.id" class="rounded-2xl border border-stone-300 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="serif text-xl">版本 {{ version.versionNo }}</p>
            <p class="text-sm text-stone-600">{{ version.summary || '空白圖譜' }}</p>
            <p class="text-xs text-stone-400">{{ new Date(version.createdAt).toLocaleString() }} <span v-if="version.snapshot">· 含快照</span></p>
          </div>
          <UButton v-if="version.versionNo !== versions[0]?.versionNo" size="sm" color="neutral" :loading="busy === version.id" @click="revert(version.id)">
            還原到此版本
          </UButton>
          <UBadge v-else color="neutral" variant="subtle">目前</UBadge>
        </div>
      </li>
      <li v-if="!versions.length" class="text-stone-500">還沒有版本。</li>
    </ol>
  </div>
</template>
