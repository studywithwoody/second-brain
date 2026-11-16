<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import katex from 'katex'

const props = defineProps<{
  source: string
  notes?: Array<{ id: string, title: string }>
}>()

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

function renderMath(html: string) {
  return html
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => katex.renderToString(String(expr), { displayMode: true, throwOnError: false }))
    .replace(/\$([^$\n]+?)\$/g, (_, expr) => katex.renderToString(String(expr), { throwOnError: false }))
}

const html = computed(() => {
  const linked = (props.source || '').replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_all, rawTitle: string, rawLabel?: string) => {
    const title = rawTitle.trim()
    const label = (rawLabel || title).trim()
    const note = props.notes?.find(item => item.title.toLowerCase() === title.toLowerCase())
    if (note) return `[${label}](/notes/${note.id})`
    return `[${label}](/notes?new=${encodeURIComponent(title)})`
  })
  return renderMath(md.render(linked))
})
</script>

<template>
  <div class="prose-note" v-html="html" />
</template>
