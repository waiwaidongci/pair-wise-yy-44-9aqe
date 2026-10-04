<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useQuery } from '@tanstack/vue-query'
import axios from 'axios'
import { useWorkshopStore } from '../stores/workshop'
import {
  CONCURRENT_WINDOW_MS,
  normalizeReceipt,
  seedReceipts,
  type VenueReceipt,
} from '../reroute/domain'

type SelectableReceipt = VenueReceipt & { key: string }

const store = useWorkshopStore()

const { data: venueReceipts } = useQuery({
  queryKey: ['venue-receipts'],
  queryFn: async (): Promise<VenueReceipt[]> => (await axios.get('/api/venue-receipts')).data,
  enabled: import.meta.env.DEV,
  initialData: seedReceipts,
})

// ---- 回执选择与预检 ----
const selectedOrderKeys = ref<string[]>([])
const receiptKey = (receipt: VenueReceipt, index: number) => `${index}-${receipt.orderNo}-${receipt.venueVersion ?? 'legacy'}`
const selectableReceipts = computed(() => venueReceipts.value.map((receipt, index) => ({ ...receipt, key: receiptKey(receipt, index) })))
const chosenReceipts = computed(() =>
  selectableReceipts.value.filter((receipt) => selectedOrderKeys.value.includes(receipt.key)),
)
const preview = computed(() => store.previewReceipts(chosenReceipts.value))

function pickScenario(keys: string[]) {
  selectedOrderKeys.value = keys
}

function onSelectionChange(rows: SelectableReceipt[]) {
  selectedOrderKeys.value = rows.map((item) => item.key)
}

function connectBatch() {
  if (!chosenReceipts.value.length) {
    ElMessage.warning('请先勾选要接入的场馆回执')
    return
  }
  const batch = store.ingestReceipts(chosenReceipts.value.map(({ key: _key, ...receipt }) => receipt))
  const rerouted = batch.items.filter((item) => item.status === '已改线').length
  const blocked = batch.items.filter((item) => item.status === '待人工处理').length
  ElMessage.success(`批次 ${batch.id} 已生成：${rerouted} 条已改线，${blocked} 条算不出路线`)
}

async function submitBatch(batchId: string) {
  try {
    await store.commitBatch(batchId)
    ElMessage.success(`批次 ${batchId} 已向场馆生效`)
  } catch {
    ElMessage.error('回执提交失败，原批次保留，可按原批次重试')
  }
}

async function retryBatch(batchId: string) {
  try {
    await store.retryBatch(batchId)
    ElMessage.success(`批次 ${batchId} 重试成功（同批次号幂等）`)
  } catch {
    ElMessage.error('重试仍失败，请检查回执通道后再次按原批次重试')
  }
}

function batchItemOf(cueId: string) {
  for (let i = store.batches.length - 1; i >= 0; i -= 1) {
    const found = store.batches[i].items.find((item) => item.cueId === cueId)
    if (found) return found
  }
  return undefined
}

// ---- 打印放行 ----
async function releaseCue(cueId: string) {
  try {
    const { value } = await ElMessageBox.prompt('原路线仍穿过封闭区，请填写人工放行依据（将随清单留痕）', '打印前人工放行', {
      confirmButtonText: '放行打印',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：场馆口头确认该区域装台完成',
    })
    store.releaseForPrint(cueId, value || '人工放行（未填写依据）')
    ElMessage.success(`${cueId} 已人工放行，可进入打印清单`)
  } catch {
    /* 取消放行 */
  }
}

// ---- 调度员并发提交同一提示 ----
const submitCueId = ref('C-01')
const submitTime = ref('00:05:00')
const submitNote = ref('装台当日时间微调')
const dispatcherA = ref('张调度（前场）')
const dispatcherB = ref('李调度（后场）')

function submit(dispatcher: string) {
  const result = store.submitCueChange(submitCueId.value, dispatcher, { time: submitTime.value, note: submitNote.value })
  if (result.applied) {
    ElMessage.success(`${dispatcher} 的提交先到，已直接生效`)
  } else {
    ElMessage.warning(`${dispatcher} 的提交后到，已留待复核（${CONCURRENT_WINDOW_MS / 1000} 秒窗口内）`)
  }
}

const reviewTagType = (status: string) => (status === '已采纳' ? 'success' : status === '已驳回' ? 'info' : 'warning')

// ---- 缩略舞台图 ----
const blockedSet = computed(() => new Set(store.printBlockedCues.map((cue) => cue.id)))
const registryEntries = computed(() =>
  Object.values(store.receiptRegistry).sort((a, b) => a.orderNo.localeCompare(b.orderNo) || b.venueVersion - a.venueVersion),
)
</script>

<template>
  <section class="page reroute-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">REROUTE / 改线批次</p>
        <h1>场馆回执改线批次</h1>
        <p class="muted">回执按单号与版本接入，受影响提示自动重算路线；算不出来保留原路线并挡住打印。</p>
      </div>
      <div class="actions">
        <el-tag :type="store.channelFailing ? 'danger' : 'success'" effect="plain">
          回执通道{{ store.channelFailing ? '故障（模拟）' : '正常' }}
        </el-tag>
        <el-button :type="store.channelFailing ? 'success' : 'danger'" plain @click="store.setChannelFailing(!store.channelFailing)">
          {{ store.channelFailing ? '恢复通道' : '模拟通道失败' }}
        </el-button>
        <el-button type="primary" @click="$router.push('/print')">前往打印中心</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.printBlockedCues.length"
      class="block-alert"
      type="error"
      show-icon
      :closable="false"
      :title="`${store.printBlockedCues.length} 条提示仍穿过封闭区，执行清单打印已被挡住`"
      description="请等待场馆解除回执重新接入，或由舞台监督在下方逐条人工放行。"
    >
      <el-button size="small" type="danger" plain @click="$router.push('/print')">查看打印拦截</el-button>
    </el-alert>

    <div class="reroute-grid">
      <div class="left-col">
        <!-- 场馆回执收件箱 -->
        <section class="panel">
          <div class="panel-head">
            <h3>场馆回执收件箱</h3>
            <span class="muted">按单号 + 版本识别 · 旧版本不能覆盖较新封闭范围</span>
          </div>
          <div class="quick-row">
            <el-button size="small" @click="pickScenario(selectableReceipts.map((item) => item.key))">全选（含旧版/解除）</el-button>
            <el-button
              size="small"
              @click="pickScenario(selectableReceipts.filter((item) => item.orderNo === 'V-SH-1021' && item.venueVersion === 2).map((item) => item.key))"
            >
              只接 1021 解除
            </el-button>
            <el-button size="small" @click="selectedOrderKeys = []">清空</el-button>
          </div>
          <el-table :data="selectableReceipts" size="small" @selection-change="onSelectionChange">
            <el-table-column type="selection" width="42" :reserve-selection="true" />
            <el-table-column label="单号" prop="orderNo" width="118" />
            <el-table-column label="版本" width="78">
              <template #default="{ row }">
                <el-tag v-if="row.venueVersion" size="small" type="primary" plain>v{{ row.venueVersion }}</el-tag>
                <el-tag v-else size="small" type="warning">无版本·补v1</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="68">
              <template #default="{ row }">
                <el-tag size="small" :type="row.type === '封闭' ? 'danger' : 'success'" plain>{{ row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="封闭 / 解除区域">
              <template #default="{ row }">{{ row.zones.map((zone: { label: string }) => zone.label).join('、') }}</template>
            </el-table-column>
            <el-table-column label="签发" prop="issuedAt" width="120" />
          </el-table>
          <div class="connect-bar">
            <span class="muted">
              已选 {{ chosenReceipts.length }} 张：新收 {{ preview.accepted.length }}，
              旧版/重复拒收 {{ preview.rejected.length }}
            </span>
            <el-button type="primary" :disabled="!chosenReceipts.length" @click="connectBatch">接入为改线批次</el-button>
          </div>
          <div v-if="chosenReceipts.length" class="preview-list">
            <div v-for="record in preview.accepted" :key="`a-${record.orderNo}-${record.version}`" class="preview-record ok">
              <strong>{{ record.orderNo }} v{{ record.version }}</strong>
              <span>{{ record.type }} · {{ record.reason }}</span>
              <el-tag v-if="record.legacy" size="small" type="warning" plain>旧数据补首版</el-tag>
            </div>
            <div v-for="record in preview.rejected" :key="`r-${record.orderNo}-${record.version}-${record.issuedAt}`" class="preview-record stale">
              <strong>{{ record.orderNo }} v{{ record.version }}</strong>
              <span>{{ record.reason }}</span>
            </div>
          </div>
        </section>

        <!-- 批次 -->
        <section v-for="batch in [...store.batches].reverse()" :key="batch.id" class="panel batch-panel">
          <div class="panel-head batch-head">
            <div>
              <h3>批次 {{ batch.id }}</h3>
              <span class="muted">
                {{ new Date(batch.createdAt).toLocaleString('zh-CN') }} · 回执 {{ batch.receipts.length }} 张 ·
                尝试 {{ batch.attempts }} 次
              </span>
            </div>
            <el-tag :type="batch.status === '已生效' ? 'success' : batch.status === '提交失败' ? 'danger' : 'info'" effect="dark">
              {{ batch.status }}
            </el-tag>
          </div>

          <div class="batch-records">
            <el-tag
              v-for="record in batch.records"
              :key="`${record.orderNo}-${record.version}`"
              size="small"
              :type="record.legacy ? 'warning' : 'success'"
              class="record-tag"
            >
              收录 {{ record.orderNo }} v{{ record.version }}{{ record.legacy ? '（补首版）' : '' }}
            </el-tag>
            <el-tag
              v-for="record in batch.rejectedRecords"
              :key="`${record.orderNo}-${record.version}-${record.issuedAt}`"
              size="small"
              type="info"
              class="record-tag"
            >
              拒收 {{ record.orderNo }} v{{ record.version }}（{{ record.stale ? '旧版本' : '无效' }}）
            </el-tag>
          </div>

          <el-table :data="batch.items" size="small" class="item-table">
            <el-table-column label="提示" width="120">
              <template #default="{ row }">{{ row.cueId }}</template>
            </el-table-column>
            <el-table-column label="标题" prop="title" />
            <el-table-column label="结果" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === '已改线' ? 'success' : 'danger'">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="说明" width="220">
              <template #default="{ row }">
                <span v-if="row.status === '已改线'">新路线 {{ row.newRoute.length }} 节点，丢弃区内节点 {{ row.droppedWaypoints.length }} 个</span>
                <span v-else class="danger-text">{{ row.reason }}</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-if="!batch.items.length" class="muted empty-note">本批回执区域与所有现行路线不相交，无提示需要改线。</p>

          <div class="batch-actions">
            <template v-if="batch.status === '已生效'">
              <el-tag type="success" plain>已于 {{ new Date(batch.appliedAt ?? '').toLocaleTimeString('zh-CN') }} 生效</el-tag>
            </template>
            <template v-else-if="batch.status === '提交失败'">
              <el-tag type="danger" plain>失败原因：{{ batch.lastError }}</el-tag>
              <el-button type="danger" :loading="store.submittingBatch" @click="retryBatch(batch.id)">按原批次重试（{{ batch.id }}）</el-button>
            </template>
            <template v-else>
              <el-button type="primary" :loading="store.submittingBatch" @click="submitBatch(batch.id)">提交批次至场馆</el-button>
            </template>
          </div>
        </section>
      </div>

      <aside class="right-col">
        <!-- 当前生效封闭区 -->
        <section class="panel">
          <div class="panel-head">
            <h3>版本表 · 生效封闭区</h3>
          </div>
          <svg class="mini-stage" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect width="100" height="100" fill="#eef1eb" />
            <rect v-for="zone in store.activeZones" :key="`${zone.orderNo}-${zone.id}`" :x="zone.x" :y="zone.y" :width="zone.w" :height="zone.h" class="closed-zone" />
            <template v-for="cue in store.cues" :key="cue.id">
              <polyline
                v-if="cue.route.length > 1"
                :points="cue.route.map((point) => `${point.x},${point.y}`).join(' ')"
                :class="['mini-route', { blocked: blockedSet.has(cue.id), rerouted: cue.routeMeta?.source === '自动改线' }]"
              />
            </template>
          </svg>
          <div class="registry-list">
            <div v-for="receipt in registryEntries" :key="receipt.orderNo" class="registry-row">
              <div>
                <strong>{{ receipt.orderNo }}</strong>
                <el-tag size="small" :type="receipt.type === '封闭' ? 'danger' : 'success'" plain class="v-tag">v{{ receipt.venueVersion }} {{ receipt.type }}</el-tag>
                <el-tag v-if="receipt.legacy" size="small" type="warning" plain>旧数据补首版</el-tag>
              </div>
              <small>{{ receipt.zones.map((zone) => zone.label).join('、') }}</small>
            </div>
            <el-empty v-if="!registryEntries.length" description="尚未登记任何回执" :image-size="50" />
          </div>
        </section>

        <!-- 打印拦截 -->
        <section class="panel">
          <div class="panel-head">
            <h3>打印拦截与人工放行</h3>
            <el-tag :type="store.printBlockedCues.length ? 'danger' : 'success'" plain>
              {{ store.printBlockedCues.length ? `挡住 ${store.printBlockedCues.length} 条` : '清单可打印' }}
            </el-tag>
          </div>
          <div v-for="cue in store.printBlockedCues" :key="cue.id" class="blocked-row">
            <div>
              <strong>{{ cue.id }} · {{ cue.title }}</strong>
              <small>{{ batchItemOf(cue.id)?.reason ?? '路线与当前生效封闭区相交' }}</small>
            </div>
            <el-button size="small" type="warning" plain @click="releaseCue(cue.id)">人工放行</el-button>
          </div>
          <div v-for="overrideItem in store.printOverrides" :key="overrideItem.cueId" class="override-row">
            <div>
              <strong>{{ overrideItem.cueId }} 已人工放行</strong>
              <small>{{ overrideItem.by }} · {{ overrideItem.reason }}</small>
            </div>
            <el-button size="small" link type="danger" @click="store.revokeOverride(overrideItem.cueId)">撤销</el-button>
          </div>
          <el-empty v-if="!store.printBlockedCues.length && !store.printOverrides.length" description="没有被挡住的提示" :image-size="50" />
        </section>

        <!-- 并发提交 -->
        <section class="panel">
          <div class="panel-head">
            <h3>调度员提交 · 同提示并发</h3>
            <span class="muted">{{ CONCURRENT_WINDOW_MS / 1000 }} 秒窗口内先到生效</span>
          </div>
          <el-form label-position="top" size="small">
            <el-form-item label="同一提示">
              <el-select v-model="submitCueId">
                <el-option v-for="cue in store.cues" :key="cue.id" :label="`${cue.id} · ${cue.title}`" :value="cue.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间码 / 说明（两人提交内容相同）">
              <el-input v-model="submitTime" />
              <el-input v-model="submitNote" class="note-input" />
            </el-form-item>
          </el-form>
          <div class="dispatcher-row">
            <el-button size="small" type="primary" @click="submit(dispatcherA)">① {{ dispatcherA }} 提交</el-button>
            <el-button size="small" type="primary" plain @click="submit(dispatcherB)">② {{ dispatcherB }} 提交</el-button>
          </div>
          <div class="review-list">
            <div v-for="request in store.reviewQueue" :key="request.id" class="review-row" :class="request.status">
              <div>
                <strong>{{ request.dispatcher }} → {{ request.cueId }}</strong>
                <small>{{ new Date(request.submittedAt).toLocaleTimeString('zh-CN') }} · {{ request.note }}</small>
                <small class="patch">改为 时间 {{ request.patch.time }}；{{ request.patch.note }}</small>
              </div>
              <template v-if="request.status === '待复核'">
                <el-button size="small" type="primary" plain @click="store.adoptReview(request.id)">采纳</el-button>
                <el-button size="small" @click="store.rejectReview(request.id)">驳回</el-button>
              </template>
              <el-tag v-else size="small" :type="reviewTagType(request.status)" plain>{{ request.status }}</el-tag>
            </div>
            <el-empty v-if="!store.reviewQueue.length" description="暂无并发提交" :image-size="46" />
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.reroute-page {
  background: #eef2f4;
}

.block-alert {
  margin-bottom: 12px;
}

.reroute-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(330px, 0.8fr);
  gap: 14px;
  align-items: start;
}

.left-col,
.right-col {
  display: grid;
  gap: 14px;
}

.quick-row {
  display: flex;
  gap: 8px;
  padding: 0 14px 10px;
}

.connect-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
}

.preview-list {
  display: grid;
  gap: 6px;
  padding: 0 14px 14px;
}

.preview-record {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 12px;
}

.preview-record strong {
  font-family: ui-monospace, monospace;
}

.preview-record.ok {
  background: #f0f8f3;
  border-left: 3px solid #4b9d72;
}

.preview-record.stale {
  background: #f4f6f7;
  border-left: 3px solid #9aa6ad;
  color: #6b7883;
}

.batch-panel {
  padding-bottom: 12px;
}

.batch-head {
  align-items: flex-start;
}

.batch-records {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 10px;
}

.item-table {
  width: calc(100% - 28px);
  margin: 0 14px;
}

.empty-note {
  padding: 10px 14px 0;
}

.danger-text {
  color: #c0492f;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 2px;
}

.mini-stage {
  width: calc(100% - 28px);
  height: 220px;
  margin: 0 14px;
  border: 1px solid #d9e0e3;
  border-radius: 6px;
}

.closed-zone {
  fill: rgb(207 91  63 / 22%);
  stroke: #cf5b3f;
  stroke-width: 0.5;
  stroke-dasharray: 1.5 1;
}

.mini-route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.7;
}

.mini-route.rerouted {
  stroke: #2f8580;
  stroke-width: 0.9;
}

.mini-route.blocked {
  stroke: #cf5b3f;
  stroke-width: 1;
  stroke-dasharray: 2 1.2;
}

.registry-list {
  padding: 10px 14px 14px;
}

.registry-row {
  padding: 8px 2px;
  border-bottom: 1px solid #edf0f2;
}

.registry-row strong {
  margin-right: 6px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.registry-row small {
  display: block;
  margin-top: 3px;
  color: #7c8894;
}

.v-tag {
  margin-right: 4px;
}

.blocked-row,
.override-row,
.review-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid #edf0f2;
}

.blocked-row strong,
.override-row strong,
.review-row strong {
  display: block;
  font-size: 12px;
}

.blocked-row small,
.override-row small,
.review-row small {
  display: block;
  margin-top: 2px;
  color: #7c8894;
  font-size: 11px;
}

.override-row {
  background: #f0f8f3;
}

.review-row.已驳回 {
  opacity: 0.55;
}

.note-input {
  margin-top: 6px;
}

.dispatcher-row {
  display: flex;
  gap: 8px;
  padding: 0 14px 10px;
}

.review-list {
  border-top: 1px solid #e8edf0;
}

.review-row .patch {
  color: #5d6b78;
}

@media (max-width: 1080px) {
  .reroute-grid {
    grid-template-columns: 1fr;
  }
}
</style>
