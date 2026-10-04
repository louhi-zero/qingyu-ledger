/* 轻语记账 v1.0 云备份：全量快照 + 三步行级合并
 *
 * 不引入任何 schema 变更（账单不新增 updatedAt/墓碑），
 * 三向合并（base 上次共同快照 / local 本机 / remote 云端）即可正确处理：
 *   - 新增：某端独有则并入
 *   - 修改：仅一端改动则取该端；两端都改成相同结果也算一致
 *   - 删除：仅一端删除、另一端未改动则删除；另一端已修改则保留（编辑优先）
 *   - 两端都改且结果不同：内容确定性较小者保留原 id，另一份留冲突副本
 *     （id 后缀 __dup__<设备号>），保证两台设备独立计算出完全一致的合并结果
 */

export const SNAPSHOT_KIND = 'qingyu-cloud-v1'
export const BACKUP_KIND = 'full-backup'

const ROW_LISTS = ['transactions', 'accounts', 'ledgers', 'recurring', 'invoices']

// ---------- 基础工具 ----------

export function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

// 稳定序列化：对象 key 排序，数组保序，用于确定性比较
export function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']'
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}'
}

const eq = (a, b) => stableJson(a) === stableJson(b)

function shortId(deviceId) {
  return String(deviceId || 'x').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'xxxxxx'
}

// 给冲突副本加人工可读标记
function labelDup(dup, at) {
  const day = String(at || '').slice(0, 10)
  const tag = `冲突副本${day ? '·' + day : ''}`
  if (typeof dup.note === 'string') {
    dup.note = `【${tag}】${dup.note ? ' ' + dup.note : ''}`
  } else if (typeof dup.name === 'string') {
    dup.name = `${tag}·${dup.name}`
  }
  return dup
}

// ---------- 行集合（带 id 的对象数组）三向合并 ----------

function isDupId(id) {
  return typeof id === 'string' && id.includes('__dup__')
}
function parentOfDup(id) {
  const i = id.indexOf('__dup__')
  return i < 0 ? id : id.slice(0, i)
}

// 对称顺序合并：用「两端归一化位次的均值」给每行定全局序，位次相同按 id 决胜。
// 不依赖各自的 base，两台设备独立计算可得到完全一致的展示顺序（副本 id 天然紧跟父行）。
function mergeOrder(localArr, remoteArr) {
  const lIds = (localArr || []).map((r) => r.id)
  const rIds = (remoteArr || []).map((r) => r.id)
  const lIdx = new Map(lIds.map((id, i) => [id, i]))
  const rIdx = new Map(rIds.map((id, i) => [id, i]))
  const lPos = (id) => (lIds.length <= 1 ? 0 : lIdx.get(id) / (lIds.length - 1))
  const rPos = (id) => (rIds.length <= 1 ? 0 : rIdx.get(id) / (rIds.length - 1))
  const ranked = []
  for (const id of new Set([...lIds, ...rIds])) {
    const li = lIdx.get(id); const ri = rIdx.get(id)
    const rank = li !== undefined && ri !== undefined
      ? (lPos(id) + rPos(id)) / 2
      : li !== undefined ? lPos(id) : rPos(id)
    ranked.push({ id, rank })
  }
  ranked.sort((a, b) => (a.rank - b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return ranked.map((x) => x.id)
}

function mergeRows(baseArr, localArr, remoteArr, ctx, colName) {
  const { localDevice, remoteDevice, at, conflicts } = ctx
  const bMap = new Map((baseArr || []).map((r) => [r.id, r]))
  const lMap = new Map((localArr || []).map((r) => [r.id, r]))
  const rMap = new Map((remoteArr || []).map((r) => [r.id, r]))

  const out = []
  const emittedDup = new Set()
  // 单行三向裁决；返回输出行（可能 0/1 行，冲突时 2 行）
  const resolve = (id) => {
    const b = bMap.get(id); const l = lMap.get(id); const r = rMap.get(id)
    if (l && r) {
      if (eq(l, r)) return [deepClone(l)]
      if (b) {
        if (eq(l, b)) return [deepClone(r)] // 仅远端改
        if (eq(r, b)) return [deepClone(l)] // 仅本机改
        // 两端都改成不同结果 → 确定性冲突保留两份
        const lSmaller = stableJson(l) <= stableJson(r)
        const main = deepClone(lSmaller ? l : r)
        const other = deepClone(lSmaller ? r : l)
        const otherDevice = lSmaller ? remoteDevice : localDevice
        let dupId = `${id}__dup__${shortId(otherDevice)}`
        let n = 2
        const all = new Set([...bMap.keys(), ...lMap.keys(), ...rMap.keys(), ...out.map((x) => x.id)])
        while (all.has(dupId)) { dupId = `${id}__dup__${shortId(otherDevice)}${n++}`; all.add(dupId) }
        other.id = dupId
        labelDup(other, at)
        conflicts.push({ type: 'row-edit', col: colName, id, mainId: id, dupId, at })
        return [main, other]
      }
      // 两端都“新增”了同一 id 但内容不同
      const lSmaller = stableJson(l) <= stableJson(r)
      const main = deepClone(lSmaller ? l : r)
      const other = deepClone(lSmaller ? r : l)
      const otherDevice = lSmaller ? remoteDevice : localDevice
      other.id = `${id}__dup__${shortId(otherDevice)}`
      labelDup(other, at)
      conflicts.push({ type: 'row-add', col: colName, id, dupId: other.id, at })
      return [main, other]
    }
    if (l && !r) {
      if (!b) return [deepClone(l)] // 本机新增，远端还没有
      if (eq(l, b)) {
        // 本机未改、远端删除 → 跟随删除
        conflicts.push({ type: 'deleted', col: colName, id, at, side: 'remote' })
        return []
      }
      // 本机已改、远端已删 → 编辑优先，保留本机
      conflicts.push({ type: 'edit-vs-delete', col: colName, id, at, kept: 'local' })
      return [deepClone(l)]
    }
    if (!l && r) {
      if (!b) return [deepClone(r)] // 远端新增
      if (eq(r, b)) {
        conflicts.push({ type: 'deleted', col: colName, id, at, side: 'local' })
        return []
      }
      conflicts.push({ type: 'edit-vs-delete', col: colName, id, at, kept: 'remote' })
      return [deepClone(r)]
    }
    return [] // 两端都没有
  }

  const order = mergeOrder(localArr, remoteArr)
  for (const id of order) {
    if (isDupId(id) && emittedDup.has(parentOfDup(id))) continue
    const rows = resolve(id)
    for (const row of rows) {
      out.push(row)
      if (isDupId(row.id)) emittedDup.add(parentOfDup(row.id))
    }
  }
  return out
}

// ---------- 标量字段三向合并（冲突确定性较小值胜出） ----------

function mergeScalar(base, local, remote, path, ctx) {
  if (eq(local, remote)) return deepClone(local)
  if (eq(local, base)) return deepClone(remote) // 仅远端改
  if (eq(remote, base)) return deepClone(local) // 仅本机改
  // 两端都改且不同：取稳定 JSON 较小者（确定性，两端一致）
  const takeLocal = stableJson(local) <= stableJson(remote)
  ctx.conflicts.push({ type: 'scalar', path, at: ctx.at, kept: takeLocal ? 'local' : 'remote' })
  return deepClone(takeLocal ? local : remote)
}

function mergeKeyed(base, local, remote, path, ctx) {
  const out = {}
  const keys = new Set([
    ...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {}),
  ])
  for (const k of [...keys].sort()) {
    out[k] = mergeScalar((base || {})[k], (local || {})[k], (remote || {})[k], `${path}.${k}`, ctx)
  }
  return out
}

// 无 id 对象数组：按内容去重的并集（反馈）
function mergeByValue(baseArr, localArr, remoteArr) {
  const out = []
  const have = new Set()
  const push = (v) => { const k = stableJson(v); if (!have.has(k)) { have.add(k); out.push(deepClone(v)) } }
  for (const v of baseArr || []) push(v)
  // 新增项确定性排序
  const baseKeys = new Set((baseArr || []).map(stableJson))
  const fresh = [...new Set([...(localArr || []), ...(remoteArr || [])]
    .filter((v) => !baseKeys.has(stableJson(v)))
    .map(stableJson))].sort()
  const pool = [...(localArr || []), ...(remoteArr || [])]
  for (const k of fresh) { const v = pool.find((x) => stableJson(x) === k); if (v) push(v) }
  return out
}

// 字符串数组并集（打卡日期）
function mergeStringSet(baseArr, localArr, remoteArr) {
  return [...new Set([...(baseArr || []), ...(localArr || []), ...(remoteArr || [])])].sort()
}

// 按条目时间戳的 LWW 并集（AI 报告缓存、图片资产元数据）：
// 不看 base——条目自带 at，同 key 取时间新者；时间相等本机优先（两端确定性一致）；
// 一端没有该 key 即取另一端。at 为空（如已删除的资产）永远输给有值者。
function mergeLwwMap(localMap, remoteMap, pickAt = (v) => v?.at) {
  const out = {}
  const keys = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})])
  for (const k of keys) {
    const l = localMap?.[k]
    const r = remoteMap?.[k]
    if (l === undefined || l === null) { out[k] = deepClone(r); continue }
    if (r === undefined || r === null) { out[k] = deepClone(l); continue }
    const la = pickAt(l) || ''
    const ra = pickAt(r) || ''
    out[k] = deepClone(la >= ra ? l : r)
  }
  return out
}

// ---------- 整机状态合并 ----------

export function mergeStates(base, local, remote, opts = {}) {
  const conflicts = []
  const ctx = {
    localDevice: opts.localDevice || 'local',
    remoteDevice: opts.remoteDevice || 'remote',
    at: opts.at || new Date().toISOString(),
    conflicts,
  }
  const b = base || {}
  const out = {}
  out.version = Math.max(3, local.version || 3, remote.version || 3)

  // 行集合
  for (const key of ROW_LISTS) {
    out[key] = mergeRows(b[key], local[key], remote[key], ctx, key)
  }
  // 分类：支出/收入两个 id 行数组
  out.categories = {
    expense: mergeRows(b.categories?.expense, local.categories?.expense, remote.categories?.expense, ctx, 'categories.expense'),
    income: mergeRows(b.categories?.income, local.categories?.income, remote.categories?.income, ctx, 'categories.income'),
  }
  // 打卡（日期串集合）、反馈（内容去重并集）
  out.checkins = mergeStringSet(b.checkins, local.checkins, remote.checkins)
  out.feedbacks = mergeByValue(b.feedbacks, local.feedbacks, remote.feedbacks)

  // 标量/映射型数据
  out.settings = mergeKeyed(b.settings, local.settings, remote.settings, 'settings.', ctx)
  out.budgets = {
    total: mergeScalar(b.budgets?.total, local.budgets?.total ?? 0, remote.budgets?.total ?? 0, 'budgets.total', ctx),
    byCategory: mergeKeyed(b.budgets?.byCategory, local.budgets?.byCategory, remote.budgets?.byCategory, 'budgets.cat.', ctx),
  }
  out.currentLedgerId = mergeScalar(b.currentLedgerId, local.currentLedgerId, remote.currentLedgerId, 'currentLedgerId', ctx)
  out.review = mergeScalar(b.review ?? null, local.review ?? null, remote.review ?? null, 'review', ctx)

  // v1.1：AI 报告缓存（按报告自身 at）、头像/壁纸资产元数据（按条目 at，含删除态 at=null）
  out.aiReports = mergeLwwMap(local.aiReports, remote.aiReports)
  out.assetsMeta = mergeLwwMap(local.assetsMeta, remote.assetsMeta)
  // v1.2 记账模板：数组转 id->item 后按 at 做 LWW 并集
  const toTplMap = (arr) => Object.fromEntries((arr || []).filter((t) => t && t.id).map((t) => [t.id, t]))
  out.templates = Object.values(mergeLwwMap(toTplMap(local.templates), toTplMap(remote.templates)))
    .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  // v1.3 储蓄目标：同模板，按条目 at 做 LWW 并集
  out.goals = Object.values(mergeLwwMap(toTplMap(local.goals), toTplMap(remote.goals)))
    .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  // v1.3 汇率表：低频手动修改，整体按标量三向合并
  out.fxRates = mergeScalar(b.fxRates ?? null, local.fxRates ?? null, remote.fxRates ?? null, 'fxRates', ctx)
  // v1.4 净值日快照：key=日期，按条目 at 的 LWW 并集
  out.netWorthSnapshots = mergeLwwMap(local.netWorthSnapshots, remote.netWorthSnapshots)

  return { data: out, conflicts }
}

// ---------- 快照信封 ----------

export function makeSnapshot(data, deviceId, appVersion) {
  return {
    app: 'qingyu',
    kind: SNAPSHOT_KIND,
    appVersion: appVersion || '1.0.0',
    at: new Date().toISOString(),
    deviceId,
    data: deepClone(data),
  }
}

export function parseRemote(text) {
  const env = JSON.parse(text)
  if (env && env.kind === SNAPSHOT_KIND && env.data) {
    return { data: env.data, at: env.at, deviceId: env.deviceId, appVersion: env.appVersion }
  }
  // 兼容 v0.9 的全量备份文件（可作为首次云端种子）
  if (env && env.kind === BACKUP_KIND && env.data) {
    return { data: env.data, at: env.at, deviceId: 'backup', appVersion: env.appVersion }
  }
  // 兼容裸 state
  if (env && env.version && env.settings && Array.isArray(env.transactions)) {
    return { data: env, at: null, deviceId: 'unknown', appVersion: null }
  }
  throw new Error('云端文件不是轻语记账的快照或备份')
}

// 出厂空状态识别（无任何用户行）：用于新设备「从云端恢复」
export function isPristineState(s) {
  if (!s) return true
  if ((s.transactions || []).length || (s.accounts || []).length
    || (s.recurring || []).length || (s.invoices || []).length
    || (s.checkins || []).length || (s.feedbacks || []).length) return false
  if ((s.ledgers || []).length !== 1 || s.ledgers[0].name !== '默认账本') return false
  const cats = [...(s.categories?.expense || []), ...(s.categories?.income || [])]
  if (cats.some((c) => c.custom)) return false
  if (!s.settings || s.settings.nickname !== '轻语用户') return false
  return true
}

// v2.0.1 本机资料默认态识别：昵称/头像/头像照片都还是出厂值
// （先记账后登录的场景：资料三字段不应被当作「本机修改」与云端打架）
export function isDefaultProfileSettings(s) {
  return !!s && s.nickname === '轻语用户' && (s.avatar || '') === "svg:chick" && !s.avatarPhotoAt
}

// ---------- 一次完整同步（纯逻辑，不碰 DOM/localStorage） ----------
// transport: { get() -> {env|null, etag}, put(text, etag) -> {status}, mkcol? }
// 返回 { data, conflicts, uploaded, mode, remoteAt }
export async function syncOnce({ local, base, remoteText, remoteEtag, remoteInfo, localDevice, appVersion, transport }) {
  let remote = null
  if (remoteText != null) {
    try { remote = parseRemote(remoteText) } catch (e) {
      throw new Error('云端文件无法识别：' + e.message)
    }
  }

  // 新设备空库且云端有数据：直接以云端为准（云恢复），避免空模板被当成本地新增
  const pristine = !base && isPristineState(local)
  let merged
  let mode
  if (pristine && remote) {
    merged = { data: deepClone(remote.data), conflicts: [] }
    mode = 'restore'
  } else if (!remote) {
    merged = { data: deepClone(local), conflicts: [] }
    mode = base ? 'local' : 'first-upload'
  } else {
    // v2.0.1 登录后自动拉齐用户资料：本机资料还是出厂默认（先记账后登录场景）时，
    // 先把云端昵称/头像预置进本机再合并——避免默认值被当成「本机修改」与云端不确定打架，
    // 保证登录后昵称/头像确定性跟云端走（账单/总结数据本就走行级/LWW 合并，无需处理）
    let localEff = local
    if (isDefaultProfileSettings(local.settings) && remote.data.settings) {
      localEff = deepClone(local)
      localEff.settings.nickname = remote.data.settings.nickname
      localEff.settings.avatar = remote.data.settings.avatar || "svg:chick"
      localEff.settings.avatarPhotoAt = remote.data.settings.avatarPhotoAt ?? null
    }
    merged = mergeStates(base, localEff, remote.data, {
      localDevice,
      remoteDevice: remote.deviceId || 'remote',
    })
    mode = 'merge'
  }

  const snapshot = makeSnapshot(merged.data, localDevice, appVersion)
  const text = JSON.stringify(snapshot)
  let putEtag = remoteEtag || null
  try {
    await transport.put(text, putEtag)
  } catch (e) {
    // 412/409：云端在我们下载后被别的设备改过，重新拉取合并一次再上传
    if (e && (e.status === 412 || e.status === 409)) {
      const fresh = await transport.get()
      if (fresh && fresh.env) {
        const remote2 = parseRemote(fresh.env)
        const again = mergeStates(merged.data, local, remote2.data, {
          localDevice,
          remoteDevice: remote2.deviceId || 'remote',
        })
        const snap2 = makeSnapshot(again.data, localDevice, appVersion)
        await transport.put(JSON.stringify(snap2), fresh.etag || null)
        return { data: again.data, conflicts: again.conflicts, uploaded: true, mode: 'merge-retry', remoteAt: remote2.at }
      }
    }
    throw e
  }
  return { data: merged.data, conflicts: merged.conflicts, uploaded: true, mode, remoteAt: remote?.at || null }
}
