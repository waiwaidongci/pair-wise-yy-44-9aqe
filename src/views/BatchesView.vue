<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import type { ReceiptKind } from '../domain/route'

const store = useWorkshopStore()

const receiptNo = ref('RC-2026-003')
const receiptVersion = ref(1)
const receiptKind = ref<ReceiptKind>('封闭')
const areaX = ref(50)
const areaY = ref(50)
const areaR = ref(10)
const simulateFailure = ref(true)

const concurrentCueId = ref('C-04')
const concurrentCue = computed(() => store.cues.find((cue) => cue.id === concurrentCueId.value))

const reroutedCues = computed(() => store.cues.filter((cue) => cue.routeStatus === 'rerouted'))
const normalCues = computed(() => store.cues.filter((cue) => cue.routeStatus === 'normal'))

async function submitReceipt() {
  const result = await store.submitReceipt({
    receiptNo: receiptNo.value.trim(),
    version: receiptVersion.value,
    kind: receiptKind.value,
    area: { x: areaX.value, y: areaY.value, r: areaR.value },
  })
  if (result.status === 'applied') {
    ElMessage.success(result.message)
    receiptVersion.value += 1
  } else if (result.status === 'failed') {
    ElMessage.error(result.message)
  } else {
    ElMessage.warning(result.message)
  }
}

async function createBatch() {
  const batch = await store.createBatch(simulateFailure.value)
  if (!batch) {
    ElMessage.info('没有待生效回执')
    return
  }
  if (batch.status === '已完成') {
    ElMessage.success(`批次 ${batch.id} 已完成，路线已重算`)
  } else {
    ElMessage.warning(`批次 ${batch.id} 部分失败，可按原批次重试`)
  }
}

async function retry(batchId: string) {
  await store.retryBatch(batchId)
  ElMessage.success('已按原批次重试，路线重算完成')
}

async function simulateConcurrentSubmit() {
  const cue = concurrentCue.value
  if (!cue) return
  const base = store.cueVersion(cue.id)
  const payload = { duration: cue.duration + 2 }
  const [first, second] = await Promise.all([
    store.submitCueConcurrent(cue.id, base, payload, '调度员甲'),
    store.submitCueConcurrent(cue.id, base, payload, '调度员乙'),
  ])
  if (first.ok && !second.ok) {
    ElMessage.success('先到的提示已生效，后到的已留待复核')
  } else if (!first.ok && second.ok) {
    ElMessage.success('先到的提示已生效，后到的已留待复核')
  } else {
    ElMessage.info('两次提交均已生效')
  }
}

async function resolve(reviewId: string, accept: boolean) {
  await store.resolveReview(reviewId, accept)
  ElMessage.success(accept ? '复核已采纳，提示已更新' : '复核已驳回')
}

function routeSummary(cueId: string): string {
  const cue = store.cues.find((item) => item.id === cueId)
  if (!cue) return ''
  return cue.route.map((point) => `${point.x},${point.y}`).join(' → ')
}
</script>

<template>
  <section class="page batches-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">ROUTE BATCH / 改线批次</p>
        <h1>场馆回执与改线批次</h1>
        <p class="muted">场馆封闭 / 解除回执按单号和版本识别，旧版本不会盖住较新的封闭范围；受影响提示统一重算路线，算不出来就保留原路线并挡住打印。</p>
      </div>
      <div class="actions">
        <el-button @click="simulateConcurrentSubmit">模拟同时提交同一提示</el-button>
        <el-button type="primary" :disabled="!store.pendingReceipts.length" @click="createBatch">
          生成改线批次（{{ store.pendingReceipts.length }} 份待生效回执）
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="store.hasPrintBlock"
      class="block-alert"
      type="error"
      show-icon
      :closable="false"
      title="打印已挡住：存在无法绕行的封闭区域"
      description="以下提示的路线穿越场馆封闭区且无法重算，已保留原路线；请先处理场馆回执或调整路线，打印中心暂不可用。"
    >
      <ul class="block-list">
        <li v-for="cue in store.blockedCues" :key="cue.id">
          <strong>{{ cue.id }}</strong> · {{ cue.title }} — {{ cue.blockReason }}
        </li>
      </ul>
    </el-alert>

    <div class="metric-grid">
      <article class="metric">
        <span>待生效回执</span>
        <strong>{{ store.pendingReceipts.length }}</strong>
        <small>纳入批次后生效</small>
      </article>
      <article class="metric">
        <span>已生效封闭区</span>
        <strong>{{ store.activeClosures.length }}</strong>
        <small>参与路线重算</small>
      </article>
      <article class="metric">
        <span>改线成功</span>
        <strong class="teal">{{ reroutedCues.length }}</strong>
        <small>已按封闭区绕行</small>
      </article>
      <article class="metric">
        <span>改线失败</span>
        <strong class="red">{{ store.blockedCues.length }}</strong>
        <small>保留原路线 · 打印挡住</small>
      </article>
    </div>

    <div class="batches-grid">
      <section class="panel">
        <div class="panel-head">
          <h3>场馆回执</h3>
          <span class="muted">按单号和版本识别</span>
        </div>
        <div class="receipt-form">
          <el-input v-model="receiptNo" placeholder="单号" size="small" style="width: 150px" />
          <el-input-number v-model="receiptVersion" :min="1" size="small" controls-position="right" style="width: 96px" />
          <el-select v-model="receiptKind" size="small" style="width: 96px">
            <el-option label="封闭" value="封闭" />
            <el-option label="解除" value="解除" />
          </el-select>
          <el-input-number v-model="areaX" :min="0" :max="100" size="small" controls-position="right" style="width: 86px" />
          <el-input-number v-model="areaY" :min="0" :max="100" size="small" controls-position="right" style="width: 86px" />
          <el-input-number v-model="areaR" :min="1" :max="40" size="small" controls-position="right" style="width: 86px" />
          <el-button size="small" type="primary" @click="submitReceipt">提交回执</el-button>
        </div>
        <table class="receipt-table">
          <thead>
            <tr>
              <th>单号</th>
              <th>版本</th>
              <th>种类</th>
              <th>范围</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="receipt in store.receipts" :key="receipt.id">
              <td class="mono">{{ receipt.receiptNo }}</td>
              <td>v{{ receipt.version }}</td>
              <td>
                <el-tag :type="receipt.kind === '封闭' ? 'danger' : 'success'" effect="plain" size="small">{{ receipt.kind }}</el-tag>
              </td>
              <td class="mono small">({{ receipt.area.x }}, {{ receipt.area.y }}) r={{ receipt.area.r }}</td>
              <td>
                <el-tag
                  :type="receipt.status === '已生效' ? 'success' : receipt.status === '待生效' ? 'warning' : 'info'"
                  effect="plain"
                  size="small"
                >{{ receipt.status }}</el-tag>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>改线批次</h3>
          <el-switch v-model="simulateFailure" active-text="模拟回执失败（重试演示）" inline-prompt />
        </div>
        <div class="batch-list">
          <div v-for="batch in store.batches" :key="batch.id" class="batch-item" :class="{ failed: batch.status === '部分失败' }">
            <div class="batch-head">
              <strong>{{ batch.id }}</strong>
              <el-tag :type="batch.status === '已完成' ? 'success' : 'warning'" effect="plain" size="small">{{ batch.status }}</el-tag>
            </div>
            <p>{{ batch.receiptIds.length }} 份回执 · 重试 {{ batch.retries }} 次 · {{ new Date(batch.createdAt).toLocaleString('zh-CN') }}</p>
            <p v-if="batch.note" class="batch-note">{{ batch.note }}</p>
            <el-button v-if="batch.status === '部分失败'" size="small" type="warning" plain @click="retry(batch.id)">按原批次重试</el-button>
          </div>
          <el-empty v-if="!store.batches.length" description="暂无批次，提交回执后生成" :image-size="46" />
        </div>
      </section>
    </div>

    <section class="panel route-result">
      <div class="panel-head">
        <h3>路线重算结果</h3>
        <span class="muted">封闭区 {{ store.activeClosures.length }} 处 · 正常 {{ normalCues.length }} · 改线 {{ reroutedCues.length }} · 失败 {{ store.blockedCues.length }}</span>
      </div>
      <table class="receipt-table">
        <thead>
          <tr>
            <th>提示</th>
            <th>状态</th>
            <th>路线节点</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cue in store.cues" :key="cue.id">
            <td><strong>{{ cue.id }}</strong> · {{ cue.title }}</td>
            <td>
              <el-tag
                :type="cue.routeStatus === 'rerouted' ? 'warning' : cue.routeStatus === 'blocked' ? 'danger' : 'info'"
                effect="plain"
                size="small"
              >
                {{ cue.routeStatus === 'rerouted' ? '已改线' : cue.routeStatus === 'blocked' ? '改线失败 · 已保留原路线' : '正常' }}
              </el-tag>
            </td>
            <td class="mono small">{{ routeSummary(cue.id) }}</td>
            <td class="small">{{ cue.blockReason ?? '场馆版本 v' + cue.venueVersion }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel review-panel">
      <div class="panel-head">
        <h3>并发提交复核队列</h3>
        <span class="muted">同一提示先到生效，后到留待复核</span>
      </div>
      <div class="review-sim">
        <span>模拟提示</span>
        <el-select v-model="concurrentCueId" size="small" style="width: 240px">
          <el-option v-for="cue in store.cues" :key="cue.id" :label="`${cue.id} · ${cue.title}`" :value="cue.id" />
        </el-select>
        <el-button size="small" @click="simulateConcurrentSubmit">两个调度员同时提交</el-button>
      </div>
      <div class="review-list">
        <div v-for="review in store.reviewQueue" :key="review.id" class="review-item" :class="{ done: review.status !== '待复核' }">
          <div class="review-head">
            <strong>{{ review.cueId }} · {{ review.cueTitle }}</strong>
            <el-tag
              :type="review.status === '待复核' ? 'warning' : review.status === '已采纳' ? 'success' : 'info'"
              effect="plain"
              size="small"
            >{{ review.status }}</el-tag>
          </div>
          <p>{{ review.submitter }} · {{ review.submittedAt }} · 基于 v{{ review.baseVersion }}</p>
          <p class="review-reason">{{ review.reason }}</p>
          <div v-if="review.status === '待复核'" class="review-actions">
            <el-button size="small" type="primary" @click="resolve(review.id, true)">采纳并更新</el-button>
            <el-button size="small" @click="resolve(review.id, false)">驳回</el-button>
          </div>
        </div>
        <el-empty v-if="!store.reviewQueue.length" description="暂无复核事项" :image-size="46" />
      </div>
    </section>
  </section>
</template>

<style scoped>
.batches-page {
  background: #eef2f4;
}

.block-alert {
  margin-bottom: 14px;
}

.block-list {
  margin: 6px 0 0;
  padding-left: 18px;
}

.block-list li {
  margin: 2px 0;
}

.teal {
  color: #2f8580 !important;
}

.red {
  color: #bd4b3f !important;
}

.batches-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.receipt-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 15px;
  border-bottom: 1px solid #e6ebee;
}

.receipt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.receipt-table th {
  padding: 9px 12px;
  color: #fff;
  text-align: left;
  background: #1c4251;
}

.receipt-table td {
  padding: 9px 12px;
  border-bottom: 1px solid #edf0f2;
}

.mono {
  font-family: ui-monospace, monospace;
}

.small {
  color: #697684;
  font-size: 11px;
}

.batch-list {
  display: grid;
  gap: 8px;
  padding: 12px 15px;
}

.batch-item {
  padding: 11px 12px;
  border: 1px solid #dce3e7;
  border-radius: 7px;
}

.batch-item.failed {
  border-color: #d8912d;
  background: #fff8e8;
}

.batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.batch-item p {
  margin: 6px 0 0;
  color: #697684;
  font-size: 12px;
}

.batch-note {
  color: #b0701f !important;
}

.route-result {
  margin-bottom: 12px;
}

.review-panel {
  margin-bottom: 12px;
}

.review-sim {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 15px;
  border-bottom: 1px solid #e6ebee;
  color: #5d6b78;
  font-size: 12px;
}

.review-list {
  display: grid;
  gap: 8px;
  padding: 12px 15px;
}

.review-item {
  padding: 11px 12px;
  border: 1px solid #dce3e7;
  border-radius: 7px;
}

.review-item.done {
  opacity: 0.7;
}

.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.review-item p {
  margin: 5px 0 0;
  color: #697684;
  font-size: 12px;
}

.review-reason {
  color: #b0701f !important;
}

.review-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 1080px) {
  .batches-grid {
    grid-template-columns: 1fr;
  }
}
</style>
