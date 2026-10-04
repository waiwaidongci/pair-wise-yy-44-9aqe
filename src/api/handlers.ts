import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject, seedReceipts, seedReviews } from '../stores/workshop'
import type { Cue } from '../stores/workshop'
import type { RouteChangeBatch, VenueReceipt } from '../domain/route'

let cues = structuredClone(seedCues)
let receipts = structuredClone(seedReceipts)
let batches: RouteChangeBatch[] = []
let reviews = structuredClone(seedReviews)
const cueVersions: Record<string, number> = Object.fromEntries(
  cues.map((cue) => [cue.id, cue.id === 'C-04' ? 2 : 1]),
)

export const handlers = [
  http.get('/api/project', () => HttpResponse.json(seedProject)),
  http.get('/api/cues', () =>
    HttpResponse.json(
      cues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.post('/api/cues/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { author: string; content: string }
    const cue = cues.find((item) => item.id === params.id)
    if (!cue) return new HttpResponse(null, { status: 404 })
    cue.comments.push({
      id: `comment-${Date.now()}`,
      author: body.author,
      content: body.content,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    return HttpResponse.json(cue, { status: 201 })
  }),
  http.post('/api/sync', async ({ request }) => {
    const body = (await request.json()) as { cues: typeof cues }
    cues = structuredClone(body.cues)
    return HttpResponse.json({ syncedAt: new Date().toISOString(), revision: Date.now() })
  }),

  http.get('/api/venue-receipts', () => HttpResponse.json(receipts)),

  http.post('/api/venue-receipts', async ({ request }) => {
    const body = (await request.json()) as {
      receiptNo: string
      version: number
      kind: '封闭' | '解除'
      area: VenueReceipt['area']
      simulateFailure?: boolean
    }
    if (body.simulateFailure) {
      return HttpResponse.json({ error: '场馆回执服务超时，请稍后按原批次重试' }, { status: 500 })
    }
    const existing = receipts.find((item) => item.receiptNo === body.receiptNo)
    if (existing && existing.version >= body.version) {
      return HttpResponse.json(
        { status: existing.version === body.version ? 'duplicate' : 'superseded', receipt: existing },
        { status: 200 },
      )
    }
    if (existing) existing.status = '已被替代'
    const receipt: VenueReceipt = {
      id: `RCP-${Date.now()}`,
      receiptNo: body.receiptNo,
      version: body.version,
      kind: body.kind,
      area: body.area,
      issuedAt: new Date().toISOString(),
      status: '待生效',
    }
    receipts.push(receipt)
    return HttpResponse.json({ status: 'applied', receipt }, { status: 201 })
  }),

  http.get('/api/route-batches', () => HttpResponse.json(batches)),

  http.post('/api/route-batches', async ({ request }) => {
    const body = (await request.json()) as { receiptIds: string[]; simulateFailure?: boolean }
    const id = `B-${String(batches.length + 1).padStart(3, '0')}`
    const failedReceiptIds: string[] = []
    for (const receiptId of body.receiptIds) {
      const receipt = receipts.find((item) => item.id === receiptId)
      if (!receipt) continue
      if (body.simulateFailure && failedReceiptIds.length === 0) {
        failedReceiptIds.push(receiptId)
        continue
      }
      receipt.status = '已生效'
    }
    const batch: RouteChangeBatch = {
      id,
      createdAt: new Date().toISOString(),
      status: failedReceiptIds.length ? '部分失败' : '已完成',
      receiptIds: body.receiptIds,
      failedReceiptIds,
      retries: 0,
      note: failedReceiptIds.length ? '场馆回执服务超时，可按原批次重试' : '',
    }
    batches.push(batch)
    return HttpResponse.json({ batch }, { status: 201 })
  }),

  http.post('/api/route-batches/:id/retry', async ({ params }) => {
    const batch = batches.find((item) => item.id === params.id)
    if (!batch) return new HttpResponse(null, { status: 404 })
    for (const receiptId of batch.failedReceiptIds) {
      const receipt = receipts.find((item) => item.id === receiptId)
      if (receipt) receipt.status = '已生效'
    }
    batch.failedReceiptIds = []
    batch.retries += 1
    batch.status = '已完成'
    batch.note = `已按原批次重试 ${batch.retries} 次`
    return HttpResponse.json({ batch }, { status: 200 })
  }),

  http.post('/api/cues/:id/submit', async ({ params, request }) => {
    const body = (await request.json()) as {
      baseVersion: number
      payload: Partial<Cue>
      submitter: string
    }
    const cue = cues.find((item) => item.id === params.id)
    if (!cue) return new HttpResponse(null, { status: 404 })
    const current = cueVersions[cue.id] ?? 1
    if (body.baseVersion !== current) {
      const review = {
        id: `REV-${Date.now()}`,
        cueId: cue.id,
        cueTitle: cue.title,
        submitter: body.submitter,
        submittedAt: new Date().toISOString(),
        baseVersion: body.baseVersion,
        payload: body.payload,
        status: '待复核' as const,
        reason: `版本冲突：当前 v${current}，提交基于 v${body.baseVersion}，先到已生效`,
      }
      reviews.push(review)
      return HttpResponse.json({ status: 'conflict', review }, { status: 409 })
    }
    Object.assign(cue, body.payload)
    cueVersions[cue.id] = current + 1
    return HttpResponse.json({ status: 'ok', cue, version: current + 1 }, { status: 200 })
  }),

  http.get('/api/review-queue', () => HttpResponse.json(reviews)),

  http.post('/api/review-queue/:id/resolve', async ({ params, request }) => {
    const body = (await request.json()) as { accept: boolean }
    const review = reviews.find((item) => item.id === params.id)
    if (!review) return new HttpResponse(null, { status: 404 })
    review.status = body.accept ? '已采纳' : '已驳回'
    if (body.accept) {
      const cue = cues.find((item) => item.id === review.cueId)
      if (cue) Object.assign(cue, review.payload)
    }
    return HttpResponse.json({ review }, { status: 200 })
  }),
]

export { seedMovers }
