# 轻语记账 QingYu Ledger

> 隐私优先的轻量记账 App —— 数据只留本机，三秒记完一笔账

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.6.4-4c7dff)

一款本地优先的个人记账应用：Android 手机端（Capacitor 打包 APK）+ Windows 桌面端（Electron），同一套代码双端运行，账单数据通过坚果云在设备间同步。

## ✨ 功能亮点

**记账核心**
- 支出 / 收入 / 转账三种类型，多账本管理
- 交易标签、报销管理、记账模板、附件照片
- 熬夜归属：凌晨 0–5 点记账默认算前一天（记「昨晚」更顺手）
- 自定义数字键盘，两档小数位限制，纯整数金额运算避免浮点误差

**智能化**
- 智能填单：一句话记一笔（GLM 解析 + 本地正则兜底，无 Key 也能用）
- 扫票 OCR：GLM-4V 识别小票，原图自动存为附件
- AI 月度 / 年度账单解读（智谱 GLM，流式输出，API Key 仅保存在本机）

**资产体系**
- 账户 / 信用卡（账单日、还款日、应还提醒）/ 债务 / 储蓄目标
- 多币种：汇率表 + 换算器，账本按基础币种折算
- 净资产趋势：每日快照 + 30 天 SVG 曲线

**统计与预算**
- 月 / 年账单视图，手写 SVG 图表（零图表库依赖）
- 分类占比、同比环比、周视图（周一起始）、自定义账期（每月 1–28 日起始）
- 预算监控与超支提醒、AI 账单点评

**通知监控（Android）**
- 读取微信 / 支付宝的收支通知，解析金额后弹窗确认入账（**不静默记账**）
- 需在系统「通知使用权」中手动授权，可随时关闭

**数据安全**
- 回收站：删除账单 30 天内可恢复，附件一并保留
- 坚果云 WebDAV 云同步：行级合并、乐观锁防覆盖、冲突副本保留
- 全量备份 / 恢复（JSON 信封格式，兼容旧版本）
- 月账单 PDF 导出、每日记账提醒（本地通知）

**界面体验**
- 液态玻璃 UI：壁纸晕光 + 毛玻璃材质，可一键开关（关闭省电）
- 深色模式、点击反馈（按压缩放 + 8ms 轻震动）
- 二级设置菜单，430px 手机壳式布局

## 📱 下载安装

| 平台 | 获取方式 |
|---|---|
| Android | [Releases](../../releases) 下载 `qingyu-*-android.apk`，允许安装未知来源应用后覆盖安装，数据自动保留 |
| Windows | [Releases](../../releases) 下载桌面安装包，或本地 `npm run desktop:build` 构建 |

## 🛠 技术栈

- **构建**：Vite 5 + React 18（无 UI 框架，自研 hash 导航 + Context 状态管理）
- **移动端**：Capacitor 7（仅 Android），本地插件实现通知监听
- **桌面端**：Electron 33
- **存储**：localStorage（结构化数据）+ IndexedDB（图片/blob 资产），金额以最小货币单位整数存储
- **图表**：全部手写 SVG，零第三方图表库

## 🚀 本地开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（手机壳预览）
npm run build      # 生产构建
npm run desktop:build  # Windows 桌面安装包
```

测试命令：

```bash
npm run test:unit   # 纯函数单元测试（24 项）
npm run test:sync   # 云同步合并回归（23 项断言）
npm run test:smoke  # Electron 集成冒烟（25 项断言）
```

## 📦 版本发布

推送 `v*` 标签（如 `v1.6.5`）即自动触发 GitHub Actions：

1. 云端构建 Android APK（JDK 21 + Android SDK）
2. 自动创建 GitHub Release 并附上重命名后的 APK
3. 自动生成版本变更说明

配置签名 Secrets（`ANDROID_KEYSTORE` 等，见 workflow 末尾注释）后，可额外产出签名 release APK。

## 🔒 隐私说明

- 账单、分类、账户等数据**默认仅存本机**，不上传任何服务器
- 云备份需用户自行配置坚果云账号，凭据仅存本机
- AI 功能需用户自行填写 API Key，Key 不随云备份上传、不出本机
- 通知监控仅解析通知中的金额文本，可在设置中一键关闭

## 📄 许可证

本项目基于 [GPL-3.0-or-later](LICENSE) 许可证开源 —— 任何分发或修改版须以相同许可证开放源代码。
