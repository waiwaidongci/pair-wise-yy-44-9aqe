<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'

const store = useWorkshopStore()
const includeNotes = ref(true)
const includeRoutes = ref(true)
const includeComments = ref(false)

const printableCues = computed(() =>
  [...store.cues]
    .filter((cue) => !store.printBlockedCues.some((blocked) => blocked.id === cue.id))
    .sort((a, b) => a.time.localeCompare(b.time)),
)
const printBlocked = computed(() => [...store.printBlockedCues].sort((a, b) => a.time.localeCompare(b.time)))
const overrideOf = (cueId: string) => store.printOverrides.find((item) => item.cueId === cueId)

function print() {
  if (printBlocked.value.length) {
    ElMessage.error(`有 ${printBlocked.value.length} 条提示仍穿过封闭区，打印已挡住；人工放行或接入解除回执后再打印`)
    return
  }
  window.print()
}

async function releaseCue(cueId: string) {
  try {
    const { value } = await ElMessageBox.prompt('原路线仍穿过封闭区，请填写人工放行依据（将随清单留痕）', '打印前人工放行', {
      confirmButtonText: '放行打印',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：场馆现场口头确认装台完成',
    })
    store.releaseForPrint(cueId, value || '人工放行（未填写依据）')
    ElMessage.success(`${cueId} 已放行，纳入可打印清单`)
  } catch {
    /* 取消放行 */
  }
}

function exportCsv() {
  if (printBlocked.value.length) {
    ElMessage.error(`清单不完整：${printBlocked.value.map((cue) => cue.id).join('、')} 仍被挡住，已禁止导出`)
    return
  }
  const rows = [
    ['编号', '时间码', '场景', '提示', '部门', '责任', '路线节点', '状态'],
    ...printableCues.value.map((cue) => [
      cue.id,
      cue.time,
      `${cue.act}/${cue.scene}`,
      cue.title,
      cue.department,
      cue.owner,
      cue.route.map((point) => `${point.x},${point.y}`).join(' > '),
      cue.status,
    ]),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `潮汐来信-走位表-${store.revision}.csv`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('走位表已导出')
}
</script>

<template>
  <section class="page print-page">
    <div class="page-head no-print">
      <div>
        <p class="eyebrow">PRINT / 演出文档</p>
        <h1>走位表与执行清单</h1>
        <p class="muted">打印版仅包含已选信息，固定 A4 横向布局，适合舞台监督工作台使用。</p>
      </div>
      <div class="actions">
        <el-button @click="exportCsv">导出 CSV</el-button>
        <el-button :type="printBlocked.length ? 'danger' : 'primary'" @click="print">
          {{ printBlocked.length ? '打印已挡住' : '打印 / 导出 PDF' }}
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="printBlocked.length"
      class="print-gate no-print"
      type="error"
      show-icon
      :closable="false"
      :title="`${printBlocked.length} 条受影响提示算不出绕行路线，已从清单剔除并挡住打印`"
    >
      <template #default>
        <p class="gate-detail">原路线已保留；请在改线批次中接入较新的解除回执重新计算，或在此逐条人工放行。</p>
        <div v-for="cue in printBlocked" :key="cue.id" class="gate-row">
          <div>
            <strong>{{ cue.id }} · {{ cue.title }}</strong>
            <small>{{ cue.time }} · {{ cue.act }} / {{ cue.scene }}</small>
          </div>
          <el-button size="small" type="warning" plain @click="releaseCue(cue.id)">人工放行</el-button>
        </div>
      </template>
    </el-alert>
    <el-alert
      v-else-if="store.printOverrides.length"
      class="print-gate no-print"
      type="warning"
      show-icon
      :closable="false"
      :title="`已人工放行 ${store.printOverrides.length} 条提示，清单可打印（留痕）`"
    >
      <div v-for="item in store.printOverrides" :key="item.cueId" class="gate-row override">
        <div>
          <strong>{{ item.cueId }} · {{ item.by }}</strong>
          <small>{{ item.reason }} · {{ new Date(item.at).toLocaleString('zh-CN') }}</small>
        </div>
        <el-button size="small" link type="danger" @click="store.revokeOverride(item.cueId)">撤销放行</el-button>
      </div>
    </el-alert>

    <div class="print-options panel no-print">
      <strong>文档内容</strong>
      <el-checkbox v-model="includeNotes">执行说明</el-checkbox>
      <el-checkbox v-model="includeRoutes">路线坐标</el-checkbox>
      <el-checkbox v-model="includeComments">未解决留言</el-checkbox>
      <span class="print-revision">
        版本 {{ store.revision }} · 生效封闭区 {{ store.activeZones.length }} 处 ·
        清单收录 {{ printableCues.length }}/{{ store.cues.length }} 条
      </span>
    </div>

    <article class="print-sheet">
      <header class="sheet-head">
        <div>
          <span>远岸剧团 · STAGE MANAGEMENT</span>
          <h2>《潮汐来信》执行清单</h2>
        </div>
        <dl>
          <div><dt>排练日</dt><dd>2026-10-08</dd></div>
          <div><dt>版本</dt><dd>{{ store.revision }}</dd></div>
          <div><dt>场地</dt><dd>上海大剧院 · 大剧场</dd></div>
        </dl>
      </header>

      <table>
        <thead>
          <tr>
            <th>时间码</th>
            <th>幕 / 场</th>
            <th>执行提示</th>
            <th>部门 / 责任</th>
            <th>时长</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cue in printableCues" :key="cue.id">
            <td class="mono">{{ cue.time }}</td>
            <td>{{ cue.act }} / {{ cue.scene }}</td>
            <td>
              <strong>{{ cue.id }} · {{ cue.title }}</strong>
              <p v-if="includeNotes">{{ cue.note }}</p>
              <small v-if="includeRoutes">路线：{{ cue.route.map((point, index) => `${index + 1}. ${point.x}/${point.y}`).join(' → ') }}</small>
              <em v-if="cue.routeMeta?.source === '自动改线'" class="reroute-note">已按场馆回执自动改线（{{ cue.routeMeta.batchId }}）</em>
              <em v-if="overrideOf(cue.id)" class="override-note">人工放行：{{ overrideOf(cue.id)?.reason }}</em>
              <em v-if="includeComments && cue.comments.length">{{ cue.comments.filter((item) => !item.resolved).length }} 条未解决留言</em>
            </td>
            <td>{{ cue.department }}<br /><small>{{ cue.owner }}</small></td>
            <td>{{ cue.duration }} 秒</td>
            <td>{{ cue.status }}</td>
          </tr>
        </tbody>
      </table>

      <footer class="sheet-foot">
        <span>舞台监督：________________</span>
        <span>技术总监：________________</span>
        <span>制作人：________________</span>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.print-page {
  background: #e8ecee;
}

.print-gate {
  margin-bottom: 14px;
  align-items: flex-start;
}

.gate-detail {
  margin: 0 0 8px;
  font-size: 12px;
  color: #6b5b58;
}

.gate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px dashed rgb(207 91 63 / 35%);
}

.gate-row.override {
  border-top-color: rgb(184 134 43 / 35%);
}

.gate-row strong,
.gate-row small {
  display: block;
}

.gate-row small {
  color: #8a6f5f;
  font-size: 11px;
}

.reroute-note {
  color: #2f7d5a !important;
}

.override-note {
  color: #a8711c !important;
}

.print-options {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 14px;
  padding: 12px 15px;
}

.print-revision {
  margin-left: auto;
  color: #74818c;
  font-size: 12px;
}

.print-sheet {
  max-width: 1180px;
  min-height: 600px;
  margin: 0 auto;
  padding: 34px;
  background: #fff;
  box-shadow: 0 12px 34px rgb(35 54 65 / 12%);
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 3px solid #173846;
}

.sheet-head span {
  color: #697985;
  font-size: 10px;
  letter-spacing: 0.15em;
}

.sheet-head h2 {
  margin: 8px 0 0;
  font-size: 25px;
}

.sheet-head dl {
  display: flex;
  gap: 22px;
  margin: 0;
}

.sheet-head dt {
  color: #818c95;
  font-size: 10px;
}

.sheet-head dd {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 700;
}

table {
  width: 100%;
  margin-top: 20px;
  border-collapse: collapse;
  font-size: 12px;
}

th {
  padding: 10px 8px;
  color: #fff;
  text-align: left;
  background: #1c4251;
}

td {
  padding: 11px 8px;
  border-bottom: 1px solid #dfe5e8;
  vertical-align: top;
}

td strong,
td small,
td em {
  display: block;
}

td p {
  margin: 5px 0 0;
  color: #56636d;
  line-height: 1.5;
}

td small {
  margin-top: 6px;
  color: #7e8991;
}

td em {
  margin-top: 5px;
  color: #b05a2b;
  font-style: normal;
}

.mono {
  color: #1d7371;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.sheet-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 48px;
  padding-top: 14px;
  border-top: 1px solid #dce2e5;
  color: #69757e;
  font-size: 11px;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 12mm;
  }

  .no-print {
    display: none !important;
  }

  .print-page {
    padding: 0;
    background: #fff;
  }

  .print-sheet {
    max-width: none;
    padding: 0;
    box-shadow: none;
  }

  th {
    color: #111;
    background: #e8ecee;
  }
}

@media (max-width: 760px) {
  .print-options {
    align-items: flex-start;
    flex-direction: column;
  }

  .print-revision {
    margin-left: 0;
  }

  .print-sheet {
    overflow-x: auto;
    padding: 18px;
  }

  .sheet-head {
    flex-direction: column;
  }

  .sheet-head dl {
    flex-wrap: wrap;
  }
}
</style>
