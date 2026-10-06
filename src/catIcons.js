import { ICON_CATALOG, isLibraryIcon, GIRL_KEYS } from './iconRegistry.js'

export const CAT_ICONS = Object.fromEntries(['expense', 'income', 'func'].map(group => [group, ICON_CATALOG.filter(icon => icon.group === group)]))
export const ALL_CAT_ICONS = [...CAT_ICONS.expense, ...CAT_ICONS.income, ...CAT_ICONS.func]
export const EXTRA_ICONS = ICON_CATALOG.filter(icon => icon.group === 'extra')
// v3.1 少女线稿风分组：存 girl:<key>，缩略图直连 public/girl/<key>.png
export const GIRL_ICONS = ICON_CATALOG
  .filter(icon => GIRL_KEYS.has(icon.key))
  .map(icon => ({ ...icon, src: `girl:${icon.key}`, thumb: `./girl/${icon.key}.png` }))
export const isImgIcon = isLibraryIcon
