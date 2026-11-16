<script setup lang="ts">
definePageMeta({ layout: 'blank' })
const route = useRoute()
const config = await $fetch<{ devBypass: boolean, google: boolean }>('/api/auth/config')
const error = computed(() => {
  if (route.query.error === 'owner') return '這個 Google 帳號不是擁有者。請改用擁有者的 Google 帳號（OWNER_EMAIL）登入。'
  if (route.query.error === 'denied') return 'Google 拒絕了這個應用的存取。若 OAuth 同意畫面仍是 Testing，請把擁有者的 Gmail 加為測試使用者，或把應用發布為正式版。'
  if (route.query.error === 'oauth') return 'Google 登入沒有完成。請再試一次。'
  return ''
})
const pending = ref(false)
async function devLogin() {
  pending.value = true
  try {
    await $fetch('/api/auth/dev-login', { method: 'POST' })
    await useUserSession().fetch()
    await navigateTo('/')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-6 py-16 md:grid-cols-2">
    <section>
      <p class="text-sm tracking-widest text-stone-500">SECOND BRAIN</p>
      <h1 class="serif mt-3 text-5xl leading-tight">知庫</h1>
      <p class="mt-4 text-lg leading-8 text-stone-700">
        把 Markdown 筆記留在自己的庫裡。AI 先查主張、再提議知識圖譜的變更；沒有你點確認，圖不會改，改過的版本也能再還原。
      </p>
    </section>
    <section class="rounded-3xl border border-stone-300 bg-white p-6 shadow-sm">
      <h2 class="serif text-2xl">登入</h2>
      <p class="mt-2 text-sm text-stone-600">v1 只開放擁有者。學生帳號的資料表已預留，介面還沒做。</p>
      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
      <div class="mt-6 grid gap-3">
        <UButton v-if="config.google" to="/auth/google" size="lg" block>用 Google 帳號登入</UButton>
        <UButton v-else color="neutral" variant="soft" size="lg" block disabled>尚未設定 Google OAuth</UButton>
        <UButton v-if="config.devBypass" :loading="pending" color="neutral" variant="outline" size="lg" block @click="devLogin">
          開發模式登入
        </UButton>
      </div>
      <p class="mt-4 text-xs leading-5 text-stone-500">開發模式登入在正式環境會關閉，就算設了 DEV_AUTH_BYPASS 也不會開。</p>
    </section>
  </main>
</template>
