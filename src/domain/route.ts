export type Point = { x: number; y: number }
export type Circle = { x: number; y: number; r: number }

export type ReceiptKind = '封闭' | '解除'
export type ReceiptStatus = '待生效' | '已生效' | '已被替代'

export type VenueReceipt = {
  id: string
  receiptNo: string
  version: number
  kind: ReceiptKind
  area: Circle
  issuedAt: string
  status: ReceiptStatus
}

export type BatchStatus = '处理中' | '已完成' | '部分失败'

export type RouteChangeBatch = {
  id: string
  createdAt: string
  status: BatchStatus
  receiptIds: string[]
  failedReceiptIds: string[]
  retries: number
  note: string
}

export type ReviewStatus = '待复核' | '已采纳' | '已驳回'

export type ReviewItem = {
  id: string
  cueId: string
  cueTitle: string
  submitter: string
  submittedAt: string
  baseVersion: number
  payload: Record<string, unknown>
  status: ReviewStatus
  reason: string
}

export function isPointInCircle(p: Point, c: Circle): boolean {
  const dx = p.x - c.x
  const dy = p.y - c.y
  return dx * dx + dy * dy <= c.r * c.r
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const proj = { x: a.x + t * dx, y: a.y + t * dy }
  return Math.hypot(p.x - proj.x, p.y - proj.y)
}

export function segmentHitsCircle(a: Point, b: Point, c: Circle): boolean {
  return distToSegment(c, a, b) <= c.r
}

export function routeIntersectsArea(route: Point[], area: Circle): boolean {
  if (route.length < 2) return false
  for (let i = 0; i < route.length - 1; i += 1) {
    if (segmentHitsCircle(route[i], route[i + 1], area)) return true
  }
  return false
}

function buildDetour(a: Point, b: Point, c: Circle, margin: number): Point | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const q = { x: a.x + t * dx, y: a.y + t * dy }
  let vx = q.x - c.x
  let vy = q.y - c.y
  const vlen = Math.hypot(vx, vy)
  if (vlen < 0.001) {
    const slen = Math.hypot(dx, dy) || 1
    vx = -dy / slen
    vy = dx / slen
  } else {
    vx /= vlen
    vy /= vlen
  }
  const point = { x: c.x + (c.r + margin) * vx, y: c.y + (c.r + margin) * vy }
  if (isPointInCircle(point, c)) return null
  return point
}

const DETOUR_MARGIN = 4

export function sameRoute(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.x === b[i].x && p.y === b[i].y)
}

/**
 * 沿封闭区外侧重算路线：对每条穿越封闭区的线段，沿背离圆心的方向绕行。
 * 入口或出口落在封闭区内时无法重算，返回 null；中途节点落在封闭区内则移除后绕行。
 */
export function recalculateRoute(route: Point[], area: Circle): Point[] | null {
  if (route.length < 2) return null
  const entry = route[0]
  const exit = route[route.length - 1]
  if (isPointInCircle(entry, area) || isPointInCircle(exit, area)) return null

  const cleaned: Point[] = [entry]
  for (let i = 1; i < route.length - 1; i += 1) {
    if (!isPointInCircle(route[i], area)) cleaned.push(route[i])
  }
  cleaned.push(exit)

  const result: Point[] = [cleaned[0]]
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const a = cleaned[i]
    const b = cleaned[i + 1]
    if (segmentHitsCircle(a, b, area)) {
      const detour = buildDetour(a, b, area, DETOUR_MARGIN)
      if (!detour) return null
      result.push(detour)
    }
    result.push(b)
  }
  return result.filter((p, idx) => idx === 0 || p.x !== result[idx - 1].x || p.y !== result[idx - 1].y)
}
