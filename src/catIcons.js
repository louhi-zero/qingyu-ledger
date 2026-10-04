import { ICON_CATALOG, isLibraryIcon } from './iconRegistry.js'

export const CAT_ICONS = Object.fromEntries(['expense', 'income', 'func'].map(group => [group, ICON_CATALOG.filter(icon => icon.group === group)]))
export const ALL_CAT_ICONS = [...CAT_ICONS.expense, ...CAT_ICONS.income, ...CAT_ICONS.func]
export const EXTRA_ICONS = ICON_CATALOG.filter(icon => icon.group === 'extra')
export const isImgIcon = isLibraryIcon
