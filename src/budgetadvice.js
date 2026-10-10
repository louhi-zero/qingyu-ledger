/* v3.4 预算建议（规则引擎）
 *
 * 对标薄荷记账的 BudgetAdviceActivity。区别：轻语不依赖云端/大模型，
 * 用可解释的本地规则生成建议——每条都能追溯到具体数字，用户看得懂也算得清。
 *
 * 设计原则：
 *   1. 纯函数、零依赖（只吃 utils 的日期工具），单测可直接覆盖；
 *   2. 最多返回 4 条，按紧急度排序，避免变成"建议墙"；
 *   3. 每条必须带可执行动作或明确数字，不写"请注意节约"这类废话。
 *
 * 输入：
 *   budget        总预算（0 表示未设置）
 *   spent         本期已支出
 *   income        本期已收入
 *   period        'YYYY-MM' 账期
 *   monthStartDay 账期起始日
 *   today         'YYYY-MM-DD'
 *   cats          [{ id, name, value, budget }] 本期分类支出 + 该分类预算
 */
import { periodBounds, parseD, todayStr, round2 } from './utils.js'

const DAY_MS = 86400000

function diffDays(a, b) {
  return Math.round((parseD(a).getTime() - parseD(b).getTime()) / DAY_MS)
}

/** 账期进度：{ total, elapsed, left, ratio }（天） */
export function periodProgress(period, monthStartDay, today) {
  const [start, end] = periodBounds(period, monthStartDay)
  const total = Math.max(1, diffDays(end, start))
  let elapsed = diffDays(today, start) + 1
  if (elapsed < 0) elapsed = 0
  if (elapsed > total) elapsed = total
  return { total, elapsed, left: total - elapsed, ratio: elapsed / total, start, end }
}

/**
 * 生成预算建议。
 * @returns {Array<{level:'ok'|'warn'|'danger'|'info', icon:string, title:string, text:string}>}
 */
export function buildBudgetAdvice({
  budget = 0, spent = 0, income = 0, period,
  monthStartDay = 1, today = todayStr(), cats = [],
} = {}) {
  const out = []
  const b = Number(budget) || 0
  const sp = round2(Number(spent) || 0)
  const inc = round2(Number(income) || 0)
  const prog = periodProgress(period, monthStartDay, today)
  const isPast = prog.left <= 0

  const push = (level, icon, title, text) => { out.push({ level, icon, title, text }) }

  /* ---- 未设预算：给一个可直接采用的数字 ---- */
  if (b <= 0) {
    if (inc > 0) {
      const low = round2(inc * 0.6)
      const high = round2(inc * 0.8)
      push('info', 'budget', '先设一个月总预算',
        `本期收入 ¥${low.toFixed(0)}~${high.toFixed(0)} 区间较稳妥（收入的 60%~80%）。目前没有上限，超支了也不会提醒。`)
    } else {
      push('info', 'budget', '先设一个月总预算',
        '设定后超支会自动预警，也能看到每天还能花多少。建议从最近一个月的实际支出上浮 10% 起步。')
    }
    if (sp > 0) push('info', 'tag', '支出还没分类', `本期已支出 ¥${sp.toFixed(2)}，给它配个预算就能按分类盯着花。`)
    return out.slice(0, 4)
  }

  const remain = round2(b - sp)
  const pct = Math.round((sp / b) * 100)

  /* ---- 超支 ---- */
  if (remain < 0) {
    const over = Math.abs(remain)
    push('danger', 'warning', `已超支 ¥${over.toFixed(2)}`,
      isPast
        ? `本期已结束，最终超预算 ${pct - 100}%。下期可以把总预算调到 ¥${round2(sp * 1.05).toFixed(0)} 左右，先贴合真实水平再逐步收紧。`
        : `本期还剩 ${prog.left} 天。若继续按当前节奏，期末会超到 ¥${round2(sp / Math.max(prog.ratio, 0.01)).toFixed(2)}。`)
  } else {
    /* ---- 节奏对比（时间进度 vs 花钱进度）---- */
    const drift = prog.ratio - (sp / b)
    if (drift > 0.15) {
      push('ok', 'trendDown', '节奏比时间进度慢',
        `时间过了 ${Math.round(prog.ratio * 100)}%，钱只花了 ${pct}%，保持住。`)
    } else if (drift < -0.15 && !isPast) {
      push('warn', 'fire', '花得比时间进度快',
        `时间过了 ${Math.round(prog.ratio * 100)}%，钱已花掉 ${pct}%。剩下的 ${prog.left} 天建议控制在日均 ¥${round2(remain / Math.max(prog.left, 1)).toFixed(2)} 以内。`)
    }

    /* ---- 预测期末 ---- */
    if (!isPast && prog.ratio > 0.05) {
      const projected = round2(sp / prog.ratio)
      if (projected > b * 1.05) {
        push('warn', 'stats', `预计期末支出 ¥${projected.toFixed(2)}`,
          `按当前节奏会超出预算 ¥${round2(projected - b).toFixed(2)}，接下来 ${prog.left} 天日均需压到 ¥${round2(remain / Math.max(prog.left, 1)).toFixed(2)}。`)
      } else if (projected < b * 0.9) {
        push('ok', 'checkCircle', `预计期末支出 ¥${projected.toFixed(2)}`,
          `低于预算 ¥${round2(b - projected).toFixed(2)}，本期结余空间充足。`)
      }
    }
  }

  /* ---- 分类维度 ---- */
  const overCats = cats
    .filter((c) => Number(c.budget) > 0 && Number(c.value) > Number(c.budget))
    .sort((a, b2) => (b2.value - b2.budget) - (a.value - a.budget))
  if (overCats.length) {
    const top = overCats.slice(0, 2)
    push('danger', 'warning', `${overCats.length} 个分类超支`,
      top.map((c) => `${c.name} 超 ¥${round2(c.value - c.budget).toFixed(2)}`).join('、')
      + (overCats.length > 2 ? ` 等` : '')
      + '。分类预算比总预算更容易定位问题。')
  }

  const noBudgetCats = cats
    .filter((c) => !(Number(c.budget) > 0) && Number(c.value) > 0)
    .sort((a, b2) => b2.value - a.value)
    .slice(0, 2)
  if (!overCats.length && noBudgetCats.length) {
    push('info', 'tag', '这两个分类还没设预算',
      noBudgetCats.map((c) => `${c.name} ¥${round2(c.value).toFixed(2)}`).join('、') + '，补上预算才能按分类预警。')
  }

  /* ---- 兜底：剩余日均 ---- */
  if (out.length === 0 && !isPast && remain > 0) {
    push('ok', 'checkCircle', `日均可用 ¥${round2(remain / Math.max(prog.left, 1)).toFixed(2)}`,
      `剩余 ¥${remain.toFixed(2)} / 剩余 ${prog.left} 天，节奏正常。`)
  }
  if (out.length === 0 && isPast) {
    push('ok', 'checkCircle', '本期收尾良好',
      `预算 ¥${b.toFixed(2)}，实支 ¥${sp.toFixed(2)}，${remain >= 0 ? `结余 ¥${remain.toFixed(2)}` : '已超支'}。`)
  }

  return out.slice(0, 4)
}
