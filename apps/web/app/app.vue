<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'zh-Hant' },
  titleTemplate: (title) => title ? `${title} · 知庫` : '知庫',
  link: [
    { rel: 'icon', href: '/favicon.svg' },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap' }
  ]
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
