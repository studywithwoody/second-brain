<script setup lang="ts">
useSeoMeta({ title: '查核覆核' })
const data = ref<{ claims: any[] }>({ claims: [] })
const error = ref('')
const api = useRequestFetch()
async function load() {
  data.value = await api('/api/claims')
}
await load()
const openClaims = computed(() => data.value.claims.filter(claim => !claim.review))

async function review(id: string, decision: string) {
  error.value = ''
  try {
    await $fetch(`/api/claims/${id}/review`, { method: 'POST', body: { decision } })
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '覆核失敗'
  }
}
</script>

<template>
  <div>
    <h1 class="serif text-4xl">查核覆核</h1>
    <UAlert class="mt-3" color="warning" variant="subtle" title="這不是權威判定" description="每條都附信心與引用。你可以接受修正、保留原句，或標成誤判。" />
    <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>
    <div v-if="!openClaims.length" class="mt-6 rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-stone-500">
      目前沒有待覆核的矛盾或不確定主張。
    </div>
    <article v-for="claim in openClaims" :key="claim.id" class="mt-4 rounded-2xl border border-stone-300 bg-white p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <NuxtLink :to="`/notes/${claim.documentId}`" class="text-sm text-orange-800">{{ claim.title }}</NuxtLink>
        <UBadge :color="claim.verdict === 'contradicted' ? 'error' : 'warning'" variant="subtle">
          {{ claim.verdict === 'contradicted' ? '矛盾' : '不確定' }} · {{ Math.round(claim.confidence * 100) }}%
        </UBadge>
      </div>
      <p class="mt-2">{{ claim.text }}</p>
      <p class="mt-1 text-sm text-stone-600">{{ claim.reasoning }}</p>
      <p v-if="claim.suggestedFix" class="mt-1 text-sm text-emerald-800">建議：{{ claim.suggestedFix }}</p>
      <ul class="mt-2 text-xs text-stone-500">
        <li v-for="(cite, index) in claim.citations || []" :key="index">{{ cite.title }}：{{ cite.quote }}</li>
      </ul>
      <div class="mt-3 flex flex-wrap gap-2">
        <UButton size="sm" @click="review(claim.id, 'accept_fix')">接受修正</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="review(claim.id, 'keep_noted')">保留並註記</UButton>
        <UButton size="sm" color="neutral" variant="ghost" @click="review(claim.id, 'mark_false_positive')">標為誤判</UButton>
      </div>
    </article>
  </div>
</template>
