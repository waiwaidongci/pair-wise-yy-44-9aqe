import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject } from '../stores/workshop'
import { seedReceipts } from '../reroute/domain'

let cues = structuredClone(seedCues)

/** 已生效批次：失败后按原批次重试，同一批次号幂等，不重复登记 */
const appliedBatches = new Map<string, { appliedAt: string }>()

export const handlers = [
  http.get('*/api/project', () => HttpResponse.json(seedProject)),
  http.get('*/api/venue-receipts', () => HttpResponse.json(seedReceipts)),
  http.get('*/api/cues', () =>
    HttpResponse.json(
      cues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.post('*/api/cues/:id/comments', async ({ params, request }) => {
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
  http.post('*/api/reroute-batches', async ({ request }) => {
    const body = (await request.json()) as { batchId: string }
    if (request.headers.get('x-venue-fail') === '1') {
      return HttpResponse.json({ error: '场馆回执通道暂不可用' }, { status: 502 })
    }
    const existing = appliedBatches.get(body.batchId)
    if (existing) {
      // 原批次重试：幂等返回首次生效时间
      return HttpResponse.json({ batchId: body.batchId, idempotent: true, appliedAt: existing.appliedAt })
    }
    const appliedAt = new Date().toISOString()
    appliedBatches.set(body.batchId, { appliedAt })
    return HttpResponse.json({ batchId: body.batchId, idempotent: false, appliedAt }, { status: 201 })
  }),
  http.post('*/api/sync', async ({ request }) => {
    const body = (await request.json()) as { cues: typeof cues }
    cues = structuredClone(body.cues)
    return HttpResponse.json({ syncedAt: new Date().toISOString(), revision: Date.now() })
  }),
]

export { seedMovers }
