import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import {
  activeZonesOf,
  affectedCues,
  CONCURRENT_WINDOW_MS,
  mergeReceipts,
  normalizeReceipt,
  prepareBatch,
  routeIntersectsZones,
  type CueChangeRequest,
  type NormalizedReceipt,
  type RerouteBatch,
  type VenueReceipt,
} from '../reroute/domain'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type RouteSource = '自动改线' | '人工放行'
export type CueRouteMeta = {
  source: RouteSource
  batchId?: string
  at: string
  note: string
}

export type PrintOverride = {
  cueId: string
  by: string
  reason: string
  at: string
}

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
  /** 改线批次接入后由系统记录；原路线没有该字段 */
  routeMeta?: CueRouteMeta | null
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
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v1'
const REROUTE_STORAGE_KEY = 'stage-scheduler-reroute-v1'

type ReroutePersist = {
  registry: Record<string, NormalizedReceipt>
  batches: RerouteBatch[]
  reviews: CueChangeRequest[]
  overrides: PrintOverride[]
  channelFailing: boolean
  lastCueSubmissions: Record<string, string>
}

function restoreReroute(): ReroutePersist {
  const fallback: ReroutePersist = {
    registry: {},
    batches: [],
    reviews: [],
    overrides: [],
    channelFailing: false,
    lastCueSubmissions: {},
  }
  try {
    const raw = localStorage.getItem(REROUTE_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<ReroutePersist>
    // 旧数据没有场馆版本：补首版兼容
    const registry = Object.fromEntries(
      Object.entries(parsed.registry ?? {}).map(([orderNo, receipt]) => [orderNo, normalizeReceipt(receipt as VenueReceipt)]),
    )
    return { ...fallback, ...parsed, registry }
  } catch {
    return fallback
  }
}

export const useWorkshopStore = defineStore('workshop', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const restored = saved ? (JSON.parse(saved) as { cues?: Cue[]; revision?: number }) : null
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

  // ---- 改线批次：场馆回执版本表 / 批次 / 并发复核 / 打印放行 ----
  const persistedReroute = restoreReroute()
  const receiptRegistry = ref<Record<string, NormalizedReceipt>>(persistedReroute.registry)
  const batches = ref<RerouteBatch[]>(persistedReroute.batches)
  const reviewQueue = ref<CueChangeRequest[]>(persistedReroute.reviews)
  const printOverrides = ref<PrintOverride[]>(persistedReroute.overrides)
  const channelFailing = ref(persistedReroute.channelFailing)
  const lastCueSubmissions = ref<Record<string, string>>(persistedReroute.lastCueSubmissions)
  const submittingBatch = ref(false)

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

  // ---- 生效封闭区 / 受影响提示 / 打印拦截（实时按当前路线计算） ----
  const activeZones = computed(() => activeZonesOf(receiptRegistry.value))
  const affectedCueList = computed(() => affectedCues(cues.value, activeZones.value))
  const affectedCueIds = computed(() => new Set(affectedCueList.value.map((cue) => cue.id)))
  const overrideCueIds = computed(() => new Set(printOverrides.value.map((item) => item.cueId)))
  /** 仍与封闭区冲突且没有人工放行记录：清单打印必须挡住 */
  const printBlockedCues = computed(() =>
    activeZones.value.length
      ? cues.value.filter((cue) => routeIntersectsZones(cue.route, activeZones.value) && !overrideCueIds.value.has(cue.id))
      : [],
  )
  const pendingReviews = computed(() => reviewQueue.value.filter((item) => item.status === '待复核'))
  const latestBatch = computed<RerouteBatch | undefined>(() => batches.value[batches.value.length - 1])
  const failedBatches = computed(() => batches.value.filter((batch) => batch.status === '提交失败'))

  watch(
    [cues, rev, isOffline],
    () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cues: cues.value, revision: rev.value }))
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  watch(
    [receiptRegistry, batches, reviewQueue, printOverrides, channelFailing, lastCueSubmissions],
    () => {
      const payload: ReroutePersist = {
        registry: receiptRegistry.value,
        batches: batches.value,
        reviews: reviewQueue.value,
        overrides: printOverrides.value,
        channelFailing: channelFailing.value,
        lastCueSubmissions: lastCueSubmissions.value,
      }
      localStorage.setItem(REROUTE_STORAGE_KEY, JSON.stringify(payload))
    },
    { deep: true },
  )

  // JSON 克隆可安全处理 Vue 响应式代理（structuredClone 在部分环境对代理报错）
  const cloneCues = () => JSON.parse(JSON.stringify(cues.value)) as Cue[]

  function snapshot() {
    undoStack.value.push(cloneCues())
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
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(cloneCues())
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(cloneCues())
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

  // -------------------------------------------------------------------------
  // 改线批次
  // -------------------------------------------------------------------------

  /** 只做回执合并预检（不生成批次），供工作台查看新旧版本判定 */
  function previewReceipts(receipts: VenueReceipt[]) {
    return mergeReceipts(receiptRegistry.value, receipts)
  }

  /**
   * 接收场馆回执并接成改线批次：
   * 按单号 / 版本登记，旧版本不能盖住较新封闭范围；受影响提示重算路线，
   * 算不出来的保留原路线（打印拦截由 printBlockedCues 实时判定）。
   */
  function ingestReceipts(receipts: VenueReceipt[]): RerouteBatch {
    const prepared = prepareBatch(receiptRegistry.value, receipts, cues.value)
    receiptRegistry.value = prepared.registry
    snapshot()
    const at = new Date().toISOString()
    for (const item of prepared.batch.items) {
      if (item.status !== '已改线' || !item.newRoute) continue
      const cue = cues.value.find((entry) => entry.id === item.cueId)
      if (!cue) continue
      cue.route = JSON.parse(JSON.stringify(item.newRoute)) as typeof item.newRoute
      cue.entry = { ...item.newRoute[0] }
      cue.exit = { ...item.newRoute[item.newRoute.length - 1] }
      cue.routeMeta = { source: '自动改线', batchId: prepared.batch.id, at, note: `按场馆回执 ${item.hitOrderNos.join('、')} 绕行` }
      // 原批次问题解除后，旧的人工放行记录随之失效
      printOverrides.value = printOverrides.value.filter((entry) => entry.cueId !== cue.id)
    }
    rev.value += 1
    batches.value.push(prepared.batch)
    return prepared.batch
  }

  async function commitBatch(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || batch.status === '已生效') return
    submittingBatch.value = true
    batch.attempts += 1
    try {
      await axios.post(
        '/api/reroute-batches',
        { batchId, receipts: batch.receipts },
        { headers: { 'x-venue-fail': channelFailing.value ? '1' : '0' } },
      )
      batch.status = '已生效'
      batch.lastError = ''
      batch.appliedAt = new Date().toISOString()
    } catch (error) {
      // 回执失败：批次保留原编号 / 原回执，等待「按原批次重试」
      batch.status = '提交失败'
      batch.lastError = error instanceof Error ? error.message : '场馆回执通道异常'
      throw error
    } finally {
      submittingBatch.value = false
    }
  }

  /** 回执失败后按原批次重试：不新建批次、不重新编号 */
  async function retryBatch(batchId: string) {
    await commitBatch(batchId)
  }

  function setChannelFailing(value: boolean) {
    channelFailing.value = value
  }

  // ---- 算不出来的提示：保留原路线，打印须人工放行 ----

  function releaseForPrint(cueId: string, reason: string, by = '舞台监督') {
    const cue = cues.value.find((item) => item.id === cueId)
    if (!cue || !printBlockedCues.value.some((item) => item.id === cueId)) return
    printOverrides.value.push({ cueId, by, reason, at: new Date().toISOString() })
    cue.routeMeta = { source: '人工放行', at: new Date().toISOString(), note: reason }
  }

  function revokeOverride(cueId: string) {
    printOverrides.value = printOverrides.value.filter((item) => item.cueId !== cueId)
  }

  // ---- 调度员同时提交同一提示：先到生效，后到留待复核 ----

  function submitCueChange(
    cueId: string,
    dispatcher: string,
    patch: CueChangeRequest['patch'],
    now: number = Date.now(),
  ): { applied: boolean; request: CueChangeRequest } {
    const cue = cues.value.find((item) => item.id === cueId)
    if (!cue) throw new Error(`提示 ${cueId} 不存在`)
    const lastAt = lastCueSubmissions.value[cueId]
    const inWindow = lastAt && now - new Date(lastAt).getTime() <= CONCURRENT_WINDOW_MS

    const request: CueChangeRequest = {
      id: `rev-${now}`,
      cueId,
      cueTitle: cue.title,
      dispatcher,
      submittedAt: new Date(now).toISOString(),
      patch,
      status: '待复核',
      note: inWindow ? `与上一笔提交间隔小于 ${CONCURRENT_WINDOW_MS / 1000} 秒，先到已生效，留待复核` : '同提示并发提交',
    }

    if (!inWindow) {
      lastCueSubmissions.value[cueId] = new Date(now).toISOString()
      snapshot()
      cues.value.forEach((item) => {
        if (item.id === cueId) Object.assign(item, patch)
      })
      rev.value += 1
      request.status = '已采纳'
      request.note = '先到提交，已直接生效'
      return { applied: true, request }
    }

    // 后到提交：不改数据，进入复核队列
    reviewQueue.value.unshift(request)
    return { applied: false, request }
  }

  function adoptReview(requestId: string) {
    const request = reviewQueue.value.find((item) => item.id === requestId)
    if (!request || request.status !== '待复核') return
    snapshot()
    const cue = cues.value.find((item) => item.id === request.cueId)
    if (cue) Object.assign(cue, request.patch)
    request.status = '已采纳'
    lastCueSubmissions.value[request.cueId] = request.submittedAt
    rev.value += 1
  }

  function rejectReview(requestId: string) {
    const request = reviewQueue.value.find((item) => item.id === requestId)
    if (request) request.status = '已驳回'
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
    // 改线批次
    receiptRegistry,
    batches,
    reviewQueue,
    printOverrides,
    channelFailing,
    submittingBatch,
    activeZones,
    affectedCueList,
    affectedCueIds,
    overrideCueIds,
    printBlockedCues,
    pendingReviews,
    latestBatch,
    failedBatches,
    previewReceipts,
    ingestReceipts,
    commitBatch,
    retryBatch,
    setChannelFailing,
    releaseForPrint,
    revokeOverride,
    submitCueChange,
    adoptReview,
    rejectReview,
  }
})
