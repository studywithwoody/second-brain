<script setup lang="ts">
useSeoMeta({ title: '筆記' })
const q = ref('')
const creating = ref(false)
const route = useRoute()
const notes = ref<Array<{ id: string, title: string, path: string, tags: string[], updatedAt: string }>>([])
const error = ref('')

const api = useRequestFetch()
async function load() {
  error.value = ''
  try {
    const result = q.value.trim()
      ? await api<{ notes: typeof notes.value }>('/api/search', { query: { q: q.value } })
      : await api<{ notes: typeof notes.value }>('/api/notes')
    notes.value = result.notes
  } catch (err) {
    error.value = '讀取筆記失敗'
  }
}
await load()

const folders = computed(() => {
  const set = new Set<string>()
  for (const note of notes.value) {
    const parts = note.path.split('/')
    parts.pop()
    if (parts.length) set.add(parts.join('/'))
  }
  return [...set]
})

async function createNote(title?: string) {
  creating.value = true
  try {
    const name = title || '未命名筆記'
    const saved = await $fetch<{ documentId: string }>('/api/notes', {
      method: 'POST',
      body: { title: name, path: name, content: `# ${name}\n\n` }
    })
    await navigateTo(`/notes/${saved.documentId}`)
  } catch (err) {
    error.value = '建立筆記失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  const title = typeof route.query.new === 'string' ? route.query.new : ''
  if (title) createNote(title)
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="serif text-4xl">筆記</h1>
        <p class="mt-1 text-stone-600">資料夾來自路徑，`[[wikilink]]` 會串起反向連結。</p>
      </div>
      <UButton :loading="creating" @click="createNote()">新筆記</UButton>
    </div>
    <div class="mt-4 flex gap-2">
      <UInput v-model="q" class="max-w-md flex-1" placeholder="搜尋標題、內文或標籤" @keydown.enter="load" />
      <UButton color="neutral" variant="soft" @click="load">搜尋</UButton>
    </div>
    <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
    <div class="mt-5 grid gap-4 lg:grid-cols-[200px_1fr]">
      <aside class="rounded-2xl border border-stone-300 bg-white p-3 text-sm">
        <p class="mb-2 text-stone-500">資料夾</p>
        <button class="block py-1" @click="q = ''; load()">全部</button>
        <p v-for="folder in folders" :key="folder" class="py-1 text-stone-700">{{ folder }}</p>
        <p v-if="!folders.length" class="text-stone-400">還沒有資料夾</p>
      </aside>
      <ul class="divide-y divide-stone-200 rounded-2xl border border-stone-300 bg-white">
        <li v-for="note in notes" :key="note.id">
          <NuxtLink :to="`/notes/${note.id}`" class="block px-4 py-3">
            <span class="font-medium">{{ note.title }}</span>
            <span class="mt-1 block text-sm text-stone-500">{{ note.path }}</span>
            <span v-if="note.tags?.length" class="mt-2 flex flex-wrap gap-1">
              <UBadge v-for="tag in note.tags" :key="tag" color="neutral" variant="subtle">#{{ tag }}</UBadge>
            </span>
          </NuxtLink>
        </li>
        <li v-if="!notes.length" class="px-4 py-10 text-stone-500">沒有符合的筆記。清空搜尋，或建立一篇新的。</li>
      </ul>
    </div>
  </div>
</template>
