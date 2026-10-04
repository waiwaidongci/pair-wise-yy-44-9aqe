import type { Cue, Point } from '../stores/workshop'

// ---------------------------------------------------------------------------
// 场馆回执：按单号 + 版本识别；旧版本不能盖住较新的封闭范围；
// 无场馆版本的旧数据先兼容补首版（venueVersion === 1 且 legacy === true）。
// ---------------------------------------------------------------------------

export type VenueReceiptType = '封闭' | '解除'

export type VenueZone = {
  id: string
  /** 舞台平面百分比坐标 0..100 的轴对齐矩形 */
  x: number
  y: number
  w: number
  h: number
  label: string
}

export type VenueReceipt = {
  /** 回执单号 */
  orderNo: string
  /** 场馆版本号；旧数据没有版本时缺省，入库时补首版 1 */
  venueVersion?: number
  type: VenueReceiptType
  zones: VenueZone[]
  issuedAt: string
  venue: string
}

/** 归一化后的回执（已经补首版兼容处理） */
export type NormalizedReceipt = VenueReceipt & { venueVersion: number; legacy: boolean }

export type ReceiptMergeRecord = {
  orderNo: string
  applied: boolean
  stale: boolean
  legacy: boolean
  version: number
  type: VenueReceiptType
  reason: string
  zoneCount: number
  issuedAt: string
}

export type ReceiptIngestResult = {
  accepted: ReceiptMergeRecord[]
  rejected: ReceiptMergeRecord[]
  /** 当前生效封闭区（各单号取最新版本，且最新版本为「封闭」） */
  activeZones: ActiveZone[]
}

export type ActiveZone = VenueZone & { orderNo: string; version: number }

export function normalizeReceipt(receipt: VenueReceipt): NormalizedReceipt {
  if (receipt.venueVersion != null && Number.isFinite(receipt.venueVersion)) {
    return { ...receipt, venueVersion: receipt.venueVersion, legacy: false }
  }
  // 旧数据没有场馆版本：先兼容补首版
  return { ...receipt, venueVersion: 1, legacy: true }
}

/**
 * 回执合入版本注册表：同一单号只接受较新版本；旧版本不能盖住较新版本。
 * 返回的注册表按单号保存当前最新归一化回执。
 */
export function mergeReceipts(
  registry: Record<string, NormalizedReceipt>,
  receipts: VenueReceipt[],
): { registry: Record<string, NormalizedReceipt>; accepted: ReceiptMergeRecord[]; rejected: ReceiptMergeRecord[] } {
  const next: Record<string, NormalizedReceipt> = { ...registry }
  const accepted: ReceiptMergeRecord[] = []
  const rejected: ReceiptMergeRecord[] = []

  for (const raw of receipts) {
    const receipt = normalizeReceipt(raw)
    const current = next[receipt.orderNo]
    const describe = (reason: string): ReceiptMergeRecord => ({
      orderNo: receipt.orderNo,
      applied: false,
      stale: false,
      legacy: receipt.legacy,
      version: receipt.venueVersion,
      type: receipt.type,
      reason,
      zoneCount: receipt.zones.length,
      issuedAt: receipt.issuedAt,
    })

    if (receipt.venueVersion < 1) {
      rejected.push(describe('版本号无效，已退回场馆'))
      continue
    }
    if (!receipt.zones.length) {
      rejected.push(describe('回执未附带封闭区域'))
      continue
    }

    if (!current || receipt.venueVersion > current.venueVersion) {
      next[receipt.orderNo] = receipt
      accepted.push({
        ...describe(''),
        applied: true,
        reason: current
          ? `v${receipt.venueVersion} 覆盖 v${current.venueVersion}`
          : receipt.legacy
            ? '旧数据无场馆版本，已兼容补首版 v1'
            : `登记 v${receipt.venueVersion}`,
      })
    } else if (receipt.venueVersion === current.venueVersion) {
      rejected.push({ ...describe(''), stale: true, reason: `v${receipt.venueVersion} 与已收录版本相同，重复回执忽略` })
    } else {
      rejected.push({
        ...describe(''),
        stale: true,
        reason: `v${receipt.venueVersion} 旧于当前 v${current.venueVersion}，不能覆盖较新封闭范围`,
      })
    }
  }

  return { registry: next, accepted, rejected }
}

/** 从版本注册表计算当前生效封闭区：只取各单号最新版本中的「封闭」回执 */
export function activeZonesOf(registry: Record<string, NormalizedReceipt>): ActiveZone[] {
  const zones: ActiveZone[] = []
  for (const receipt of Object.values(registry)) {
    if (receipt.type !== '封闭') continue
    for (const zone of receipt.zones) {
      zones.push({ ...zone, orderNo: receipt.orderNo, version: receipt.venueVersion })
    }
  }
  return zones
}

// ---------------------------------------------------------------------------
// 几何：封闭区命中判定（带安全余量）与网格 A* 改线
// ---------------------------------------------------------------------------

/** 安全余量（百分比坐标），路线需离封闭区边缘留出安全距离 */
export const SAFETY_MARGIN = 1
/** 网格步长（101 x 101，和平面图的整数节点坐标一致） */
export const GRID = 100

export function inflateZone(zone: VenueZone, margin = SAFETY_MARGIN) {
  return {
    left: Math.max(0, zone.x - margin),
    top: Math.max(0, zone.y - margin),
    right: Math.min(100, zone.x + zone.w + margin),
    bottom: Math.min(100, zone.y + zone.h + margin),
  }
}

export function pointInZone(point: Point, zone: VenueZone, margin = SAFETY_MARGIN): boolean {
  const box = inflateZone(zone, margin)
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
}

function segmentHitsZone(a: Point, b: Point, zone: VenueZone, margin = SAFETY_MARGIN): boolean {
  // 端点 / 中点加密采样；网格整数节点下步长 1 不会漏检
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.max(1, Math.ceil(dist / 1))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    if (pointInZone({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, zone, margin)) return true
  }
  return false
}

/** 路线是否穿过任意生效封闭区 */
export function routeIntersectsZones(route: Point[], zones: VenueZone[]): boolean {
  if (route.length < 2) return route.some((point) => zones.some((zone) => pointInZone(point, zone)))
  for (let i = 0; i < route.length - 1; i += 1) {
    if (zones.some((zone) => segmentHitsZone(route[i], route[i + 1], zone))) return true
  }
  return false
}

/** 受影响提示：原路线（含节点）与生效封闭区冲突 */
export function affectedCues(cues: Cue[], zones: ActiveZone[]): Cue[] {
  if (!zones.length) return []
  return cues.filter((cue) => routeIntersectsZones(cue.route, zones))
}

function buildBlockedSet(zones: VenueZone[]): Set<number> {
  const blocked = new Set<number>()
  for (const zone of zones) {
    const box = inflateZone(zone)
    for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x += 1) {
      for (let y = Math.ceil(box.top); y <= Math.floor(box.bottom); y += 1) {
        blocked.add(y * (GRID + 1) + x)
      }
    }
  }
  return blocked
}

const keyOf = (x: number, y: number) => y * (GRID + 1) + x
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

/** 网格 A*；禁止斜穿封闭区角点。算不出路径返回 null */
function findPath(start: Point, goal: Point, blocked: Set<number>): Point[] | null {
  if (blocked.has(keyOf(start.x, start.y)) || blocked.has(keyOf(goal.x, goal.y))) return null
  if (start.x === goal.x && start.y === goal.y) return [{ ...start }]

  const h = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x)
    const dy = Math.abs(y - goal.y)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }

  type Node = { x: number; y: number; g: number; f: number; parent: number }
  const open = new Map<number, Node>()
  const closed = new Map<number, Node>()
  const startKey = keyOf(start.x, start.y)
  open.set(startKey, { x: start.x, y: start.y, g: 0, f: h(start.x, start.y), parent: -1 })

  let guard = 0
  while (open.size && guard < 60000) {
    guard += 1
    let currentKey = -1
    let current: Node | null = null
    for (const [key, node] of open) {
      if (!current || node.f < current.f) {
        current = node
        currentKey = key
      }
    }
    if (!current) break
    if (current.x === goal.x && current.y === goal.y) {
      const path: Point[] = []
      let trace: Node | undefined = current
      let traceKey = currentKey
      while (trace) {
        path.push({ x: trace.x, y: trace.y })
        if (trace.parent < 0) break
        traceKey = trace.parent
        trace = open.get(traceKey) ?? closed.get(traceKey)
      }
      return path.reverse()
    }
    open.delete(currentKey)
    closed.set(currentKey, current)

    for (const [dx, dy] of NEIGHBORS) {
      const x = current.x + dx
      const y = current.y + dy
      if (x < 0 || y < 0 || x > GRID || y > GRID) continue
      const key = keyOf(x, y)
      if (closed.has(key) || blocked.has(key)) continue
      // 斜向移动不能贴角穿过
      if (dx !== 0 && dy !== 0 && (blocked.has(keyOf(current.x + dx, current.y)) || blocked.has(keyOf(current.x, current.y + dy)))) {
        continue
      }
      const g = current.g + (dx === 0 || dy === 0 ? 1 : Math.SQRT2)
      const existing = open.get(key)
      if (existing && existing.g <= g) continue
      open.set(key, { x, y, g, f: g + h(x, y), parent: currentKey })
    }
  }
  return null
}

function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points
  const result = [points[0]]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1]
    const next = points[i + 1]
    const cross = (points[i].x - prev.x) * (next.y - prev.y) - (points[i].y - prev.y) * (next.x - prev.x)
    if (cross !== 0 || points[i].x !== prev.x || points[i].x !== next.x || points[i].y !== prev.y) {
      result.push(points[i])
    }
  }
  result.push(points[points.length - 1])
  return result
}

/** 视线拉直：沿 A* 折线跳过中间点，只要新线段不进入任何封闭格 */
function compressPath(points: Point[], blocked: Set<number>): Point[] {
  if (points.length <= 2) return points
  const segmentClear = (a: Point, b: Point) => {
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(dist / 0.5))
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps
      const x = Math.round(a.x + (b.x - a.x) * t)
      const y = Math.round(a.y + (b.y - a.y) * t)
      if (blocked.has(keyOf(x, y))) return false
    }
    return true
  }
  const result = [points[0]]
  let anchor = 0
  while (anchor < points.length - 1) {
    let farthest = anchor + 1
    for (let probe = anchor + 2; probe < points.length; probe += 1) {
      if (segmentClear(points[anchor], points[probe])) farthest = probe
      else break
    }
    result.push(points[farthest])
    anchor = farthest
  }
  return result
}

export type RerouteOutcome =
  | { ok: true; route: Point[]; droppedWaypoints: Point[] }
  | { ok: false; route: null; reason: string }

/**
 * 受影响提示重算路线：
 * 1) 入场 / 退场落在封闭区内 → 无法改线；
 * 2) 丢掉落在封闭区内的中间节点，逐段绕开（保留仍可行的原节点）；
 * 3) 逐段失败时退化为入场直达退场；仍失败 → 保留原路线（由调用方挡打印）。
 */
export function rerouteCue(cue: Cue, zones: ActiveZone[]): RerouteOutcome {
  const blocked = buildBlockedSet(zones)
  const start = cue.route[0] ?? cue.entry
  const goal = cue.route[cue.route.length - 1] ?? cue.exit
  if (zones.some((zone) => pointInZone(start, zone))) {
    return { ok: false, route: null, reason: '入场点位于封闭区内，需场馆现场确认' }
  }
  if (zones.some((zone) => pointInZone(goal, zone))) {
    return { ok: false, route: null, reason: '退场点位于封闭区内，需场馆现场确认' }
  }

  const dropped: Point[] = []
  const waypoints = cue.route.filter((point, index) => {
    if (index === 0 || index === cue.route.length - 1) return true
    const inside = zones.some((zone) => pointInZone(point, zone))
    if (inside) dropped.push(point)
    return !inside
  })

  let assembled: Point[] | null = []
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const segment = findPath(waypoints[i], waypoints[i + 1], blocked)
    if (!segment) {
      assembled = null
      break
    }
    assembled.push(...(i === 0 ? segment : segment.slice(1)))
  }

  if (!assembled) {
    const direct = findPath(start, goal, blocked)
    if (!direct) return { ok: false, route: null, reason: '绕行路径被封闭区隔断，调度员需人工处理' }
    return { ok: true, route: simplify(compressPath(direct, blocked)), droppedWaypoints: dropped }
  }

  return { ok: true, route: simplify(compressPath(assembled, blocked)), droppedWaypoints: dropped }
}

// ---------------------------------------------------------------------------
// 改线批次
// ---------------------------------------------------------------------------

export type RerouteItemStatus = '已改线' | '待人工处理'
export type RerouteItem = {
  cueId: string
  title: string
  status: RerouteItemStatus
  /** 原路线保留在提示本体，这里只记录改线结果与原因 */
  newRoute: Point[] | null
  droppedWaypoints: Point[]
  reason: string
  hitOrderNos: string[]
}

export type BatchStatus = '待提交' | '提交失败' | '已生效'

export type RerouteBatch = {
  id: string
  createdAt: string
  status: BatchStatus
  /** 原批次回执（失败后按原批次重试，不重新编号） */
  receipts: NormalizedReceipt[]
  records: ReceiptMergeRecord[]
  rejectedRecords: ReceiptMergeRecord[]
  items: RerouteItem[]
  attempts: number
  lastError: string
  appliedAt: string | null
}

export function hitOrderNosOf(route: Point[], zones: ActiveZone[]): string[] {
  return [...new Set(zones.filter((zone) => routeIntersectsZones(route, [zone])).map((zone) => zone.orderNo))]
}

export type PreparedBatch = {
  batch: RerouteBatch
  activeZones: ActiveZone[]
}

let batchSeq = 0

/**
 * 把一批场馆回执接成改线批次：
 * - 回执按单号 / 版本合入注册表，旧版本不能覆盖新版本；
 * - 受影响提示重算路线，算不出来保留原路线并标记「待人工处理」（挡打印）。
 */
export function prepareBatch(
  registry: Record<string, NormalizedReceipt>,
  receipts: VenueReceipt[],
  cues: Cue[],
  now = new Date(),
): PreparedBatch & { registry: Record<string, NormalizedReceipt> } {
  const merged = mergeReceipts(registry, receipts)
  const activeZones = activeZonesOf(merged.registry)
  const items: RerouteItem[] = affectedCues(cues, activeZones).map((cue) => {
    const outcome = rerouteCue(cue, activeZones)
    return {
      cueId: cue.id,
      title: cue.title,
      status: outcome.ok ? '已改线' : '待人工处理',
      newRoute: outcome.ok ? outcome.route : null,
      droppedWaypoints: outcome.ok ? outcome.droppedWaypoints : [],
      reason: outcome.ok ? '' : outcome.reason,
      hitOrderNos: hitOrderNosOf(cue.route, activeZones),
    }
  })

  batchSeq += 1
  const stamp = now
  const id = `RB-${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(batchSeq).padStart(2, '0')}`
  const batch: RerouteBatch = {
    id,
    createdAt: stamp.toISOString(),
    status: '待提交',
    receipts: receipts.map(normalizeReceipt),
    records: merged.accepted,
    rejectedRecords: merged.rejected,
    items,
    attempts: 0,
    lastError: '',
    appliedAt: null,
  }
  return { batch, activeZones, registry: merged.registry }
}

// ---------------------------------------------------------------------------
// 调度员并发提交同一提示：先到生效，后到留待复核
// ---------------------------------------------------------------------------

export type CueChangeRequest = {
  id: string
  cueId: string
  cueTitle: string
  dispatcher: string
  submittedAt: string
  patch: Partial<Pick<Cue, 'title' | 'time' | 'owner' | 'note' | 'duration'>>
  status: '待复核' | '已采纳' | '已驳回'
  note: string
}

export const CONCURRENT_WINDOW_MS = 8000

// ---------------------------------------------------------------------------
// 演示用场馆回执种子（含旧版本覆盖、解除、无版本旧数据、致命封闭）
// ---------------------------------------------------------------------------

export const seedReceipts: VenueReceipt[] = [
  {
    orderNo: 'V-SH-1012',
    venueVersion: 1,
    type: '封闭',
    zones: [{ id: 'Z-1012-A', x: 28, y: 48, w: 22, h: 20, label: '主舞台机械吊装区' }],
    issuedAt: '2026-10-04 09:10',
    venue: '上海大剧院',
  },
  {
    orderNo: 'V-SH-1012',
    venueVersion: 2,
    type: '封闭',
    zones: [{ id: 'Z-1012-A2', x: 30, y: 50, w: 26, h: 22, label: '吊装区扩大（v2）' }],
    issuedAt: '2026-10-04 09:40',
    venue: '上海大剧院',
  },
  {
    // 同单号旧版本：不能盖住 v2
    orderNo: 'V-SH-1012',
    venueVersion: 1,
    type: '封闭',
    zones: [{ id: 'Z-1012-OLD', x: 20, y: 30, w: 10, h: 10, label: '吊装区初版（应作废）' }],
    issuedAt: '2026-10-04 09:05',
    venue: '上海大剧院',
  },
  {
    orderNo: 'V-SH-1018',
    type: '封闭',
    // 旧数据，没有 venueVersion：兼容补首版
    zones: [{ id: 'Z-1018-A', x: 6, y: 58, w: 8, h: 8, label: '侧门灯光检修（旧版回执）' }],
    issuedAt: '2026-10-03 21:30',
    venue: '上海大剧院',
  },
  {
    orderNo: 'V-SH-1021',
    venueVersion: 1,
    type: '封闭',
    zones: [{ id: 'Z-1021-A', x: 80, y: 36, w: 16, h: 34, label: '右侧布景封存（含退场点）' }],
    issuedAt: '2026-10-04 10:05',
    venue: '上海大剧院',
  },
  {
    orderNo: 'V-SH-1021',
    venueVersion: 2,
    type: '解除',
    zones: [{ id: 'Z-1021-A', x: 80, y: 36, w: 16, h: 34, label: '布景封存解除（v2）' }],
    issuedAt: '2026-10-04 11:20',
    venue: '上海大剧院',
  },
]
