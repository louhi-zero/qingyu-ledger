// ============ 通用工具 ============

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
export const pad2 = (n) => String(n).padStart(2, '0')

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function fmt(n, digits = 2) {
  const v = round2(n)
  const neg = v < 0
  const s = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (neg ? '-' : '') + s
}
export const fmt0 = (n) => fmt(n, 0)

export const todayStr = () => fmtD(new Date())
export const nowTime = () => {
  const d = new Date()
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export function fmtD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export function parseD(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDays(s, n) {
  const d = parseD(s)
  d.setDate(d.getDate() + n)
  return fmtD(d)
}
export const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
export const weekdayOf = (s) => '星期' + WEEK_CN[parseD(s).getDay()]

// ---------- 账期（支持每月起始日） ----------
// period key 'YYYY-MM'
export function periodOf(ds, sd = 1) {
  const [y, m, d] = ds.split('-').map(Number)
  if (d < sd) {
    const pm = m - 1
    return pm === 0 ? `${y - 1}-12` : `${y}-${pad2(pm)}`
  }
  return `${y}-${pad2(m)}`
}
export function periodBounds(p, sd = 1) {
  const [y, m] = p.split('-').map(Number)
  const start = new Date(y, m - 1, sd)
  const end = new Date(y, m, sd) // 排他
  return [fmtD(start), fmtD(end)]
}
export function periodAdd(p, delta, sd = 1) {
  const [y, m] = p.split('-').map(Number)
  const start = new Date(y, m - 1, sd)
  start.setMonth(start.getMonth() + delta)
  return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`
}
export function periodLabel(p) {
  const [y, m] = p.split('-').map(Number)
  return `${y}年${m}月`
}
export function currentPeriod(sd = 1) {
  return periodOf(todayStr(), sd)
}
// 年度
export function yearOf(ds, sd = 1) { return periodOf(ds, sd).slice(0, 4) }
export function yearBounds(y, sd = 1) {
  return [`${y}-01-${pad2(sd)}`, `${Number(y) + 1}-01-${pad2(sd)}`]
}
// 周（周一起始）
export function weekKey(ds) {
  const d = parseD(ds)
  const diff = (d.getDay() + 6) % 7
  return addDays(ds, -diff)
}
export function weekDays(wk) {
  return Array.from({ length: 7 }, (_, i) => addDays(wk, i))
}
export function weekLabel(wk) {
  const a = wk.slice(5).replace('-', '月')
  const b = addDays(wk, 6).slice(5).replace('-', '月')
  return `${a}日 - ${b}日`
}

// ---------- 分类/账户查找 ----------
export function findCat(categories, id) {
  for (const c of categories) {
    if (c.id === id) return { cat: c, sub: null }
    const sub = (c.children || []).find((s) => s.id === id)
    if (sub) return { cat: c, sub }
  }
  return null
}
export function catInfo(state, tx) {
  if (tx.type === 'transfer') return { icon: "svg:transfer", name: '转账', color: '#13b5a1', main: '转账' }
  const list = tx.type === 'income' ? state.categories.income : state.categories.expense
  const f = findCat(list, tx.categoryId)
  if (!f) return { icon: "svg:question", name: '未分类', color: '#9aa1af', main: '未分类' }
  return {
    icon: (f.sub && f.sub.icon) || f.cat.icon,
    name: f.sub ? f.sub.name : f.cat.name,
    color: f.cat.color,
    main: f.cat.name,
  }
}
export function accountById(state, id) {
  return state.accounts.find((a) => a.id === id)
}
export function accountName(state, id) {
  const a = accountById(state, id)
  return a ? a.name : '未指定账户'
}

// ---------- 账单选择 ----------
export function txsOfLedger(state, ledgerId) {
  const lid = ledgerId || state.currentLedgerId
  // v1.4：软删（回收站）行不参与一切统计与列表
  return state.transactions.filter((t) => t.ledgerId === lid && !t.deletedAt)
}
export function txsInRange(txs, start, end) {
  // end 排他
  return txs.filter((t) => t.date >= start && t.date < end)
}
export function txsOfPeriod(state, period, opts = {}) {
  const sd = state.settings.monthStartDay || 1
  const [s, e] = periodBounds(period, sd)
  let list = txsInRange(txsOfLedger(state), s, e)
  if (opts.type) list = list.filter((t) => t.type === opts.type)
  return list
}
export function txsOfWeek(state, wk) {
  return txsInRange(txsOfLedger(state), wk, addDays(wk, 7))
}
export function txsOfYear(state, year) {
  const sd = state.settings.monthStartDay || 1
  const [s, e] = yearBounds(year, sd)
  return txsInRange(txsOfLedger(state), s, e)
}
export function sumBy(txs, type) {
  return round2(txs.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0))
}
export function txHash(t) {
  return hashStr(`${t.date}|${t.time}|${t.type}|${t.amount}|${t.note || ''}`)
}
export function hashStr(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ---------- 账户余额 ----------
export function accountBalance(state, accId, ledgerId) {
  const acc = accountById(state, accId)
  if (!acc) return 0
  let bal = Number(acc.initial || 0)
  for (const t of state.transactions) {
    if (t.deletedAt) continue // v1.4 软删行不参与余额
    if (ledgerId && t.ledgerId !== ledgerId) continue
    if (t.type === 'income' && t.accountId === accId) bal += Number(t.amount)
    if (t.type === 'expense' && t.accountId === accId) bal -= Number(t.amount)
    if (t.type === 'transfer') {
      if (t.accountId === accId) bal -= Number(t.amount)
      if (t.toAccountId === accId) bal += Number(t.amount)
    }
  }
  return round2(bal)
}
export function netWorth(state) {
  let asset = 0, debt = 0
  for (const a of state.accounts) {
    // v1.3：外币账户按汇率折算为 CNY 参与合计（仅汇总层折算）
    const b = toBase(state, accountBalance(state, a.id), a.currency)
    if (b >= 0) asset += b
    else debt += -b
  }
  return { asset: round2(asset), debt: round2(debt), net: round2(asset - debt) }
}

// ---------- v1.3 多币种（账户币种；仅汇总层折算本位币 CNY） ----------
export function toBase(state, amount, currency) {
  const v = Number(amount) || 0
  const cur = currency || 'CNY'
  if (cur === 'CNY') return round2(v)
  const rate = Number(state?.fxRates?.[cur])
  return round2(v * (Number.isFinite(rate) && rate > 0 ? rate : 1))
}
export function curSym(currency) {
  const cur = currency || 'CNY'
  return cur === 'CNY' ? '¥' : (FX_RATES[cur]?.sym || cur)
}
// 账户个体金额展示：CNY 用 ¥，外币用其符号（如 $100）
export function fmtCur(amount, currency) {
  return `${curSym(currency)}${fmt(amount)}`
}

// ---------- v1.3 信用卡账期 ----------
// 当前账单周期起点（上个账单日，含）；未设置账单日返回 null
export function creditCycleStart(card, today) {
  const bd = Number(card?.billingDay)
  if (!(bd >= 1 && bd <= 28)) return null
  const d = parseD(today)
  const start = d.getDate() >= bd
    ? new Date(d.getFullYear(), d.getMonth(), bd)
    : new Date(d.getFullYear(), d.getMonth() - 1, bd)
  return fmtD(start)
}
// 距最近还款日天数（今天=0，已过则算下月）；未设置返回 null
export function daysToDue(card, today) {
  const dd = Number(card?.dueDay)
  if (!(dd >= 1 && dd <= 28)) return null
  const d = parseD(today)
  const next = d.getDate() > dd
    ? new Date(d.getFullYear(), d.getMonth() + 1, dd)
    : new Date(d.getFullYear(), d.getMonth(), dd)
  return Math.round((next - d) / 86400000)
}
// 本期应还：账单周期内（支出+转出）−（收入+转入还款）
export function creditDue(state, card, today) {
  const start = creditCycleStart(card, today)
  if (!start) return null
  let due = 0
  for (const t of state.transactions) {
    if (t.deletedAt) continue // v1.4 软删行不参与应还
    if (t.date < start || t.date > today) continue
    if ((t.type === 'expense' || t.type === 'transfer') && t.accountId === card.id) due += Number(t.amount)
    else if ((t.type === 'income' || t.type === 'transfer') && t.toAccountId === card.id) due -= Number(t.amount)
  }
  return round2(due)
}

// 等额本息月供（P 本金，annualRate 年利率 %，months 期数）
export function annuityMonthly(P, annualRate, months) {
  const n = Math.round(Number(months))
  const p = Number(P) || 0
  if (p <= 0 || n <= 0) return 0
  const r = (Number(annualRate) || 0) / 100 / 12
  if (r === 0) return round2(p / n)
  const pow = Math.pow(1 + r, n)
  return round2((p * r * pow) / (pow - 1))
}

// ---------- 统计 ----------
export function statByCategory(txs, type, state) {
  const groups = {}
  for (const t of txs) {
    if (t.type !== type) continue
    const info = catInfo(state, t)
    if (!groups[t.categoryId]) {
      groups[t.categoryId] = { id: t.categoryId, name: info.main, icon: info.icon, color: info.color, value: 0, count: 0 }
    }
    groups[t.categoryId].value += Number(t.amount)
    groups[t.categoryId].count++
  }
  return Object.values(groups).map((g) => ({ ...g, value: round2(g.value) })).sort((a, b) => b.value - a.value)
}

// ---------- 记账天数/打卡 ----------
export function bookkeepingDays(state) {
  const set = new Set(txsOfLedger(state).map((t) => t.date))
  return set.size
}
export function streakOf(dates) {
  if (!dates.length) return 0
  const set = new Set(dates)
  let streak = 0
  let cur = todayStr()
  if (!set.has(cur)) cur = addDays(cur, -1) // 今天没打卡则从昨天回溯
  while (set.has(cur)) {
    streak++
    cur = addDays(cur, -1)
  }
  return streak
}

// ---------- 房贷计算 ----------
export function loanCalc({ mode = 'commercial', amount = 0, fund = 0, years = 30, rateC = 3.6, rateF = 2.85, method = 'bx' }) {
  const parts = []
  if (mode !== 'fund' && amount > 0) parts.push({ P: amount, rate: rateC })
  if (mode === 'fund' && fund <= 0) fund = amount // 纯公积金模式复用金额输入
  if (mode !== 'commercial' && fund > 0) parts.push({ P: fund, rate: rateF })
  const n = Math.round(years * 12)
  const months = Array.from({ length: n }, () => ({ principal: 0, interest: 0, payment: 0 }))
  for (const p of parts) {
    const r = p.rate / 100 / 12
    if (method === 'bx') {
      // 等额本息
      const m = r === 0 ? p.P / n : (p.P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
      let remain = p.P
      for (let k = 0; k < n; k++) {
        const interest = remain * r
        const principal = m - interest
        remain -= principal
        months[k].principal += principal
        months[k].interest += interest
        months[k].payment += m
      }
    } else {
      // 等额本金
      const perP = p.P / n
      let remain = p.P
      for (let k = 0; k < n; k++) {
        const interest = (remain * p.rate) / 100 / 12
        remain -= perP
        months[k].principal += perP
        months[k].interest += interest
        months[k].payment += perP + interest
      }
    }
  }
  let acc = 0
  const rows = months.map((m, i) => {
    acc += m.principal
    return { idx: i + 1, ...m, remain: round2(parts.reduce((a, p) => a + p.P, 0) - acc) }
  })
  const totalInterest = round2(rows.reduce((a, m) => a + m.interest, 0))
  const totalPayment = round2(rows.reduce((a, m) => a + m.payment, 0))
  return {
    months: rows,
    firstMonth: round2(rows[0]?.payment || 0),
    lastMonth: round2(rows[rows.length - 1]?.payment || 0),
    monthly: method === 'bx' ? round2(rows[0]?.payment || 0) : null,
    totalInterest,
    totalPayment,
    principal: round2(parts.reduce((a, p) => a + p.P, 0)),
    count: n,
  }
}

// ---------- 汇率（rate = 1 单位外币 ≈ 多少人民币，离线参考值） ----------
export const FX_RATES = {
  CNY: { name: '人民币', sym: '¥', rate: 1 },
  USD: { name: '美元', sym: '$', rate: 7.12 },
  EUR: { name: '欧元', sym: '€', rate: 7.75 },
  JPY: { name: '日元', sym: 'J¥', rate: 0.0479 },
  GBP: { name: '英镑', sym: '£', rate: 9.05 },
  HKD: { name: '港币', sym: 'HK$', rate: 0.91 },
  AUD: { name: '澳元', sym: 'A$', rate: 4.72 },
  CAD: { name: '加元', sym: 'C$', rate: 5.21 },
  SGD: { name: '新加坡元', sym: 'S$', rate: 5.35 },
  KRW: { name: '韩元', sym: '₩', rate: 0.0052 },
}
export function fxConvert(amount, from, to) {
  const cny = amount * FX_RATES[from].rate
  return round2(cny / FX_RATES[to].rate)
}

// ---------- 账单导入解析（支付宝/微信/轻语CSV） ----------
const KEYWORD_CATS = [
  [/(饿了么|美团|肯德基|麦当劳|星巴克|瑞幸|餐厅|饭店|食品|饮品|咖啡|奶茶|烘焙|面馆|小吃)/, '餐饮'],
  [/(滴滴|高德|地铁|公交|火车|12306|航空|机票|加油|停车|骑行|共享单车)/, '交通出行'],
  [/(淘宝|天猫|京东|拼多多|唯品会|苏宁|闲鱼|服饰|百货|超市|便利店|数码|家电)/, '购物'],
  [/(水电|燃气|物业|通讯|移动|联通|电信|宽带|房租)/, '居家生活'],
  [/(电影|游戏|演出|视频会员|爱奇艺|腾讯视频|优酷|哔哩|网易云|QQ音乐)/, '娱乐'],
  [/(医院|药房|药店|挂号|体检)/, '医疗'],
  [/(书店|教育|培训|学堂|得到|知识)/, '教育'],
  [/(红包|转账|礼金)/, '人情'],
]
function guessCat(state, text, type) {
  if (type !== 'expense') return null
  for (const [re, name] of KEYWORD_CATS) {
    if (re.test(text)) {
      const c = state.categories.expense.find((x) => x.name.includes(name.slice(0, 2)) || name.includes(x.name))
      if (c) return c.id
    }
  }
  return null
}
// v1.4 智能填单用：关键词 → 支出分类 id
export const guessCategoryId = guessCat
export function parseBillCSV(text, state) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const drafts = []
  for (const line of lines) {
    // 轻语导出格式：日期,时间,类型,一级分类,二级分类,账户,金额,备注
    if (/^\d{4}-\d{2}-\d{2},\d{2}:\d{2},(支出|收入|转账)/.test(line)) {
      const [date, time, type, , , , amt, note] = line.split(',')
      const t = type === '转账' ? 'transfer' : type === '收入' ? 'income' : 'expense'
      drafts.push(mkDraft(date, time.slice(0, 5), t, Number(amt), note || '', line))
      continue
    }
    // 跳过表头/非数据行
    const dm = line.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?[,，\s]*(\d{1,2}:\d{2}(:\d{2})?)?/)
    if (!dm) continue
    const date = `${dm[1]}-${pad2(Number(dm[2]))}-${pad2(Number(dm[3]))}`
    const time = dm[4] ? dm[4].slice(0, 5) : '12:00'
    // 收支方向
    let type = null
    if (/(^|[,，\s])收入([,，\s]|$)/.test(line) || /收\/支.*,，*收入/.test(line)) type = 'income'
    else if (/(^|[,，\s])支出([,，\s]|$)/.test(line)) type = 'expense'
    if (!type) continue
    if (/不计收支|其他/.test(line) && !/支出|收入/.test(line)) continue
    // 金额：取行中最后一个 x.xx 数字
    const nums = [...line.matchAll(/(\d+(?:\.\d{1,2})+)/g)].map((m) => Number(m[1]))
    if (!nums.length) continue
    const amount = Math.max(...nums.filter((n) => n > 0 && n < 1e7).concat([0]))
    if (!amount) continue
    // 备注取包含中文最多的字段
    const fields = line.split(/[,，]/)
    const note = (fields.filter((f) => /[\u4e00-\u9fa5]/.test(f) && !/收支|交易|账单|订单/.test(f)).sort((a, b) => b.length - a.length)[0] || '').replace(/["']/g, '').slice(0, 30)
    drafts.push(mkDraft(date, time, type, amount, note, line))
  }
  return drafts
}
function mkDraft(date, time, type, amount, note, raw) {
  return {
    id: null, date, time, type, amount: round2(amount), note,
    categoryId: null, accountId: null,
    sourceHash: hashStr(`${date}|${time}|${type}|${amount}|${note}|${raw.slice(0, 40)}`),
  }
}

// ---------- 消费点评引擎 ----------
export function genReview(state, period) {
  const txs = txsOfPeriod(state, period)
  const prevP = periodAdd(period, -1, state.settings.monthStartDay || 1)
  const prevTxs = txsOfPeriod(state, prevP)
  const exp = sumBy(txs, 'expense'), inc = sumBy(txs, 'income')
  const pExp = sumBy(prevTxs, 'expense'), pInc = sumBy(prevTxs, 'income')
  const bal = round2(inc - exp)
  const days = new Set(txs.map((t) => t.date)).size || 1
  const avgDay = round2(exp / daysInPeriod(period, state.settings.monthStartDay || 1))
  const catStats = statByCategory(txs, 'expense', state)
  const lines = []
  let score = 100

  // 总览
  const momExp = pExp > 0 ? Math.round(((exp - pExp) / pExp) * 100) : null
  lines.push(`本期共记录 ${txs.length} 笔账单，支出 ${fmt(exp)} 元，收入 ${fmt(inc)} 元，结余 ${fmt(bal)} 元。`)
  if (momExp !== null) {
    lines.push(momExp >= 0
      ? `支出较上月增加 ${momExp}%${momExp > 20 ? '，增长明显，建议关注大额消费。' : '，整体平稳。'}`
      : `支出较上月减少 ${-momExp}%，控制得不错，继续保持！`)
    if (momExp > 20) score -= 12
    if (momExp < -10) score += 5
  }
  // 分类洞察
  if (catStats.length) {
    const top = catStats.slice(0, 3)
    lines.push(`支出主要集中在${top.map((c) => `${c.name}(${fmt(c.value)}元, ${Math.round((c.value / exp) * 100)}%)`).join('、')}。`)
    if (top[0] && top[0].value / exp > 0.45) { lines.push(`其中「${top[0].name}」占支出近一半，是本月最值得优化的开销。`); score -= 10 }
    // 单日最大
    const byDay = {}
    for (const t of txs) if (t.type === 'expense') byDay[t.date] = (byDay[t.date] || 0) + Number(t.amount)
    const maxDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]
    if (maxDay && maxDay[1] / exp > 0.25 && exp > 100) {
      lines.push(`${maxDay[0].slice(5).replace('-', '月')}日单日支出 ${fmt(maxDay[1])} 元，占本月 ${Math.round((maxDay[1] / exp) * 100)}%，属于集中消费日。`)
      score -= 8
    }
  } else {
    lines.push('本期还没有支出记录，记几笔再来看看统计吧。')
  }
  // 预算
  const budget = state.budgets?.total || 0
  if (budget > 0) {
    const use = Math.round((exp / budget) * 100)
    if (use > 100) { lines.push(`月预算已超支 ${fmt(exp - budget)} 元（使用率 ${use}%），注意控制节奏哦。`); score -= 20 }
    else if (use > 80) { lines.push(`预算已使用 ${use}%，接近上限，月末要悠着点花。`); score -= 6 }
    else lines.push(`预算使用率 ${use}%，节奏健康，为你点赞！`)
  } else {
    lines.push('还没有设置月预算，去「预算」设一个，帮你管住手。')
    score -= 5
  }
  // 收支比
  if (inc > 0) {
    const rate = Math.round((exp / inc) * 100)
    lines.push(`支出占收入的 ${rate}%。`)
    if (rate > 100) { lines.push('入不敷出，建议削减非必要开支或增加收入来源。'); score -= 15 }
    else if (rate < 60) { lines.push('储蓄率超过四成，财务状态很稳健！'); score += 5 }
  }
  // 日均
  if (exp > 0) lines.push(`日均支出约 ${fmt(avgDay)} 元。`)

  score = Math.max(30, Math.min(100, score + (txs.length > 15 ? 3 : 0)))
  const level = score >= 85 ? '理性型' : score >= 70 ? '均衡型' : score >= 55 ? '随性型' : '豪爽型'
  return { period, score, level, lines, exp, inc, bal, top: catStats.slice(0, 5) }
}
function daysInPeriod(p, sd) {
  const [s, e] = periodBounds(p, sd)
  return Math.max(1, Math.round((parseD(e) - parseD(s)) / 86400000))
}

// ---------- 周期记账 ----------
export function nextRunDates(rec, fromDate, upToDate, cap = 60) {
  // 返回 fromDate(含) ~ upToDate(含) 之间应记账的日期列表
  const out = []
  let cur = rec.startDate > fromDate ? rec.startDate : fromDate
  const iv = Math.max(1, Number(rec.interval) || 1)
  let guard = 0
  while (cur <= upToDate && out.length < cap && guard++ < 4000) {
    out.push(cur)
    if (rec.freq === 'daily') cur = addDays(cur, iv)
    else if (rec.freq === 'weekly') cur = addDays(cur, 7 * iv)
    else if (rec.freq === 'monthly') {
      const d = parseD(cur)
      d.setMonth(d.getMonth() + iv)
      cur = fmtD(d)
    } else if (rec.freq === 'yearly') {
      const d = parseD(cur)
      d.setFullYear(d.getFullYear() + iv)
      cur = fmtD(d)
    }
  }
  return out
}
export const FREQ_CN = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }

// ---------- CSV 导出 ----------
export function txsToCSV(state, txs) {
  const rows = [['日期', '时间', '类型', '一级分类', '二级分类', '账户', '金额', '备注']]
  for (const t of [...txs].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const info = catInfo(state, t)
    rows.push([
      t.date, t.time,
      t.type === 'expense' ? '支出' : t.type === 'income' ? '收入' : '转账',
      info.main || '', t.type === 'transfer' ? '' : info.name,
      t.type === 'transfer' ? `${accountName(state, t.accountId)}→${accountName(state, t.toAccountId)}` : accountName(state, t.accountId),
      t.amount, (t.note || '').replace(/[,\n]/g, ' '),
    ].join(','))
  }
  return '\ufeff' + rows.map((r) => r.join(',')).join('\n')
}
export function downloadFile(name, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---------- v1.4 智能填单（本地正则兜底解析，无 API Key 也可用） ----------
export function parseTxTextLocal(text, state) {
  const t = String(text || '').trim()
  if (!t) return null
  // 类型：命中收入词即收入，默认支出
  const type = /(收入|工资|进账|收到|到账|报销|红包|奖金|退款|薪)/.test(t) ? 'income' : 'expense'
  // 日期：前天/昨天/昨晚/X月X日/YYYY-MM-DD，默认今天
  let date = todayStr()
  if (/前天/.test(t)) date = addDays(todayStr(), -2)
  else if (/昨天|昨晚/.test(t)) date = addDays(todayStr(), -1)
  else {
    const dfull = t.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
    const dshort = !dfull ? t.match(/(\d{1,2})月(\d{1,2})[日号]?/) : null
    if (dfull) date = `${dfull[1]}-${pad2(Number(dfull[2]))}-${pad2(Number(dfull[3]))}`
    else if (dshort) {
      const now = new Date()
      const y = Number(dshort[1]) > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear()
      date = `${y}-${pad2(Number(dshort[1]))}-${pad2(Number(dshort[2]))}`
    }
  }
  // 金额：¥xx / xx块 / xx元，否则取最后一个数字
  let amount = 0
  const m1 = t.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) || t.match(/(\d+(?:\.\d{1,2})?)\s*(?:块|元)/)
  if (m1) amount = Number(m1[1])
  else {
    const nums = [...t.matchAll(/(\d+(?:\.\d{1,2})?)/g)]
      .map((x) => Number(x[1])).filter((n) => n > 0 && n < 1e7)
    if (nums.length) amount = nums[nums.length - 1]
  }
  if (!(amount > 0)) return null
  // 备注：剥离日期与金额后的文字
  let note = t
    .replace(/(\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2})|\d{1,2}月\d{1,2}[日号]?/g, '')
    .replace(/[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:块|元)/g, '')
    .replace(/昨天|前天|今天|昨晚|花了?|消费|支出|收入一笔|记一笔/g, '')
    .replace(/[\s,，。.、；;！!]+/g, ' ')
    .trim()
  if (note.length > 20) note = note.slice(0, 20)
  return { type, amount: round2(amount), date, note, categoryId: guessCategoryId(state, t, type), source: 'local' }
}

// ---------- v1.4 月账单导出 PDF（打印样式，走系统打印/另存为 PDF） ----------
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
export function buildMonthHtml(state, period) {
  const sd = state.settings.monthStartDay || 1
  const txs = txsOfPeriod(state, period)
  const exp = sumBy(txs, 'expense')
  const inc = sumBy(txs, 'income')
  const catStats = statByCategory(txs, 'expense', state).slice(0, 12)
  const incStats = statByCategory(txs, 'income', state).slice(0, 8)
  const ledgerName = state.ledgers.find((l) => l.id === state.currentLedgerId)?.name || '默认账本'
  const sorted = [...txs].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const rows = sorted.map((t) => {
    const info = catInfo(state, t)
    const acc = t.type === 'transfer'
      ? `${escHtml(accountName(state, t.accountId))} → ${escHtml(accountName(state, t.toAccountId))}`
      : escHtml(accountName(state, t.accountId))
    return `<tr>
      <td>${escHtml(t.date.slice(5))} ${escHtml(t.time)}</td>
      <td>${t.type === 'expense' ? '支出' : t.type === 'income' ? '收入' : '转账'}</td>
      <td>${t.type === 'transfer' ? '转账' : escHtml(info.name)}</td>
      <td>${acc}</td>
      <td>${escHtml(t.note || '')}</td>
      <td class="r ${t.type}">${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}${fmt(t.amount)}</td>
    </tr>`
  }).join('')
  const catRows = catStats.map((c, i) => `
    <tr><td>${i + 1}</td><td>${escHtml(c.name)}</td><td>${c.count}</td><td class="r">${fmt(c.value)}</td>
    <td class="r">${exp > 0 ? Math.round((c.value / exp) * 1000) / 10 : 0}%</td></tr>`).join('')
  const incRows = incStats.map((c) => `<tr><td>${escHtml(c.name)}</td><td>${c.count}</td><td class="r income">${fmt(c.value)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escHtml(periodLabel(period))}账单 · ${escHtml(ledgerName)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.6 "PingFang SC","Microsoft YaHei",sans-serif; color: #26303e; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #7a8494; margin-bottom: 14px; font-size: 11px; }
  .sum { display: flex; gap: 10px; margin-bottom: 14px; }
  .sum div { flex: 1; border-radius: 10px; padding: 10px 12px; background: #f2f5fa; }
  .sum b { display: block; font-size: 16px; margin-top: 2px; }
  .expense { color: #e5484d; } .income { color: #159570; } .transfer { color: #2f6fd6; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-left: 3px solid #2a2f3a; padding-left: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e6eaf1; padding: 5px 6px; text-align: left; }
  th { background: #f2f5fa; font-size: 11px; color: #5b6472; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .foot { margin-top: 16px; color: #9aa1af; font-size: 10px; text-align: center; }
</style></head><body>
<h1>${escHtml(periodLabel(period))}账单</h1>
<div class="sub">${escHtml(ledgerName)} · 账期起始 ${sd} 日 · 导出时间 ${escHtml(todayStr())} · 轻语记账</div>
<div class="sum">
  <div>总收入<b class="income">¥${fmt(inc)}</b></div>
  <div>总支出<b class="expense">¥${fmt(exp)}</b></div>
  <div>${inc - exp >= 0 ? '结余' : '超支'}<b class="${inc - exp >= 0 ? 'income' : 'expense'}">¥${fmt(Math.abs(inc - exp))}</b></div>
</div>
${catStats.length ? `<h2>支出分类统计</h2><table><tr><th>#</th><th>分类</th><th>笔数</th><th class="r">金额</th><th class="r">占比</th></tr>${catRows}</table>` : ''}
${incStats.length ? `<h2>收入分类统计</h2><table><tr><th>分类</th><th>笔数</th><th class="r">金额</th></tr>${incRows}</table>` : ''}
<h2>账单明细（${txs.length} 笔）</h2>
<table><tr><th>时间</th><th>类型</th><th>分类</th><th>账户</th><th>备注</th><th class="r">金额</th></tr>${rows || '<tr><td colspan="6">本期暂无账单</td></tr>'}</table>
<div class="foot">由轻语记账生成 · 数据仅保存在你的设备</div>
<script>window.onload = function() {}</script>
</body></html>`
}
// 隐藏 iframe 打印（浏览器/Electron/Android WebView 通用，无弹窗拦截问题）
export function printHtml(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  const kick = () => {
    // __QY_NO_PRINT__：无头测试钩子，跳过系统打印对话框（会永久阻塞隐藏窗口）
    if (!window.__QY_NO_PRINT__) {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch { /* ignore */ }
    }
    setTimeout(() => iframe.remove(), 60000)
  }
  setTimeout(kick, 120)
}

// ---------- v1.4 净值快照序列（稀疏取点，供趋势线绘制） ----------
export function netWorthSeries(state, days = 30) {
  const snaps = state.netWorthSnapshots || {}
  const today = todayStr()
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const ds = addDays(today, -i)
    const s = snaps[ds]
    if (s && Number.isFinite(Number(s.net))) out.push({ date: ds, asset: Number(s.asset) || 0, debt: Number(s.debt) || 0, net: Number(s.net) || 0 })
  }
  return out
}

// ---------- v1.6 底部菜单图标图片：时间戳表归一（纯函数，migrateState 与单测共用） ----------
export const TAB_ICON_KEYS = ['home', 'charts', 'discover', 'profile']

// 非法形状整体重建；合法则补齐缺省 key 并把时间戳字符串化
export function normalizeTabIconAt(v) {
  const out = { home: null, charts: null, discover: null, profile: null }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of TAB_ICON_KEYS) {
      if (v[k]) out[k] = String(v[k])
    }
  }
  return out
}

// ---------- v1.6.8 发现页功能图标时间戳表归一 ----------
export const DISCOVER_ICON_KEYS = [
  'scan', 'assets', 'creditCards', 'debts', 'goals', 'reimburse', 'templates',
  'loan', 'fx', 'invoice', 'import', 'recurring', 'ledgers', 'review',
]
export function normalizeDiscIconAt(v) {
  const out = {}
  for (const k of DISCOVER_ICON_KEYS) out[k] = null
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of DISCOVER_ICON_KEYS) {
      if (v[k]) out[k] = String(v[k])
    }
  }
  return out
}

// ---------- v2.5 AI 上传脱敏（纯函数，ai.js 与单测共用） ----------
// 把文本中可关联到个人的高敏数字串打码后再交给大模型，金额（≤2 位小数）与日期时间不受影响：
// - 身份证（18 位且 GB 11643 校验码验证通过；防止把长卡号误判成身份证）→ 保留前 3 后 2
// - 手机号（1[3-9] 号段 11 位，容忍空格/连字符分隔）→ 保留前 3 后 4
// - 银行卡/订单号（其余 13-19 位连续数字）→ 保留前 4 后 3
const QY_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const QY_ID_CHECK = '10X98765432'
function validId18(s) {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const d = Number(s[i])
    if (!Number.isInteger(d)) return false
    sum += d * QY_ID_WEIGHTS[i]
  }
  return QY_ID_CHECK[sum % 11] === s[17].toUpperCase()
}
export function maskSensitive(text) {
  let s = String(text || '')
  if (!s) return s
  s = s.replace(/(?<!\d)(\d{17}[\dXx])(?!\d)/g, (m, id) =>
    validId18(id) ? id.slice(0, 3) + '*************' + id.slice(-2) : m)
  s = s.replace(/(?<!\d)(1[3-9]\d)[ -]?(\d{4})[ -]?(\d{4})(?!\d)/g, '$1****$3')
  s = s.replace(/(?<!\d)(\d{4})\d{6,12}(\d{3})(?!\d)/g, '$1******$2')
  return s
}

// ---------- v1.5 收支监控：解析微信/支付宝通知文本（纯函数） ----------
// 返回 { amount(元,2位小数), kind:'income'|'expense', source:'wechat'|'alipay', title, text } 或 null。
// 只有「来源 + 金额 + 收支方向」三要素齐备才解析成功，避免验证码/物流等噪声误弹窗。
// v1.6.8 扩充真实文案：带符号金额（微信支付-9.90）、¥金额、收款/收钱码/转账来向去向等。
// v2.4 深测修正：向你转账 → 收入（原「向X转账」通配误判为支出）；
// 提现是资金搬家非收支，与「验证码」同列噪声（原被标题「微信支付」的“支付”误判为支出弹窗）
const QY_NOTIFY_INCOME_KW = /到账|收款|收到|已收钱|收钱码|入账|进账|收益|退款|退回|返现|红包|转入我|转账-来自|转账来自|向你转账|来自[^|]{0,12}的?转账/
const QY_NOTIFY_EXPENSE_KW = /支出|付款|支付|扫码付|商户消费|消费|扣款|扣费|转出|代扣|充值成功|转账给|向[^|，。\s]{1,12}转账|发起转账/
const QY_NOTIFY_NOISE_KW = /验证码|校验码|登录|物流|快递|取件|投诉|客服|风险|信用卡还款提醒|账单日出账|提现/

export function parseMoneyNotify(title, text, pkg = '') {
  let s = `${title || ''} ${text || ''}`.replace(/\s+/g, ' ')
  // 千分位归一（1,234.56 → 1234.56；负向断言防误吃「1,23」，循环处理百万位）
  while (/(\d),(\d{3})(?!\d)/.test(s)) s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  if (!s.trim()) return null
  // 来源：包名优先，其次按文本关键词
  let source = null
  if (pkg === 'com.tencent.mm' || s.includes('微信')) source = 'wechat'
  else if (pkg === 'com.eg.android.AlipayGphone' || s.includes('支付宝')) source = 'alipay'
  if (!source) return null
  if (QY_NOTIFY_NOISE_KW.test(s)) return null

  // 金额提取，按可靠度排序：
  // 1) 带负号（微信支付-9.90 / 支付宝-25.00）→ 同时锁定支出方向
  // 2) ¥/￥ 前缀金额（付款成功 ¥25.00）
  // 3) 「数字 元」（收款12.50元）
  // 4) 强支付/收款词附近的裸两位小数（微信支付-9.9 已在 1 覆盖；支付宝「成功收款88.00元」在 3）
  let amount = 0
  let signedExpense = false
  let m = s.match(/(?:^|[^\d-])[-﹣－]\s*(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)(?!\d|-)/)
  if (m) {
    signedExpense = true
    amount = Number(m[1])
  } else {
    m = s.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/)
    // 万元计价（「到账1万元/收到转账1.5万元」）：先于普通「数字 元」匹配，命中后 ×10000
    if (!m) m = s.match(/(\d+(?:\.\d{1,2})?)\s*万?\s*元/)
    if (!m && /支付|付款|收款|到账|消费|扣款|转出|转入|红包|转账/.test(s)) {
      // 强语境下的裸金额（如「微信支付 9.90」），取第一个两位小数
      m = s.match(/(\d+\.\d{1,2})/)
    }
    if (m) {
      amount = Number(m[1])
      if (/万元/.test(s)) amount *= 10000
    }
  }
  if (!(amount > 0) || amount > 1e7) return null

  // 方向（顺序即优先级）：
  // 1) 带负号直接支出（微信支付-9.90）
  // 2) 强收入词（收款/到账…；标题「微信支付」里的“支付”不能压过正文中的收款）
  // 3) 支出词（含裸“支付/付款/消费”，精确到“转账给/向X转账”区分转账方向）
  // 4) 裸「转入/转账」兜底为收入
  let kind = null
  if (signedExpense) kind = 'expense'
  else if (QY_NOTIFY_INCOME_KW.test(s)) kind = 'income'
  else if (QY_NOTIFY_EXPENSE_KW.test(s)) kind = 'expense'
  else if (/转入|转账/.test(s)) kind = 'income'
  if (!kind) return null
  return {
    amount: round2(amount),
    kind,
    source,
    title: String(title || '').slice(0, 40),
    text: String(text || '').slice(0, 120),
  }
}

// ---------- v1.4.1 头像白底检测（纯像素判定，供 canvas getImageData 后调用） ----------
// data: RGBA 像素数组；取样四角 12×12 补丁均值，四角全为近白色（低饱和）才判定白底
export function isWhiteBgPixels(data, w, h) {
  const P = 12
  let whiteCnt = 0
  for (const [x0, y0] of [[0, 0], [w - P, 0], [0, h - P], [w - P, h - P]]) {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = y0; y < y0 + P; y++) {
      for (let x = x0; x < x0 + P; x++) {
        const i = (y * w + x) * 4
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
      }
    }
    r /= n; g /= n; b /= n
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    if (mn >= 225 && mx - mn <= 24) whiteCnt++
  }
  return whiteCnt === 4
}

/* ---------- v1.8.0 AI 风格卡：角色名规范化 key（缓存索引用） ---------- */
export function styleKeyOf(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/[\s·・.。,，'’"“”-]/g, '') // 去空白与常见分隔符，全半角引号
}
