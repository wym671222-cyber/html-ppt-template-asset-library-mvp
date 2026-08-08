# HTML 模板平台实施总计划

## 基线与边界

- 产品仓库：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 上游：`https://github.com/CUNY-AI-Lab/slide-maker.git`，只保留为 `upstream`，不配置可写远程。
- 当前基线：`15b1a2713894bcde36a848d997f51d67760b441c`（`upstream/main`，2026-08-07）。
- 当前分支：`personal/asset-library-mvp`。
- 运行范围：单一 Owner、仅本机 localhost、SQLite/Drizzle、本地 SHA-256 内容寻址存储、本地 Job、Playwright/Chromium；不商用、不发布、不推送。
- 禁止范围：SSO、Postgres、S3、多人角色/RBAC、审批、真实 `02_HTML_PPT_组件与模板` HTML/素材导入，以及 P10 后的自动扩展。

## 交接规则

下一阶段只能在前一阶段的 `STATUS.md`、handoff 和可重复命令证明门禁通过后创建。每一阶段仅实施本阶段目标；未验证项必须留为风险而不能写作完成。

| 阶段 | 指定执行模型 / 思考 | 目标 | 完成门禁 |
|---|---|---|---|
| P00 | terra / high | 源码落地与基线 | 上游、分支、依赖、原版验证、交接文件和干净工作树已记录 |
| P01 | sol / xhigh | 架构审计与改造 ADR | 只读完成模块映射、最小改造 ADR、数据迁移顺序和禁改区 |
| P02 | terra / high | 单用户基础与数据模型 | SQLite/Drizzle 的单 Owner 边界及迁移通过验证 |
| P03 | luna / medium | 模拟模板与适配器 | 仅用新建模拟模板完成 v1 契约/适配器验证 |
| P04 | terra / high | 资产目录后端 | 内容寻址对象、本地 Job、校验、索引与状态持久化通过 |
| P05 | sol / xhigh | 安全预览与缩略图 | Playwright/Chromium 网络隔离、预览与缩略图可验证 |
| P06 | sol / high | 三栏资产库界面 | localhost 搜索、筛选、预览和资产卡片核心旅程通过 |
| P07 | terra / high | 购物车与汇报持久化 | 排序、复制、修订和固定 TemplateVersion 通过 |
| P08 | sol / xhigh | HTML/ZIP 导出闭环 | manifest、来源哈希、离线打开和失败诊断通过 |
| P09 | sol / xhigh | 集成加固与恢复演练 | 故障边界、本机备份/恢复和安全回归通过 |
| P10 | terra / high | MVP 验收与交付 | 全部 MVP 验收通过；随后停止 |

## 未来扩展接口（不提前实现）

| MVP 实现 | 后续可替换接口 |
|---|---|
| 固定的 `OwnerContext` | 身份、组织与角色授权适配器 |
| SQLite/Drizzle repository | Postgres repository/迁移适配器 |
| 本机 SHA-256 对象目录 | S3 兼容对象存储适配器 |
| SQLite Job 表/本机 Worker | 外部队列/Worker 适配器 |
| localhost 预览 | 独立 preview origin/部署配置 |

这些边界用于抑制耦合；在有实际需求和明确授权前，不引入相应服务或配置。

## 全局不变量

1. `TemplateVersion` 不可变，历史 `PresentationItem` 永远固定其版本和内容哈希。
2. 包、缩略图和导出物以内容哈希追加写入；失败不能覆盖已验证物。
3. 不从 `02_HTML_PPT_组件与模板` 导入、移动或改写真实素材；P03 只新建模拟数据。
4. 用户内容只能写入 schema 声明的 slot，不能作为 HTML/CSS/JS 执行。
5. 预览/截图/导出必须限制为 localhost 和包内资源；外部网络、宿主 cookie、父目录和外部 iframe 默认禁止。
6. 每个阶段结束更新 `STATUS.md` 和本阶段 handoff，验证结果须包含命令、结果、环境限制和遗留风险。
