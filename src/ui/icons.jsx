/* v2.5 图标体系：iconify 开源集 SVG 内联（tabler 线性 MIT / simple-icons 品牌图标 CC0），
 * 全部 stroke|fill=currentColor——颜色随上下文继承，深浅模式自动适配，彻底替代系统级组件的 emoji 字形。
 * 用户可自定义的实体（分类/账本/AI 形象选择）仍走原 emoji 体系，不受影响。
 */
import wallet from '../assets/icons/tabler-wallet.svg?raw'
import chartBar from '../assets/icons/tabler-chart-bar.svg?raw'
import compass from '../assets/icons/tabler-compass.svg?raw'
import user from '../assets/icons/tabler-user.svg?raw'
import userCircle from '../assets/icons/tabler-user-circle.svg?raw'
import targetArrow from '../assets/icons/tabler-target-arrow.svg?raw'
import buildingBank from '../assets/icons/tabler-building-bank.svg?raw'
import book2 from '../assets/icons/tabler-book-2.svg?raw'
import books from '../assets/icons/tabler-books.svg?raw'
import wand from '../assets/icons/tabler-wand.svg?raw'
import camera from '../assets/icons/tabler-camera.svg?raw'
import creditCard from '../assets/icons/tabler-credit-card.svg?raw'
import trendingDown from '../assets/icons/tabler-trending-down.svg?raw'
import pigMoney from '../assets/icons/tabler-pig-money.svg?raw'
import briefcase from '../assets/icons/tabler-briefcase.svg?raw'
import bolt from '../assets/icons/tabler-bolt.svg?raw'
import home from '../assets/icons/tabler-home.svg?raw'
import currencyDollar from '../assets/icons/tabler-currency-dollar.svg?raw'
import receipt from '../assets/icons/tabler-receipt.svg?raw'
import download from '../assets/icons/tabler-download.svg?raw'
import repeat from '../assets/icons/tabler-repeat.svg?raw'
import bellRinging from '../assets/icons/tabler-bell-ringing.svg?raw'
import heartHandshake from '../assets/icons/tabler-heart-handshake.svg?raw'
import usersGroup from '../assets/icons/tabler-users-group.svg?raw'
import palette from '../assets/icons/tabler-palette.svg?raw'
import brandQq from '../assets/icons/tabler-brand-qq.svg?raw'
import messageCircle from '../assets/icons/tabler-message-circle.svg?raw'
import droplet from '../assets/icons/tabler-droplet.svg?raw'
import typography from '../assets/icons/tabler-typography.svg?raw'
import robot from '../assets/icons/tabler-robot.svg?raw'
import deviceGamepad from '../assets/icons/tabler-device-gamepad.svg?raw'
import bilibili from '../assets/icons/simple-icons-bilibili.svg?raw'
import tiktok from '../assets/icons/simple-icons-tiktok.svg?raw'
import tencentqq from '../assets/icons/simple-icons-tencentqq.svg?raw'

export const ICONS = {
  wallet, chartBar, compass, user, userCircle, targetArrow, buildingBank, book2, books,
  wand, camera, creditCard, trendingDown, pigMoney, briefcase, bolt, home, currencyDollar,
  receipt, download, repeat, bellRinging, heartHandshake, usersGroup, palette, brandQq,
  messageCircle, droplet, typography, robot, deviceGamepad, bilibili, tiktok, tencentqq,
}

/* size：px；iconify SVG 内建 width/height=1em，经 fontSize 控制尺寸 */
export function Icon({ name, size = 22, color, className = '', style = {} }) {
  const svg = ICONS[name]
  if (!svg) return null
  return (
    <span
      className={`qy-ico ${className}`}
      style={{ fontSize: size, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden="true"
    />
  )
}

/* 品牌社交图标（simple-icons 单色 → 品牌色染色） */
export const BRAND_COLORS = {
  bilibili: '#00A1D6',
  tiktok: '#161823', // 抖音音符 logo（深色模式下浅色渲染由调用处传色）
  tencentqq: '#12B7F5',
  xiaoheihe: '#3E8FF7', // 小黑盒无开源品牌图标，用 gamepad + 黑盒蓝近似
}
