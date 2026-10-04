/* v2.6 分类线性图标库（用户定制的 28 枚线性图标集：支出橙 / 收入绿 / 功能蓝）
 * 图片位于 public/icons/{cat,func}/（构建时原样拷贝进 dist），单枚 1-4KB。
 * 分类 icon 值约定：命中下方清单的 './icons/...' 路径 = 图片图标；
 * 其余值一律按 emoji 文本渲染（兼容旧数据、子分类与用户自定义 emoji）。
 */
const toList = (entries, dir) => entries.map(([key, name]) => ({ key, name, src: `./icons/${dir}/${key}.png` }))

export const CAT_ICONS = {
  // 支出类 14 枚（橙）
  expense: toList([
    ['food', '餐饮'], ['transport', '交通'], ['shop', '购物'], ['home', '居住'],
    ['medical', '医疗'], ['edu', '教育'], ['phone', '通讯'], ['travel', '旅行'],
    ['clothes', '服饰'], ['game', '娱乐'], ['pet', '宠物'], ['gift', '人情'],
    ['sport', '运动'], ['box', '日用'],
  ], 'cat'),
  // 收入类 6 枚（绿）
  income: toList([
    ['salary', '工资'], ['bonus', '奖金'], ['invest', '理财'],
    ['interest', '利息'], ['reimburse', '报销'], ['transfer', '转账'],
  ], 'cat'),
  // 功能类 8 枚（蓝）——页面与操作语义，同样可用于分类
  func: toList([
    ['bill', '账单'], ['stats', '统计'], ['budget', '预算'], ['account', '账户'],
    ['calendar', '日历'], ['search', '搜索'], ['settings', '设置'], ['backup', '备份'],
  ], 'func'),
}

export const ALL_CAT_ICONS = [...CAT_ICONS.expense, ...CAT_ICONS.income, ...CAT_ICONS.func]

// 白名单判断：仅认可的图标库路径按图片渲染，未知值回落 emoji，避免打印路径文本
const IMG_SET = new Set(ALL_CAT_ICONS.map((i) => i.src))
export function isImgIcon(icon) {
  return typeof icon === 'string' && IMG_SET.has(icon)
}
