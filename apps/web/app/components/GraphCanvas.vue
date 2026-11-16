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
      const [mod, spriteMod] = await Promise.all([import('3d-force-graph'), import('three-spritetext')])
      const SpriteText = ((spriteMod as { default?: unknown }).default ?? spriteMod) as new (text?: string, height?: number, color?: string) => {
        color: string, backgroundColor: string | false, padding: number, borderRadius: number, fontFace: string, fontWeight: string, position: { y: number }
      }
      const Factory = factoryOf(mod)
      graph = Factory()(element)
        .width(width)
        .height(height)
        .backgroundColor('#14181f')
        .graphData(data)
        .nodeLabel((node: { label?: string, locked?: boolean }) => `${node.label || ''}${node.locked ? ' 🔒' : ''}`)
        .nodeColor((node: { type?: string, highlight?: string }) => color(node))
        .nodeVal((node: { highlight?: string }) => node.highlight && node.highlight !== 'idle' ? 8 : 4)
        .nodeOpacity(0.92)
        // Always-visible text labels so the 3D view is readable without hovering.
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((node: { label?: string, locked?: boolean, highlight?: string }) => {
          const sprite = new SpriteText(`${node.label || ''}${node.locked ? ' 🔒' : ''}`, 6, node.highlight === 'remove' ? '#fecaca' : '#f5f5f4')
          sprite.fontFace = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
          sprite.backgroundColor = 'rgba(20,24,31,0.55)'
          sprite.padding = 1.2
          sprite.borderRadius = 2
          sprite.position.y = 9
          return sprite
        })
        .linkColor((link: { highlight?: string }) => link.highlight === 'remove' ? '#fca5a5' : link.highlight === 'add' ? '#86efac' : '#94a3b8')
        .linkOpacity(0.55)
        .linkWidth((link: { highlight?: string }) => link.highlight === 'add' || link.highlight === 'remove' ? 1.2 : 0.4)
        .linkDirectionalArrowLength(3)
        .linkDirectionalArrowRelPos(1)
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

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !host.value) return
  resizeObserver = new ResizeObserver(() => {
    if (!graph || !host.value) return
    graph.width(host.value.clientWidth || 640)
    graph.height(Math.max(host.value.clientHeight, 520))
  })
  resizeObserver.observe(host.value)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  graph?._destructor?.()
})
</script>

<template>
  <div class="relative sticky top-4 h-[640px] w-full overflow-hidden rounded-2xl bg-[#171b22]">
    <div :ref="setHost" class="h-full w-full" />
    <p v-if="status" class="absolute inset-0 grid place-items-center px-6 text-center text-sm text-stone-300">{{ status }}</p>
    <p v-else-if="!nodes.length" class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-stone-400">圖譜還是空的</p>
  </div>
</template>
