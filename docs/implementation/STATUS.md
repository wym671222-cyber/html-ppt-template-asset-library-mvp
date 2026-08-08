# 实施状态

## 当前状态

- 当前阶段：**P00 已完成并通过门禁**
- 下一阶段：P01 架构审计与改造 ADR（仅可读取下列指定资料和入口）
- 当前分支：`personal/asset-library-mvp`
- 上游基线：`upstream/main` @ `15b1a2713894bcde36a848d997f51d67760b441c`

## P00 完成事实

| 项目 | 已验证事实 |
|---|---|
| 目标路径 | 克隆前确认不存在；上游已克隆至固定产品目录，未覆盖既有目录 |
| 远程 | `origin` 已更名为 `upstream`；无其他远程；未推送 |
| 分支 | 已从精确上游 commit 创建并切换到 `personal/asset-library-mvp` |
| 工具链 | Node `v24.18.0`；仓库声明 pnpm `9.15.0`；当前全局 pnpm `11.16.0` 不兼容其构建许可策略，实际验证采用 `npx --package pnpm@9.15.0` |
| 依赖 | `pnpm@9.15.0 install --frozen-lockfile` 成功；`better-sqlite3` 在 `apps/api` 成功加载，esbuild 成功运行 |
| 原版构建 | 成功；上游有 Svelte a11y/动态导入/大 chunk 等 warning，但无 build error |
| 原版测试 | 成功：Vitest 20 文件、695 tests；shell suite 8/8 通过 |
| 类型检查 | `apps/web` svelte-check：0 error、10 warnings |
| 最小启动 | API 以临时 SQLite 在 `http://localhost:3101` 启动；`/api/health` 与 `/` 均返回 200/`status: ok`；Web Vite dev server 返回 `HTTP 200` |

## 已修改路径

- 本父项目计划：`/Users/rosswang/Desktop/HTML - PPT/02_HTML_PPT_组件与模板/HTML汇报模板资产管理与组装平台-详细实施计划.md`
- 本仓库实施链：`docs/implementation/MASTER_PLAN.md`
- 本仓库状态账本：`docs/implementation/STATUS.md`
- 本仓库交接模板：`docs/implementation/HANDOFF_TEMPLATE.md`
- 本阶段交接：`docs/implementation/handoffs/P00.md`

## P01 只读入口

P01 必须先读取：

1. `docs/implementation/MASTER_PLAN.md`
2. 本文件 `docs/implementation/STATUS.md`
3. `docs/implementation/handoffs/P00.md`
4. `AGENTS.md`（仅仓库约束）
5. `apps/api/src/index.ts`、`apps/api/src/db/schema.ts`、`apps/api/src/db/seed.ts`
6. `apps/api/src/routes/resources.ts`、`apps/api/src/routes/decks.ts`、`apps/api/src/routes/export.ts`、`apps/api/src/routes/preview.ts`
7. `apps/api/src/export/index.ts`、`apps/api/src/export/html-renderer.ts`
8. `apps/web/src/routes/(app)/+page.svelte`、`apps/web/src/lib/components/resources/`、`apps/web/src/lib/components/editor/`
9. `packages/shared/src/types.ts`、`packages/shared/src/mutations.ts`、`packages/shared/src/block-types.ts`

P01 不得先修改上述入口；先产出 ADR、模块映射、迁移顺序和禁改区，再按其门禁衔接 P02。

## 遗留风险

1. 上游默认启用 CUNY 邮箱认证、AI provider、管理后台和协作能力；P01 必须确定单 Owner localhost 的最小剥离路径，P00 未做产品改造。
2. 原版根脚本 `pnpm check` 依赖 `bun`，本机未安装 bun；已直接运行其可用的 Web `svelte-check`，结果为 0 error。P01 应决定是否将工具链固定为上游版本或另行记录。
3. 本机 port 3001 已被其他进程占用；P00 使用 3101 验证 API，未影响该进程。后续开发前应选择空闲 localhost 端口或按明确授权检查占用者。
4. API 健康验证未配置 AI/邮件/图片搜索凭据；其对应功能按设计不可用，且不阻断 P01 的架构审计。
