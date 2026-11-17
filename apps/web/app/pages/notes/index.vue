<script setup lang="ts">
useSeoMeta({ title: '筆記' })

interface NoteItem {
  id: string
  title: string
  path: string
  tags: string[]
  updatedAt: string
}

const q = ref('')
const creating = ref(false)
const route = useRoute()
const router = useRouter()
const notes = ref<NoteItem[]>([])
const error = ref('')
const customFolders = ref<string[]>([])

// 當前選擇的資料夾: null = 全部筆記, '' = 根目錄（未分類）, string = 指定路徑
const selectedFolder = ref<string | null>(null)

// 載入筆記
const api = useRequestFetch()
async function load() {
  error.value = ''
  try {
    const result = q.value.trim()
      ? await api<{ notes: NoteItem[] }>('/api/search', { query: { q: q.value } })
      : await api<{ notes: NoteItem[] }>('/api/notes')
    notes.value = result.notes
  } catch {
    error.value = '讀取筆記失敗'
  }
}
await load()

// 依照 URL query 初始化選中資料夾
if (typeof route.query.folder === 'string') {
  selectedFolder.value = route.query.folder
}

// 監聽路由變化
watch(() => route.query.folder, (newFolder) => {
  if (typeof newFolder === 'string') {
    selectedFolder.value = newFolder
  } else if (newFolder === undefined && selectedFolder.value !== null) {
    selectedFolder.value = null
  }
})

function selectFolder(folder: string | null) {
  selectedFolder.value = folder
  const query = { ...route.query }
  if (folder === null) {
    delete query.folder
  } else {
    query.folder = folder
  }
  router.replace({ query })
}

// 解析所有資料夾層級
const allFolders = computed(() => {
  const set = new Set<string>()
  for (const f of customFolders.value) {
    const clean = f.trim().replace(/^\/+|\/+$/g, '')
    if (!clean) continue
    const parts = clean.split('/')
    for (let i = 1; i <= parts.length; i++) {
      set.add(parts.slice(0, i).join('/'))
    }
  }
  for (const note of notes.value) {
    const parts = note.path.split('/')
    parts.pop() // 排除檔案名
    for (let i = 1; i <= parts.length; i++) {
      set.add(parts.slice(0, i).join('/'))
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})

// 資料夾資訊項目
interface FolderItem {
  path: string
  name: string
  depth: number
  count: number
}

const folderItems = computed<FolderItem[]>(() => {
  return allFolders.value.map(folderPath => {
    const parts = folderPath.split('/')
    const count = notes.value.filter(n => n.path === folderPath || n.path.startsWith(`${folderPath}/`)).length
    return {
      path: folderPath,
      name: parts[parts.length - 1] || folderPath,
      depth: parts.length - 1,
      count
    }
  })
})

// 根目錄（未分類）筆記數量
const rootNotesCount = computed(() => {
  return notes.value.filter(n => !n.path.includes('/')).length
})

// 篩選後筆記
const filteredNotes = computed(() => {
  if (selectedFolder.value === null) {
    return notes.value
  }
  if (selectedFolder.value === '') {
    return notes.value.filter(n => !n.path.includes('/'))
  }
  const prefix = `${selectedFolder.value}/`
  return notes.value.filter(n => n.path === selectedFolder.value || n.path.startsWith(prefix))
})

// 建立新筆記
async function createNote(title?: string) {
  creating.value = true
  try {
    const baseName = title || '未命名筆記'
    const folder = selectedFolder.value && selectedFolder.value !== '' ? selectedFolder.value : ''
    
    // 計算唯一路徑
    let candidateName = baseName
    let count = 1
    while (true) {
      const candidatePath = folder ? `${folder}/${candidateName}` : candidateName
      const exists = notes.value.some(n => n.path === candidatePath)
      if (!exists) break
      count++
      candidateName = `${baseName} ${count}`
    }

    const fullPath = folder ? `${folder}/${candidateName}` : candidateName
    const saved = await $fetch<{ documentId: string }>('/api/notes', {
      method: 'POST',
      body: { title: candidateName, path: fullPath, content: `# ${candidateName}\n\n` }
    })
    await navigateTo(`/notes/${saved.documentId}`)
  } catch {
    error.value = '建立筆記失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  const title = typeof route.query.new === 'string' ? route.query.new : ''
  if (title) createNote(title)
})

// --- 檔案結構互動控制 ---
// 1. 新增資料夾 Modal
const showNewFolderModal = ref(false)
const newFolderInput = ref('')
const newFolderParent = ref('')

function openNewFolderModal(parent = '') {
  newFolderParent.value = parent
  newFolderInput.value = ''
  showNewFolderModal.value = true
}

function submitNewFolder() {
  const cleanInput = newFolderInput.value.trim().replace(/^\/+|\/+$/g, '')
  if (!cleanInput) return
  const full = newFolderParent.value ? `${newFolderParent.value}/${cleanInput}` : cleanInput
  if (!customFolders.value.includes(full)) {
    customFolders.value.push(full)
  }
  selectFolder(full)
  showNewFolderModal.value = false
}

// 2. 重新命名資料夾 Modal
const showRenameFolderModal = ref(false)
const renameFolderTarget = ref('')
const renameFolderInput = ref('')

function openRenameFolderModal(folder: string) {
  renameFolderTarget.value = folder
  const parts = folder.split('/')
  renameFolderInput.value = parts[parts.length - 1] || ''
  showRenameFolderModal.value = true
}

async function submitRenameFolder() {
  const newName = renameFolderInput.value.trim().replace(/[\/\\]/g, '')
  if (!newName) return
  const oldPath = renameFolderTarget.value
  const parts = oldPath.split('/')
  parts[parts.length - 1] = newName
  const newPath = parts.join('/')

  if (oldPath === newPath) {
    showRenameFolderModal.value = false
    return
  }

  try {
    await $fetch('/api/folders/rename', {
      method: 'POST',
      body: { from: oldPath, to: newPath }
    })
    // 更新本地 customFolders
    customFolders.value = customFolders.value.map(f => {
      if (f === oldPath) return newPath
      if (f.startsWith(`${oldPath}/`)) return `${newPath}/${f.slice(oldPath.length + 1)}`
      return f
    })
    if (selectedFolder.value === oldPath) {
      selectFolder(newPath)
    } else if (selectedFolder.value?.startsWith(`${oldPath}/`)) {
      selectFolder(`${newPath}/${selectedFolder.value.slice(oldPath.length + 1)}`)
    }
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '重新命名資料夾失敗'
  } finally {
    showRenameFolderModal.value = false
  }
}

// 3. 刪除資料夾 Modal
const showDeleteFolderModal = ref(false)
const deleteFolderTarget = ref('')
const deleteFolderAction = ref<'root' | 'trash'>('root')

function openDeleteFolderModal(folder: string) {
  deleteFolderTarget.value = folder
  deleteFolderAction.value = 'root'
  showDeleteFolderModal.value = true
}

async function submitDeleteFolder() {
  const folder = deleteFolderTarget.value
  try {
    await $fetch('/api/folders/delete', {
      method: 'POST',
      body: { folder, action: deleteFolderAction.value }
    })
    customFolders.value = customFolders.value.filter(f => f !== folder && !f.startsWith(`${folder}/`))
    if (selectedFolder.value === folder || selectedFolder.value?.startsWith(`${folder}/`)) {
      selectFolder(null)
    }
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '刪除資料夾失敗'
  } finally {
    showDeleteFolderModal.value = false
  }
}

// 4. 移動筆記 Modal
const showMoveNoteModal = ref(false)
const noteToMove = ref<NoteItem | null>(null)
const moveTargetType = ref<'existing' | 'new'>('existing')
const selectedTargetFolder = ref<string>('')
const customMoveTargetFolder = ref('')

function openMoveNoteModal(note: NoteItem) {
  noteToMove.value = note
  moveTargetType.value = 'existing'
  // 取得目前所在資料夾
  const parts = note.path.split('/')
  parts.pop()
  selectedTargetFolder.value = parts.join('/')
  customMoveTargetFolder.value = ''
  showMoveNoteModal.value = true
}

async function submitMoveNote() {
  if (!noteToMove.value) return
  const targetFolder = (moveTargetType.value === 'new'
    ? customMoveTargetFolder.value
    : selectedTargetFolder.value).trim().replace(/^\/+|\/+$/g, '')
  
  const parts = noteToMove.value.path.split('/')
  const fileName = parts.pop() || noteToMove.value.title
  const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName

  if (newPath === noteToMove.value.path) {
    showMoveNoteModal.value = false
    return
  }

  try {
    await $fetch<any>(`/api/notes/${noteToMove.value.id}`, {
      method: 'PATCH',
      body: { path: newPath }
    })
    if (targetFolder && !customFolders.value.includes(targetFolder)) {
      customFolders.value.push(targetFolder)
    }
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '移動筆記失敗'
  } finally {
    showMoveNoteModal.value = false
  }
}

// 5. 重新命名筆記檔名 Modal
const showRenameNoteModal = ref(false)
const noteToRename = ref<NoteItem | null>(null)
const renameNoteLeafInput = ref('')

function openRenameNoteModal(note: NoteItem) {
  noteToRename.value = note
  const parts = note.path.split('/')
  renameNoteLeafInput.value = parts[parts.length - 1] || ''
  showRenameNoteModal.value = true
}

async function submitRenameNote() {
  if (!noteToRename.value) return
  const cleanName = renameNoteLeafInput.value.trim().replace(/[\/\\]/g, '')
  if (!cleanName) return

  const parts = noteToRename.value.path.split('/')
  parts.pop()
  const folder = parts.join('/')
  const newPath = folder ? `${folder}/${cleanName}` : cleanName

  try {
    await $fetch<any>(`/api/notes/${noteToRename.value.id}`, {
      method: 'PATCH',
      body: { path: newPath }
    })
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '重新命名失敗'
  } finally {
    showRenameNoteModal.value = false
  }
}

// 刪除筆記
async function deleteNote(note: NoteItem) {
  if (!confirm(`確定要刪除筆記「${note.title}」嗎？`)) return
  try {
    await $fetch<any>(`/api/notes/${note.id}`, { method: 'DELETE' })
    await load()
  } catch (err: any) {
    error.value = err?.data?.message || '刪除筆記失敗'
  }
}
</script>

<template>
  <div>
    <!-- 頁面標題與動作列 -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="serif text-4xl">筆記</h1>
        <p class="mt-1 text-stone-600">集中控管資料夾結構與筆記路徑，`[[wikilink]]` 會串起反向連結。</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton :loading="creating" icon="i-lucide-file-plus" @click="createNote()">
          {{ selectedFolder ? '在此資料夾新筆記' : '新筆記' }}
        </UButton>
      </div>
    </div>

    <!-- 搜尋欄 -->
    <div class="mt-4 flex gap-2">
      <UInput v-model="q" class="max-w-md flex-1" placeholder="搜尋標題、內文或標籤" @keydown.enter="load" />
      <UButton color="neutral" variant="soft" @click="load">搜尋</UButton>
    </div>
    <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>

    <!-- 主要排版：左側檔案結構面板、右側筆記清單 -->
    <div class="mt-5 grid gap-4 lg:grid-cols-[250px_1fr]">
      <!-- 左側：檔案結構控管 -->
      <aside class="flex flex-col rounded-2xl border border-stone-300 bg-white p-3 text-sm shadow-xs">
        <div class="mb-3 flex items-center justify-between border-b border-stone-200 pb-2">
          <div class="flex items-center gap-1.5 font-medium text-stone-700">
            <UIcon name="i-lucide-folder-tree" class="size-4 text-stone-500" />
            <span>檔案結構</span>
          </div>
          <button
            class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
            title="新增資料夾"
            @click="openNewFolderModal()"
          >
            <UIcon name="i-lucide-folder-plus" class="size-3.5" />
            <span>新增</span>
          </button>
        </div>

        <!-- 導覽清單 -->
        <nav class="flex-1 space-y-0.5 overflow-y-auto">
          <!-- 全部筆記 -->
          <button
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition"
            :class="selectedFolder === null ? 'bg-stone-200/70 font-semibold text-stone-900' : 'text-stone-700 hover:bg-stone-100'"
            @click="selectFolder(null)"
          >
            <span class="flex items-center gap-2 truncate">
              <UIcon name="i-lucide-files" class="size-4 text-stone-500" />
              <span>全部筆記</span>
            </span>
            <span class="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{{ notes.length }}</span>
          </button>

          <!-- 根目錄（未分類） -->
          <button
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition"
            :class="selectedFolder === '' ? 'bg-stone-200/70 font-semibold text-stone-900' : 'text-stone-700 hover:bg-stone-100'"
            @click="selectFolder('')"
          >
            <span class="flex items-center gap-2 truncate">
              <UIcon name="i-lucide-file" class="size-4 text-stone-400" />
              <span>根目錄（未分類）</span>
            </span>
            <span class="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{{ rootNotesCount }}</span>
          </button>

          <div class="my-2 border-t border-stone-200" />

          <!-- 資料夾階層清單 -->
          <div v-if="folderItems.length" class="space-y-0.5">
            <div
              v-for="folder in folderItems"
              :key="folder.path"
              class="group flex items-center justify-between rounded-lg px-2 py-1 text-sm transition"
              :class="selectedFolder === folder.path ? 'bg-stone-200/70 font-medium text-stone-900' : 'text-stone-700 hover:bg-stone-100'"
              :style="{ paddingLeft: `${folder.depth * 14 + 8}px` }"
            >
              <button
                class="flex flex-1 items-center gap-1.5 truncate text-left"
                @click="selectFolder(folder.path)"
              >
                <UIcon
                  :name="selectedFolder === folder.path ? 'i-lucide-folder-open' : 'i-lucide-folder'"
                  class="size-4 shrink-0"
                  :class="selectedFolder === folder.path ? 'text-amber-600' : 'text-stone-400'"
                />
                <span class="truncate">{{ folder.name }}</span>
              </button>

              <div class="flex items-center gap-1">
                <span class="text-xs text-stone-400 group-hover:hidden">{{ folder.count }}</span>
                <!-- 快捷功能按鈕（Hover 顯示） -->
                <div class="hidden items-center gap-0.5 group-hover:flex">
                  <button
                    class="rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-800"
                    title="新增子資料夾"
                    @click.stop="openNewFolderModal(folder.path)"
                  >
                    <UIcon name="i-lucide-plus" class="size-3.5" />
                  </button>
                  <button
                    class="rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-800"
                    title="重新命名"
                    @click.stop="openRenameFolderModal(folder.path)"
                  >
                    <UIcon name="i-lucide-pencil" class="size-3.5" />
                  </button>
                  <button
                    class="rounded p-0.5 text-stone-500 hover:bg-red-100 hover:text-red-700"
                    title="刪除資料夾"
                    @click.stop="openDeleteFolderModal(folder.path)"
                  >
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="py-3 text-center text-xs text-stone-400">尚無資料夾，點擊上方「新增」建立</p>
        </nav>
      </aside>

      <!-- 右側：筆記清單區 -->
      <section class="flex flex-col gap-3">
        <!-- 頂部路徑狀態列 -->
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-2 text-sm text-stone-600">
          <div class="flex items-center gap-2">
            <span class="text-stone-400">目前檢視：</span>
            <div class="flex items-center gap-1 font-medium text-stone-800">
              <template v-if="selectedFolder === null">
                <span>全部筆記</span>
              </template>
              <template v-else-if="selectedFolder === ''">
                <span>根目錄（未分類）</span>
              </template>
              <template v-else>
                <span>筆記</span>
                <span class="text-stone-400">/</span>
                <span>{{ selectedFolder }}</span>
              </template>
            </div>
            <span class="text-xs text-stone-400">({{ filteredNotes.length }} 篇)</span>
          </div>

          <div v-if="selectedFolder !== null" class="flex items-center gap-2">
            <button
              class="text-xs text-stone-500 hover:text-stone-800 hover:underline"
              @click="selectFolder(null)"
            >
              清除篩選
            </button>
          </div>
        </div>

        <!-- 筆記列表 -->
        <ul class="divide-y divide-stone-200 rounded-2xl border border-stone-300 bg-white shadow-xs">
          <li
            v-for="note in filteredNotes"
            :key="note.id"
            class="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50/80 transition"
          >
            <NuxtLink :to="`/notes/${note.id}`" class="min-w-0 flex-1">
              <span class="font-medium text-stone-900 group-hover:text-stone-700">{{ note.title }}</span>
              <div class="mt-1 flex items-center gap-1.5 text-xs text-stone-500 font-mono">
                <UIcon name="i-lucide-folder" class="size-3 text-stone-400" />
                <span>{{ note.path }}</span>
              </div>
              <span v-if="note.tags?.length" class="mt-2 flex flex-wrap gap-1">
                <UBadge v-for="tag in note.tags" :key="tag" color="neutral" variant="subtle">#{{ tag }}</UBadge>
              </span>
            </NuxtLink>

            <!-- 動作按鈕 -->
            <div class="flex items-center gap-1 shrink-0">
              <button
                class="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition shadow-2xs"
                title="移動到其他資料夾"
                @click="openMoveNoteModal(note)"
              >
                <UIcon name="i-lucide-folder-input" class="size-3.5 text-stone-500" />
                <span class="hidden sm:inline">移動</span>
              </button>
              <button
                class="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition shadow-2xs"
                title="重新命名檔名"
                @click="openRenameNoteModal(note)"
              >
                <UIcon name="i-lucide-pencil" class="size-3.5 text-stone-500" />
                <span class="hidden sm:inline">改名</span>
              </button>
              <button
                class="rounded-md border border-stone-200 bg-white p-1 text-xs text-stone-400 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition shadow-2xs"
                title="刪除筆記"
                @click="deleteNote(note)"
              >
                <UIcon name="i-lucide-trash-2" class="size-3.5" />
              </button>
            </div>
          </li>

          <!-- 空狀態 -->
          <li v-if="!filteredNotes.length" class="px-4 py-12 text-center text-stone-500">
            <UIcon name="i-lucide-folder-open" class="mx-auto size-8 text-stone-400 mb-2" />
            <p v-if="selectedFolder">在「{{ selectedFolder }}」中沒有符合的筆記。</p>
            <p v-else>沒有符合的筆記。請清空搜尋，或建立一篇新筆記。</p>
            <UButton class="mt-4" size="sm" @click="createNote()">在此建立新筆記</UButton>
          </li>
        </ul>
      </section>
    </div>

    <!-- ===== 互動彈窗 (Modals) ===== -->

    <!-- 1. 新增資料夾 Modal -->
    <div
      v-if="showNewFolderModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
        <h3 class="text-lg font-semibold text-stone-900">
          {{ newFolderParent ? `在「${newFolderParent}」下新增子資料夾` : '新增資料夾' }}
        </h3>
        <p class="mt-1 text-xs text-stone-500">
          輸入資料夾名稱。可使用斜線「/」建立多層層級（例如：力學/牛頓定律）。
        </p>
        <div class="mt-4">
          <input
            v-model="newFolderInput"
            type="text"
            class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            placeholder="資料夾名稱"
            autofocus
            @keydown.enter="submitNewFolder"
          />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showNewFolderModal = false">取消</UButton>
          <UButton @click="submitNewFolder">建立</UButton>
        </div>
      </div>
    </div>

    <!-- 2. 重新命名資料夾 Modal -->
    <div
      v-if="showRenameFolderModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
        <h3 class="text-lg font-semibold text-stone-900">重新命名資料夾</h3>
        <p class="mt-1 text-xs text-stone-500">
          原路徑：<span class="font-mono text-stone-700">{{ renameFolderTarget }}</span>。變更後該資料夾內所有筆記路徑將一併更新。
        </p>
        <div class="mt-4">
          <input
            v-model="renameFolderInput"
            type="text"
            class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            placeholder="新資料夾名稱"
            autofocus
            @keydown.enter="submitRenameFolder"
          />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showRenameFolderModal = false">取消</UButton>
          <UButton @click="submitRenameFolder">確定更名</UButton>
        </div>
      </div>
    </div>

    <!-- 3. 刪除資料夾 Modal -->
    <div
      v-if="showDeleteFolderModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
        <h3 class="text-lg font-semibold text-red-700">刪除資料夾</h3>
        <p class="mt-1 text-sm text-stone-600">
          確定要刪除「<span class="font-mono font-medium text-stone-900">{{ deleteFolderTarget }}</span>」資料夾嗎？
        </p>
        <div class="mt-4 space-y-2 text-sm text-stone-700">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="deleteFolderAction" type="radio" value="root" class="text-stone-800" />
            <span>將資料夾內的筆記<strong>移至根目錄</strong>（保留所有筆記內容）</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-red-600">
            <input v-model="deleteFolderAction" type="radio" value="trash" class="text-red-600" />
            <span>將資料夾內所有筆記<strong>移入垃圾桶</strong>（刪除筆記）</span>
          </label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showDeleteFolderModal = false">取消</UButton>
          <UButton color="error" @click="submitDeleteFolder">確認刪除</UButton>
        </div>
      </div>
    </div>

    <!-- 4. 移動筆記 Modal -->
    <div
      v-if="showMoveNoteModal && noteToMove"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
        <h3 class="text-lg font-semibold text-stone-900">移動筆記</h3>
        <p class="mt-1 text-xs text-stone-500">
          筆記：<span class="font-medium text-stone-800">{{ noteToMove.title }}</span><br>
          目前路徑：<span class="font-mono text-stone-600">{{ noteToMove.path }}</span>
        </p>

        <div class="mt-4 space-y-3">
          <div class="space-y-1">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input v-model="moveTargetType" type="radio" value="existing" />
              <span>選擇既有資料夾</span>
            </label>
            <select
              v-if="moveTargetType === 'existing'"
              v-model="selectedTargetFolder"
              class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500"
            >
              <option value="">根目錄（未分類）</option>
              <option v-for="folder in allFolders" :key="folder" :value="folder">
                {{ folder }}
              </option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input v-model="moveTargetType" type="radio" value="new" />
              <span>移動至新資料夾</span>
            </label>
            <input
              v-if="moveTargetType === 'new'"
              v-model="customMoveTargetFolder"
              type="text"
              class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500"
              placeholder="輸入新資料夾路徑，例如：物理/力學"
              autofocus
            />
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showMoveNoteModal = false">取消</UButton>
          <UButton @click="submitMoveNote">確認移動</UButton>
        </div>
      </div>
    </div>

    <!-- 5. 重新命名筆記檔名 Modal -->
    <div
      v-if="showRenameNoteModal && noteToRename"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
        <h3 class="text-lg font-semibold text-stone-900">重新命名檔名</h3>
        <p class="mt-1 text-xs text-stone-500">
          目前路徑：<span class="font-mono text-stone-700">{{ noteToRename.path }}</span>
        </p>
        <div class="mt-4">
          <input
            v-model="renameNoteLeafInput"
            type="text"
            class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            placeholder="檔名（不含路徑）"
            autofocus
            @keydown.enter="submitRenameNote"
          />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showRenameNoteModal = false">取消</UButton>
          <UButton @click="submitRenameNote">儲存更名</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
