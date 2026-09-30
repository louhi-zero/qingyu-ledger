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
  if (tx.type === 'transfer') return { icon: '🔄', name: '转账', color: '#13b5a1', main: '转账' }
  const list = tx.type === 'income' ? state.categories.income : state.categories.expense
  const f = findCat(list, tx.categoryId)
  if (!f) return { icon: '❓', name: '未分类', color: '#9aa1af', main: '未分类' }
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
  return state.transactions.filter((t) => t.ledgerId === lid)
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
