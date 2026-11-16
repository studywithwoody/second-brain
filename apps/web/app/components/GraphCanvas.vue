<script setup lang="ts">
const props = defineProps<{
  nodes: Array<{ id: string, label: string, type?: string, highlight?: string, locked?: boolean }>
  links: Array<{ id?: string, source: string, target: string, label?: string, highlight?: string }>
  mode: '2d' | '3d'
}>()
const emit = defineEmits<{ select: [id: string] }>()
const host = ref<HTMLDivElement | null>(null)
const status = ref('')
let graph: { graphData: (data: unknown) => unknown, width: (n: number) => unknown, height: (n: number) => unknown, _destructor?: () => void } | null = null

function factoryOf(mod: unknown) {
  const record = mod as { default?: unknown }
  const candidate = record.default ?? mod
  if (typeof candidate === 'function') return candidate as () => (element: HTMLElement) => typeof graph
  const nested = (candidate as { default?: unknown } | null)?.default
  if (typeof nested === 'function') return nested as () => (element: HTMLElement) => typeof graph
  throw new Error('圖譜元件沒有載入')
}

const palette: Record<string, string> = {
  law: '#1f6f5b',
  quantity: '#c2882b',
  person: '#9a3412',
  concept: '#3f5f8a',
  other: '#57534e'
}

function color(node: { type?: string, highlight?: string }) {
  if (node.highlight === 'add') return '#15803d'
  if (node.highlight === 'update') return '#c2410c'
  if (node.highlight === 'remove') return '#b91c1c'
  return palette[node.type || 'concept'] || palette.other!
}

function setHost(node: Element | null) {
  host.value = node instanceof HTMLElement ? node as HTMLDivElement : null
  if (host.value && import.meta.client) mountGraph()
}

async function mountGraph() {
  if (!host.value || !import.meta.client) return
  status.value = ''
  try {
    if (graph?._destructor) graph._destructor()
    graph = null
    host.value.innerHTML = ''
    const data = {
      nodes: props.nodes.map(node => ({ ...node })),
      links: props.links.map(link => ({ ...link }))
    }
    const width = host.value.clientWidth || 640
    const height = Math.max(host.value.clientHeight, 520)
    const element = host.value
    if (props.mode === '3d') {
      const Factory = factoryOf(await import('3d-force-graph'))
      graph = Factory()(element)
        .width(width)
        .height(height)
        .backgroundColor('#14181f')
        .graphData(data)
        .nodeLabel((node: { label?: string, locked?: boolean }) => `${node.label || ''}${node.locked ? ' 🔒' : ''}`)
        .nodeColor((node: { type?: string, highlight?: string }) => color(node))
        .nodeVal((node: { highlight?: string }) => node.highlight && node.highlight !== 'idle' ? 8 : 4)
        .linkColor((link: { highlight?: string }) => link.highlight === 'remove' ? '#fca5a5' : link.highlight === 'add' ? '#86efac' : '#94a3b8')
        .linkLabel((link: { label?: string }) => link.label || '')
        .onNodeClick((node: { id?: string }) => node.id && emit('select', node.id))
    } else {
      const Factory = factoryOf(await import('force-graph'))
      graph = Factory()(element)
        .width(width)
        .height(height)
        .backgroundColor('#171b22')
        .graphData(data)
        .nodeLabel((node: { label?: string, locked?: boolean }) => `${node.label || ''}${node.locked ? ' 🔒' : ''}`)
        .nodeColor((node: { type?: string, highlight?: string }) => color(node))
        .nodeRelSize(5)
        .nodeCanvasObjectMode(() => 'after')
        .nodeCanvasObject((node: { label?: string, x?: number, y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const label = node.label || ''
          if (!label || node.x == null || node.y == null) return
          const fontSize = Math.max(11 / globalScale, 3)
          ctx.font = `${fontSize}px "Noto Sans TC", sans-serif`
          ctx.fillStyle = '#e7e5e4'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(label, node.x, node.y + 6)
        })
        .linkColor((link: { highlight?: string }) => link.highlight === 'remove' ? '#fca5a5' : link.highlight === 'add' ? '#86efac' : 'rgba(226,232,240,0.45)')
        .linkLineDash((link: { highlight?: string }) => link.highlight === 'remove' ? [4, 3] : null)
        .linkLabel((link: { label?: string }) => link.label || '')
        .onNodeClick((node: { id?: string }) => node.id && emit('select', node.id))
    }
  } catch (error) {
    status.value = error instanceof Error ? error.message : '圖譜無法顯示'
  }
}

watch(() => [props.mode, props.nodes, props.links], () => { if (host.value) mountGraph() }, { deep: true })
onBeforeUnmount(() => { graph?._destructor?.() })
</script>

<template>
  <div class="sticky top-4 h-[640px] w-full overflow-hidden rounded-2xl bg-[#171b22]">
    <div :ref="setHost" class="h-full w-full" />
    <p v-if="status" class="absolute inset-0 grid place-items-center px-6 text-center text-sm text-stone-300">{{ status }}</p>
  </div>
</template>
