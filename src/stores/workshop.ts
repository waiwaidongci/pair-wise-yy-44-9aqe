import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import {
  recalculateRoute,
  routeIntersectsArea,
  sameRoute,
  type Circle,
  type ReviewItem,
  type RouteChangeBatch,
  type VenueReceipt,
} from '../domain/route'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type RouteStatus = 'normal' | 'rerouted' | 'blocked'

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
  venueVersion: number
  routeStatus: RouteStatus
  printBlocked: boolean
  originalRoute?: Point[]
  blockReason?: string
}

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

export const seedReceipts: VenueReceipt[] = [
  {
    id: 'RCP-SEED-01',
    receiptNo: 'RC-2026-001',
    version: 1,
    kind: '封闭',
    area: { x: 30, y: 66, r: 10 },
    issuedAt: '2026-10-03 09:12',
    status: '待生效',
  },
  {
    id: 'RCP-SEED-02',
    receiptNo: 'RC-2026-002',
    version: 1,
    kind: '封闭',
    area: { x: 70, y: 80, r: 12 },
    issuedAt: '2026-10-03 09:14',
    status: '待生效',
  },
]

export const seedReviews: ReviewItem[] = [
  {
    id: 'REV-SEED-01',
    cueId: 'C-04',
    cueTitle: '爆闪与低频重音',
    submitter: '王灯控',
    submittedAt: '2026-10-03 10:02',
    baseVersion: 1,
    payload: { duration: 24, note: '与机械动作互锁，机械未到位禁止触发。低频下延 2 秒。' },
    status: '待复核',
    reason: '版本冲突：当前 v2，提交基于 v1，先到已生效',
  },
]

export const seedCueVersions: Record<string, number> = { 'C-04': 2 }

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:39:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 70, y: 44 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 70, y: 44 }],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    comments: [],
    venueVersion: 1,
    routeStatus: 'normal',
    printBlocked: false,
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v2'

export const useWorkshopStore = defineStore('workshop', () => {
  const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('stage-scheduler-draft-v1')
  const restored = saved
    ? (JSON.parse(saved) as {
        cues?: Cue[]
        revision?: number
        receipts?: VenueReceipt[]
        batches?: RouteChangeBatch[]
        reviewQueue?: ReviewItem[]
        cueVersions?: Record<string, number>
      })
    : null
  const cues = ref<Cue[]>(restored?.cues?.length ? restored.cues : structuredClone(seedCues))
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored?.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  const receipts = ref<VenueReceipt[]>(restored?.receipts?.length ? restored.receipts : structuredClone(seedReceipts))
  const batches = ref<RouteChangeBatch[]>(restored?.batches ?? [])
  const reviewQueue = ref<ReviewItem[]>(restored?.reviewQueue?.length ? restored.reviewQueue : structuredClone(seedReviews))
  const cueVersions = ref<Record<string, number>>(restored?.cueVersions ?? structuredClone(seedCueVersions))

  function migrateLegacyCues() {
    for (const cue of cues.value) {
      if (cue.venueVersion == null) cue.venueVersion = 1
      if (cue.routeStatus == null) cue.routeStatus = 'normal'
      if (cue.printBlocked == null) cue.printBlocked = false
    }
  }
  migrateLegacyCues()

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  const pendingReceipts = computed(() => receipts.value.filter((receipt) => receipt.status === '待生效'))

  const activeClosures = computed<Circle[]>(() => {
    const latest = new Map<string, VenueReceipt>()
    for (const receipt of receipts.value) {
      if (receipt.status !== '已生效') continue
      const current = latest.get(receipt.receiptNo)
      if (!current || receipt.version > current.version) latest.set(receipt.receiptNo, receipt)
    }
    return [...latest.values()].filter((receipt) => receipt.kind === '封闭').map((receipt) => receipt.area)
  })

  const blockedCues = computed(() => cues.value.filter((cue) => cue.printBlocked))
  const hasPrintBlock = computed(() => blockedCues.value.length > 0)
  const pendingReviews = computed(() => reviewQueue.value.filter((review) => review.status === '待复核'))

  watch(
    [cues, rev, isOffline, receipts, batches, reviewQueue, cueVersions],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          cues: cues.value,
          revision: rev.value,
          receipts: receipts.value,
          batches: batches.value,
          reviewQueue: reviewQueue.value,
          cueVersions: cueVersions.value,
        }),
      )
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(structuredClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    cues.value[index] = { ...cues.value[index], ...patch }
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: { x: number; y: number }) {
    const cue = selectedCue.value
    if (!cue) return
    updateCue({ route: [...cue.route, point] })
  }

  function addCue() {
    if (locked.value) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
      venueVersion: 1,
      routeStatus: 'normal',
      printBlocked: false,
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(structuredClone(cues.value))
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(structuredClone(cues.value))
    cues.value = next
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    cue.comments.push({
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    })
    rev.value += 1
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (comment) comment.resolved = !comment.resolved
  }

  function lockBaseline() {
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locked.value = false
    rev.value += 1
  }

  function toggleOffline() {
    isOffline.value = !isOffline.value
  }

  function cueVersion(cueId: string): number {
    return cueVersions.value[cueId] ?? 1
  }

  function applyRouteChanges() {
    const closures = activeClosures.value
    for (const cue of cues.value) {
      const original = cue.originalRoute ? structuredClone(cue.originalRoute) : structuredClone(cue.route)
      let current = original
      let blocked = false
      for (const area of closures) {
        if (routeIntersectsArea(current, area)) {
          const next = recalculateRoute(current, area)
          if (!next) {
            blocked = true
            break
          }
          current = next
        }
      }
      if (blocked) {
        cue.originalRoute = original
        cue.route = structuredClone(original)
        cue.routeStatus = 'blocked'
        cue.printBlocked = true
        cue.blockReason = '路线穿越封闭区域且无法绕行（入口或出口在封闭区内），已保留原路线'
      } else if (!sameRoute(current, original)) {
        cue.originalRoute = original
        cue.route = current
        cue.routeStatus = 'rerouted'
        cue.printBlocked = false
        cue.blockReason = undefined
      } else {
        cue.route = structuredClone(original)
        cue.routeStatus = 'normal'
        cue.printBlocked = false
        cue.originalRoute = undefined
        cue.blockReason = undefined
      }
    }
  }

  async function submitReceipt(input: {
    receiptNo: string
    version: number
    kind: '封闭' | '解除'
    area: Circle
  }): Promise<{ status: 'applied' | 'superseded' | 'duplicate' | 'failed'; message: string }> {
    try {
      const { data } = await axios.post('/api/venue-receipts', input)
      if (data.status === 'applied') {
        for (const receipt of receipts.value) {
          if (receipt.receiptNo === input.receiptNo && receipt.status !== '已被替代') {
            receipt.status = '已被替代'
          }
        }
        receipts.value.push(data.receipt)
        return { status: 'applied', message: `回执 ${input.receiptNo} v${input.version} 已接收，待纳入改线批次` }
      }
      if (data.status === 'superseded') {
        return { status: 'superseded', message: `回执 ${input.receiptNo} v${input.version} 已被较新版本替代，未生效` }
      }
      return { status: 'duplicate', message: `回执 ${input.receiptNo} v${input.version} 已存在，未重复处理` }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 500) {
        return { status: 'failed', message: '场馆回执服务超时，请按原批次重试' }
      }
      throw error
    }
  }

  async function createBatch(simulateFailure = false): Promise<RouteChangeBatch | null> {
    const pending = pendingReceipts.value
    if (!pending.length) return null
    const { data } = await axios.post('/api/route-batches', {
      receiptIds: pending.map((receipt) => receipt.id),
      simulateFailure,
    })
    for (const receipt of pending) {
      if (!data.batch.failedReceiptIds.includes(receipt.id)) receipt.status = '已生效'
    }
    batches.value.unshift(data.batch)
    applyRouteChanges()
    rev.value += 1
    return data.batch
  }

  async function retryBatch(batchId: string) {
    const { data } = await axios.post(`/api/route-batches/${batchId}/retry`)
    const batch = batches.value.find((item) => item.id === batchId)
    if (batch) Object.assign(batch, data.batch)
    for (const receipt of receipts.value) {
      if (data.batch.receiptIds.includes(receipt.id) && receipt.status === '待生效') receipt.status = '已生效'
    }
    applyRouteChanges()
    rev.value += 1
  }

  async function submitCueConcurrent(
    cueId: string,
    baseVersion: number,
    payload: Partial<Cue>,
    submitter = '调度员',
  ): Promise<{ ok: boolean; reviewId?: string }> {
    try {
      await axios.post(`/api/cues/${cueId}/submit`, { baseVersion, payload, submitter })
      const cue = cues.value.find((item) => item.id === cueId)
      if (cue) Object.assign(cue, payload)
      cueVersions.value[cueId] = baseVersion + 1
      rev.value += 1
      return { ok: true }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const review: ReviewItem = error.response.data.review
        reviewQueue.value.unshift(review)
        return { ok: false, reviewId: review.id }
      }
      throw error
    }
  }

  async function resolveReview(reviewId: string, accept: boolean) {
    const { data } = await axios.post(`/api/review-queue/${reviewId}/resolve`, { accept })
    const local = reviewQueue.value.find((review) => review.id === reviewId)
    if (local) local.status = data.review.status
    if (accept) {
      const cue = cues.value.find((item) => item.id === data.review.cueId)
      if (cue) Object.assign(cue, data.review.payload)
      rev.value += 1
    }
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    toggleOffline,
    receipts,
    batches,
    reviewQueue,
    pendingReceipts,
    pendingReviews,
    activeClosures,
    blockedCues,
    hasPrintBlock,
    cueVersion,
    submitReceipt,
    createBatch,
    retryBatch,
    submitCueConcurrent,
    resolveReview,
  }
})
