<script setup lang="ts">
const open = ref(false)
const route = useRoute()
watch(() => route.path, () => { open.value = false })

const { data } = await useFetch('/api/settings', { server: false })
async function logout() {
  await useUserSession().clear()
  await navigateTo('/login')
}
const ratio = computed(() => Number(data.value?.ratio || 0))
const paused = computed(() => Boolean(data.value?.budget?.pausedAt) || ratio.value >= 1)
const warn = computed(() => ratio.value >= 0.8)
const mock = computed(() => data.value?.llm?.provider === 'mock')

const links = [
  { to: '/', label: '總覽' },
  { to: '/notes', label: '筆記' },
  { to: '/review', label: '查核' },
  { to: '/graph', label: '圖譜' },
  { to: '/graph/history', label: '版本' },
  { to: '/settings', label: '設定' }
]
</script>

<template>
  <div class="shell" :class="{ 'nav-open': open }">
    <aside class="side">
      <NuxtLink to="/" class="brand">
        <span class="mark">知</span>
        <span>
          <strong class="serif block text-lg leading-none">知庫</strong>
          <span class="text-xs text-stone-500">個人知識庫</span>
        </span>
      </NuxtLink>
      <nav class="grid gap-1">
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="nav-link">
          {{ link.label }}
        </NuxtLink>
      </nav>
      <div v-if="data?.budget" class="mt-6 rounded-xl bg-white/70 p-3 text-sm">
        <div class="flex justify-between text-stone-600">
          <span>本月 AI</span>
          <span>${{ Number(data.budget.spentUsd).toFixed(3) }} / ${{ Number(data.budget.capUsd).toFixed(0) }}</span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded bg-stone-200">
          <div class="h-full" :class="paused ? 'bg-red-700' : warn ? 'bg-amber-600' : 'bg-emerald-700'" :style="{ width: Math.min(100, ratio * 100) + '%' }" />
        </div>
      </div>
      <UButton class="mt-6" color="neutral" variant="ghost" size="sm" @click="logout">
        登出
      </UButton>
    </aside>
    <div class="main">
      <div class="mb-3 flex items-center gap-2 lg:hidden">
        <UButton class="menu-btn" color="neutral" variant="soft" @click="open = !open">選單</UButton>
      </div>
      <UAlert v-if="mock" class="mb-3" color="neutral" variant="subtle" title="目前使用示範模型" description="沒有 GEMINI_API_KEY，查核與圖譜抽取走固定規則，方便在本機把流程走完。設定金鑰後會改呼叫 Gemini。" />
      <UAlert v-if="paused" class="mb-3" color="error" variant="subtle" title="AI 任務已暫停" description="本月預算已用完。排隊中的任務會在下個月或你調高上限後繼續。" />
      <UAlert v-else-if="warn" class="mb-3" color="warning" variant="subtle" title="本月 AI 預算已超過 80%" description="還可以繼續，但送出全量重建前會先看預估費用。" />
      <slot />
    </div>
  </div>
</template>
