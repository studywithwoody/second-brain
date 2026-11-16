<script setup lang="ts">
useSeoMeta({ title: '總覽' })
const api = useRequestFetch()
const [notes, claims, changes] = await Promise.all([
  api<{ notes: Array<{ id: string, title: string, path: string, updatedAt: string }> }>('/api/notes'),
  api<{ claims: Array<{ id: string, title: string, verdict: string, review: unknown, documentId: string }> }>('/api/claims'),
  api<{ changesets: Array<{ id: string, status: string, kind: string, createdAt: string, decisionNote: string }> }>('/api/graph/changesets')
])
const pendingClaims = computed(() => claims.claims.filter(item => !item.review))
const pendingChanges = computed(() => changes.changesets.filter(item => item.status === 'pending' || item.status === 'staged'))
</script>

<template>
  <div>
    <h1 class="serif text-4xl">今天先看這三件事</h1>
    <p class="mt-2 max-w-2xl text-stone-600">查核是輔助，不是定論。圖譜只在你接受變更集之後才會改，而且每次接受都會留下可還原的版本。</p>
    <div class="mt-6 grid gap-4 md:grid-cols-3">
      <NuxtLink to="/notes" class="rounded-2xl border border-stone-300 bg-white p-4">
        <p class="text-sm text-stone-500">筆記</p>
        <p class="serif mt-2 text-3xl">{{ notes.notes.length }}</p>
        <p class="mt-2 text-sm text-stone-600">最近：{{ notes.notes[0]?.title || '還沒有' }}</p>
      </NuxtLink>
      <NuxtLink to="/review" class="rounded-2xl border border-stone-300 bg-white p-4">
        <p class="text-sm text-stone-500">待覆核主張</p>
        <p class="serif mt-2 text-3xl">{{ pendingClaims.length }}</p>
        <p class="mt-2 text-sm text-stone-600">矛盾或不確定的句子會停在這裡。</p>
      </NuxtLink>
      <NuxtLink :to="pendingChanges[0] ? `/graph/changesets/${pendingChanges[0].id}` : '/graph'" class="rounded-2xl border border-stone-300 bg-white p-4">
        <p class="text-sm text-stone-500">待確認圖譜</p>
        <p class="serif mt-2 text-3xl">{{ pendingChanges.length }}</p>
        <p class="mt-2 text-sm text-stone-600">先看差異，再決定全部或部分接受。</p>
      </NuxtLink>
    </div>
    <section class="mt-8">
      <h2 class="serif text-2xl">最近的筆記</h2>
      <ul class="mt-3 divide-y divide-stone-200 rounded-2xl border border-stone-300 bg-white">
        <li v-for="note in notes.notes.slice(0, 6)" :key="note.id">
          <NuxtLink :to="`/notes/${note.id}`" class="flex items-center justify-between px-4 py-3">
            <span>
              <span class="block font-medium">{{ note.title }}</span>
              <span class="text-sm text-stone-500">{{ note.path }}</span>
            </span>
            <span class="text-sm text-stone-400">打開</span>
          </NuxtLink>
        </li>
        <li v-if="!notes.notes.length" class="px-4 py-8 text-stone-500">知識庫還是空的。到筆記頁建立第一篇。</li>
      </ul>
    </section>
  </div>
</template>
