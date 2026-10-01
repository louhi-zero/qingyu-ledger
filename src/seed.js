import { uid, todayStr, addDays, periodOf, periodAdd, pad2, round2, netWorth } from './utils.js'

// 分类色板
const PAL = ['#ff8a65', '#42a5f5', '#66bb6a', '#ab47bc', '#ffa726', '#29b6f6', '#ec407a', '#26c6da', '#8d6e63', '#7e57c2', '#d4e157', '#5c6bc0']

function cat(name, icon, color, children = [], custom = false) {
  return { id: uid(), name, icon, color, custom, children: children.map(([n, i]) => ({ id: uid(), name: n, icon: i })) }
}

export function defaultCategories() {
  return {
    expense: [
      cat('餐饮', '🍜', PAL[0], [['早餐', '🥐'], ['午餐', '🍚'], ['晚餐', '🍲'], ['饮料', '🥤'], ['零食', '🍪'], ['水果', '🍎']]),
      cat('购物', '🛍️', PAL[1], [['服饰鞋包', '👟'], ['日用百货', '🧻'], ['数码家电', '📱'], ['美妆护肤', '💄'], ['网购', '📦']]),
      cat('交通出行', '🚌', PAL[2], [['公交地铁', '🚇'], ['打车', '🚕'], ['加油', '⛽'], ['火车机票', '✈️'], ['停车', '🅿️']]),
      cat('居家生活', '🏠', PAL[3], [['房租', '🏘️'], ['水电燃气', '💧'], ['物业', '🏢'], ['通讯', '📶'], ['装修', '🛠️']]),
      cat('娱乐休闲', '🎮', PAL[4], [['电影', '🎬'], ['游戏', '🎮'], ['旅行', '🏖️'], ['订阅', '📺'], ['运动', '⚽']]),
      cat('医疗健康', '💊', PAL[5], [['挂号门诊', '🏥'], ['药品', '💊'], ['体检', '🩺']]),
      cat('教育学习', '📚', PAL[6], [['书籍', '📚'], ['培训', '🎓'], ['学费', '🏫'], ['知识付费', '📝']]),
      cat('人情往来', '🧧', PAL[7], [['礼金', '🧧'], ['红包', '💰'], ['请客', '🍽️'], ['慈善', '❤️']]),
      cat('宠物', '🐶', PAL[8], [['宠物食品', '🦴'], ['宠物医疗', '🐾']]),
      cat('其他支出', '🧾', PAL[9]),
    ],
    income: [
      cat('工资', '💼', '#ffb300'),
      cat('奖金', '🏆', '#ff7043'),
      cat('兼职', '💪', '#8d6e63'),
      cat('理财收益', '📈', '#26a69a', [['利息', '🪙'], ['分红', '💎']]),
      cat('退款', '↩️', '#42a5f5'),
      cat('红包', '🧧', '#ef5350'),
      cat('生意收入', '🏪', '#7e57c2'),
      cat('其他收入', '💡', '#9e9e9e'),
    ],
  }
}

export const ACCOUNT_TYPES = [
  { type: 'cash', name: '现金', icon: '💵', desc: '钱包里的钞票', liability: false },
  { type: 'debit', name: '储蓄卡', icon: '💳', desc: '银行借记卡', liability: false },
  { type: 'credit', name: '信用卡', icon: '🪪', desc: '信用卡/花呗/白条', liability: true },
  { type: 'virtual', name: '虚拟账户', icon: '📱', desc: '支付宝/微信', liability: false },
  { type: 'invest', name: '投资账户', icon: '📈', desc: '股票/基金/理财', liability: false },
  { type: 'debt', name: '负债', icon: '📉', desc: '贷款/借入', liability: true },
  { type: 'claim', name: '债权', icon: '🤝', desc: '应收/借出', liability: false },
  { type: 'custom', name: '自定义', icon: '⭐', desc: '自定义资产', liability: false },
]

export const LEDGER_TEMPLATES = [
  { icon: '📒', name: '标准账本', desc: '日常收支记录' },
  { icon: '🏪', name: '生意账本', desc: '生意经营专用' },
  { icon: '📋', name: '报销账本', desc: '适合记录报销账目' },
  { icon: '🧳', name: '旅行账本', desc: '旅途花销一目了然' },
  { icon: '🔨', name: '装修账本', desc: '装修支出管理' },
  { icon: '👨‍👩‍👧', name: '家庭账本', desc: '全家人一起记' },
  { icon: '✏️', name: '自定义', desc: '自定义你的专属账本' },
]

export function defaultAccounts() {
  return [
    { id: uid(), name: '现金', type: 'cash', icon: '💵', initial: 800, color: PAL[0] },
    { id: uid(), name: '工资卡', type: 'debit', icon: '💳', initial: 20000, color: PAL[1] },
    { id: uid(), name: '支付宝', type: 'virtual', icon: '🅰️', initial: 3000, color: PAL[4] },
    { id: uid(), name: '微信钱包', type: 'virtual', icon: '💬', initial: 1000, color: PAL[2] },
  ]
}

export function emptyState() {
  const cats = defaultCategories()
  const accounts = []
  const ledgers = [{ id: uid(), name: '默认账本', icon: '📒', template: '标准账本' }]
  return {
    version: 3,
    settings: {
      nickname: '轻语用户',
      avatar: '🐣',
      monthStartDay: 1,
      defaultType: 'expense',
      hideAmount: false,
      dark: false,
      remindEnabled: false,
      remindTime: '21:00',
      welcomed: false,
      // v1.1 液态玻璃
      glassOn: false, // 老用户默认关闭，保持升级前观感
      glassBlur: 16, // 背景模糊半径 px
      wallpaperAt: null, // 自定义壁纸更新时间（null=默认），图片本体在 IndexedDB
      avatarPhotoAt: null, // 头像照片更新时间（null=用 emoji）
      // v1.1 AI 分析（仅风格偏好随云同步；API Key/模型/BaseURL 只存本机）
      aiStyle: 'tender', // tender 温柔鼓励 / sharp 犀利毒舌 / pro 专业财务师 / cute 俏皮可爱
      aiCustomStyle: '',
      aiIncludeNotes: true, // 分析时是否附带账单备注原文
      // v1.2 熬夜归属：0 点后（<5 点）记一笔默认算昨天
      nightAcross: false,
      // 个性化：AI 助手形象、启动页背景（tabIcons 为 v1.3 遗留，v1.4.1 起废弃不再使用）
      tabIcons: {}, // v1.4.1 已废弃，仅兼容旧数据
      aiFace: '🤖', // AI 形象 emoji（照片优先，见 aiFaceAt）
      aiFaceAt: null,
      welcomeBgAt: null, // 启动页背景更新时间，本体在 IndexedDB
      // v1.3 资金管理：本位币（暂仅支持 CNY，预留字段）
      baseCurrency: 'CNY',
      // v1.5 收支监控：Android 通知监听（微信/支付宝收支自动弹确认窗），仅原生端生效
      notifyCatch: false,
      // v1.6 个性化：点击反馈；底部菜单图标图片更新时间（本体 IndexedDB 'tabicon_<page>'）
      // v1.6.8 拆分：tapScale 管按压缩放，vibrateLevel 管震动强度（0 关/1 轻柔 6ms/2 标准 10ms/3 明快 20ms）
      tapFeedback: true,
      tapScale: true,
      vibrateLevel: 2,
      tabIconAt: { home: null, charts: null, discover: null, profile: null },
      // v1.6.8 发现页功能图标自定义（本体 IndexedDB 'discicon_<key>'，时间戳表驱动刷新）
      discIconAt: {},
      // v1.6.5 公告：接收应用公告（发现页公告卡 + 重要公告弹窗，均受此开关控制）
      noticeEnabled: true,
    },
    categories: cats,
    accounts,
    ledgers,
    currentLedgerId: ledgers[0].id,
    transactions: [],
    budgets: { total: 0, byCategory: {} },
    recurring: [],
    invoices: [],
    checkins: [],
    review: null,
    feedbacks: [],
    // v1.1 AI 报告缓存：key 为 'YYYY-MM' 或 'YYYY'
    aiReports: {},
    // v1.2 记账模板：{id,name,type,amount,categoryId,accountId,note,at}
    templates: [],
    // v1.3 储蓄目标：{id,name,icon,target,saved,deadline,note,at}
    goals: [],
    // v1.3 离线汇率表：1 单位外币 ≈ 多少 CNY（用户可在设置中修改，随云同步）
    fxRates: {
      USD: 7.12, EUR: 7.75, JPY: 0.0479, GBP: 9.05,
      HKD: 0.91, AUD: 4.72, CAD: 5.21, SGD: 5.35, KRW: 0.0052,
    },
    // v1.4 净值日快照：{ 'YYYY-MM-DD': { asset, debt, net, at } }，随云同步
    netWorthSnapshots: {},
    // v1.1 图片资产元数据（本体 Blob 在 IndexedDB，经 WebDAV 同步）
    assetsMeta: {
      avatar: { at: null, hash: null },
      wallpaper: { at: null, hash: null },
      welcomebg: { at: null, hash: null },
      aiface: { at: null, hash: null },
    },
  }
}

// ---------- 示例数据 ----------
export function demoState() {
  const s = emptyState()
  s.settings.welcomed = true
  s.accounts = defaultAccounts()
  const [cash, card, alipay, wechat] = s.accounts
  // v1.3 示例：信用卡 + 负债账户（资金管理页演示）
  const credit = { id: uid(), name: '招行信用卡', type: 'credit', icon: '🪪', initial: -600, color: PAL[5], currency: 'CNY', billingDay: 5, dueDay: 23, creditLimit: 30000 }
  const loan = { id: uid(), name: '车贷', type: 'debt', icon: '🚗', initial: -40000, color: PAL[6], currency: 'CNY', rate: 4.5, dueDate: addDays(todayStr(), 400) }
  s.accounts.push(credit, loan)
  const ledgers = s.ledgers
  ledgers.push({ id: uid(), name: '旅行账本', icon: '🧳', template: '旅行账本' })
  const cats = s.categories
  const find = (main, sub) => {
    const c = cats.expense.find((x) => x.name === main)
    if (!c) return null
    if (!sub) return c.id
    const sc = (c.children || []).find((x) => x.name === sub)
    return (sc || c).id
  }
  const iFind = (main) => {
    const c = cats.income.find((x) => x.name === main)
    return c ? c.id : null
  }

  const today = todayStr()
  const sd = 1
  const thisP = periodOf(today, sd)
  const prevP = periodAdd(thisP, -1)
  const [py, pm] = prevP.split('-').map(Number)
  const rand = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100
  let txId = 0
  const mk = (date, time, type, amount, categoryId, accountId, note, extra = {}) => ({
    id: 'demo' + (++txId), ledgerId: s.currentLedgerId, date, time, type,
    amount, categoryId, accountId, note, createdAt: date + 'T' + time,
    tags: [], reimburse: 'none', attachAt: null, ...extra,
  })

  const txs = []
  // 上月：工资 + 日常
  const prevDays = [1, 2, 3, 5, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 22, 24, 26, 28]
  txs.push(mk(`${py}-${pad2(pm)}-10`, '09:30', 'income', 8600, iFind('工资'), card.id, '10月工资'))
  txs.push(mk(`${py}-${pad2(pm)}-03`, '08:00', 'expense', 1800, find('居家生活', '房租'), card.id, '10月房租'))
  for (const d of prevDays) {
    const ds = `${py}-${pad2(pm)}-${pad2(d)}`
    const r = Math.random()
    if (r < 0.25) txs.push(mk(ds, '12:20', 'expense', rand(15, 38), find('餐饮', '午餐'), Math.random() > .5 ? alipay.id : wechat.id, '工作餐'))
    else if (r < 0.45) txs.push(mk(ds, '18:40', 'expense', rand(25, 60), find('餐饮', '晚餐'), wechat.id, ''))
    else if (r < 0.55) txs.push(mk(ds, '08:10', 'expense', rand(4, 12), find('交通出行', '公交地铁'), alipay.id, '通勤'))
    else if (r < 0.65) txs.push(mk(ds, '14:00', 'expense', rand(30, 120), find('购物', '日用百货'), alipay.id, '日用品'))
    else if (r < 0.72) txs.push(mk(ds, '21:30', 'expense', rand(15, 50), find('娱乐休闲', '游戏'), wechat.id, ''))
    else if (r < 0.78) txs.push(mk(ds, '16:00', 'expense', rand(20, 45), find('餐饮', '水果'), alipay.id, '水果'))
  }
  txs.push(mk(`${py}-${pad2(pm)}-18`, '20:00', 'expense', 268, find('娱乐休闲', '电影'), wechat.id, '看电影+爆米花'))
  txs.push(mk(`${py}-${pad2(pm)}-21`, '11:00', 'income', 320, iFind('理财收益'), alipay.id, '基金收益'))
  txs.push(mk(`${py}-${pad2(pm)}-25`, '10:00', 'expense', 199, find('教育学习', '书籍'), card.id, '买书'))

  // 本月
  const [ty, tm] = thisP.split('-').map(Number)
  const dayNow = Number(today.slice(8))
  txs.push(mk(`${ty}-${pad2(tm)}-10`, '09:30', 'income', 8800, iFind('工资'), card.id, '本月工资'))
  txs.push(mk(`${ty}-${pad2(tm)}-03`, '08:00', 'expense', 1800, find('居家生活', '房租'), card.id, '本月房租'))
  for (let d = 1; d <= Math.min(dayNow, 28); d++) {
    const ds = `${ty}-${pad2(tm)}-${pad2(d)}`
    if (ds > today) break
    const r = Math.random()
    if (r < 0.3) txs.push(mk(ds, '12:30', 'expense', rand(15, 40), find('餐饮', '午餐'), Math.random() > .5 ? alipay.id : wechat.id, ''))
    else if (r < 0.5) txs.push(mk(ds, '19:00', 'expense', rand(22, 65), find('餐饮', '晚餐'), wechat.id, ''))
    else if (r < 0.6) txs.push(mk(ds, '08:10', 'expense', rand(4, 10), find('交通出行', '公交地铁'), alipay.id, ''))
    else if (r < 0.68) txs.push(mk(ds, '15:00', 'expense', rand(20, 90), find('购物', '网购'), alipay.id, ''))
    else if (r < 0.74) txs.push(mk(ds, '10:00', 'expense', rand(30, 60), find('餐饮', '早餐'), wechat.id, ''))
    else if (r < 0.79) txs.push(mk(ds, '21:00', 'expense', rand(15, 45), find('娱乐休闲', '订阅'), wechat.id, '会员'))
  }
  const recent = addDays(today, -1)
  txs.push(mk(recent, '13:00', 'expense', 58, find('餐饮', '午餐'), alipay.id, '和同事聚餐', { tags: ['聚餐', '同事'], reimburse: 'pending' }))
  txs.push(mk(today, '09:00', 'expense', 6, find('交通出行', '公交地铁'), alipay.id, '', { tags: ['通勤'] }))
  // 本月一笔信用卡消费（信用卡页「本期应还」演示）
  txs.push(mk(`${ty}-${pad2(tm)}-08`, '15:30', 'expense', 1299, find('购物', '数码家电'), credit.id, '换个新耳机'))
  // 转账一笔：工资卡 → 支付宝
  {
    const tr = mk(addDays(today, -3), '20:00', 'transfer', 500, null, card.id, '卡里转支付宝')
    tr.accountId = card.id
    tr.toAccountId = alipay.id
    txs.push(tr)
  }

  s.transactions = txs
  // 预算
  s.budgets = { total: 3000, byCategory: {} }
  const catFood = cats.expense.find((x) => x.name === '餐饮')
  const catShop = cats.expense.find((x) => x.name === '购物')
  s.budgets.byCategory[catFood.id] = 900
  s.budgets.byCategory[catShop.id] = 500
  // 周期记账
  s.recurring = [
    {
      id: uid(), type: 'expense', amount: 1800, categoryId: find('居家生活', '房租'),
      accountId: card.id, freq: 'monthly', interval: 1, startDate: `${ty}-${pad2(tm)}-03`,
      lastRun: null, note: '房租', enabled: true,
    },
  ]
  // 打卡：最近 5 天
  s.checkins = [addDays(today, -4), addDays(today, -3), addDays(today, -2), addDays(today, -1), today]
  // v1.2 示例记账模板
  s.templates = [
    { id: uid(), name: '工作日午餐', type: 'expense', amount: 22, categoryId: find('餐饮', '午餐'), accountId: alipay.id, note: '工作餐', at: new Date().toISOString() },
    { id: uid(), name: '地铁通勤', type: 'expense', amount: 6, categoryId: find('交通出行', '公交地铁'), accountId: alipay.id, note: '', at: new Date().toISOString() },
  ]
  // v1.3 示例储蓄目标
  s.goals = [
    { id: uid(), name: '云南旅行基金', icon: '🧳', target: 20000, saved: 6500, deadline: addDays(today, 180), note: '明年春天出发', at: new Date().toISOString() },
    { id: uid(), name: '应急备用金', icon: '🛟', target: 30000, saved: 31200, deadline: addDays(today, 90), note: '已达成，保持住', at: new Date().toISOString() },
  ]
  // 发票抬头示例
  s.invoices = [{ id: uid(), name: '示例公司', taxNo: '91110000XXXXXXXXXX', address: '北京市朝阳区xx路1号', phone: '010-88888888', bank: 'XX银行北京分行', account: '6222 0000 0000 0000' }]
  // v1.4 示例净值快照：近 14 天随机走势，终点为当前真实净值
  {
    const nw = netWorth(s)
    const snaps = {}
    let v = round2(nw.net - 900)
    for (let i = 13; i >= 1; i--) {
      v = round2(v + (Math.random() - 0.32) * 320)
      const ds = addDays(today, -i)
      const asset = round2(Math.max(1, nw.asset + (Math.random() - 0.42) * 240))
      snaps[ds] = { asset, debt: round2(Math.max(0, asset - v)), net: v, at: ds + 'T20:00:00.000Z' }
    }
    snaps[today] = { asset: nw.asset, debt: nw.debt, net: nw.net, at: new Date().toISOString() }
    s.netWorthSnapshots = snaps
  }
  return s
}
