# 实施状态

## 当前状态

- 当前阶段：**P01 已完成并通过门禁**
- 下一阶段：P02 单用户基础与 SQLite/Drizzle 数据模型（仅可按下列只读入口启动）
- 当前分支：`personal/asset-library-mvp`
- P00 基线提交：`d5f4d3e3586058c560a5c8ae2af97a4e67a639f6`
- 上游基线：`upstream/main` @ `15b1a2713894bcde36a848d997f51d67760b441c`
- P01 决策：`docs/implementation/ADR-P01-local-owner-mvp.md`

## P01 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 审计范围 | 完整读取 MASTER_PLAN、P00 状态/handoff、AGENTS 和 P00 指定 API/Web/shared 入口；只读追踪身份、协作、存储、网络、迁移和测试横切依赖 |
| 数据库 | 上游已是 better-sqlite3 + Drizzle SQLite，不存在待迁移的 Postgres 实现；但仅有 `drizzle-kit push`，没有提交的迁移目录 |
| 身份 | 上游不是 SSO/OIDC，而是 Lucia/CUNY 邮箱注册、密码、邮件验证和 session；MVP 活动入口将整体隔离身份/admin 链路 |
| 多人能力 | `users.role/status`、`deck_access`、sharing、lock、presence 及前端共享/心跳是横切耦合；决定从 composition root 整体卸载，不逐个硬编码放行 |
| 存储 | 上游 `apps/api/uploads/{deckId}` 是本地可变文件存储，不是 SHA-256 CAS；未发现 S3 实现，P04 新建本地内容寻址存储 |
| localhost | API 当前未显式设置 `hostname`，所以日志打印 localhost 不能证明仅本机监听；P02 必须用 loopback 绑定和负向连接/Host/Origin 测试证明 |
| Job/Chromium | 没有产品级持久化 Job/Worker；已有 Playwright Chromium 仅是 E2E 工具，不等于安全预览实现 |
| 预览/导出 | 当前字符串 renderer/CSP 仍允许多类公网资源和外部 iframe；只可局部复用，不得在 P05/P08 前认定安全预览或可追溯导出完成 |
| 目标模型 | 明确 `TemplateAsset`、不可变 `TemplateVersion`、`Presentation`、固定版本 `PresentationItem`、内容对象、Jobs、AuditEvent；不建 User/Organization/RoleBinding/approval |
| 最小路径 | 新建 loopback 本机产品 composition root；旧 CUNY 身份/协作/在线能力不挂载；按 P02-P09 渐进切换，不把 Deck/Slide 直接改名成目标域 |
| 数据迁移 | P00 无获授权的业务数据源；采用新目标 SQLite 的前向迁移，不复制 CUNY users/decks/templates/artifacts/uploads，不执行破坏性 drop/reset |
| 资产/远程边界 | 未导入或修改真实 `02_HTML_PPT_组件与模板` HTML/素材；未改 remote、未 push、未发布或部署 |

## P01 修改路径

- `docs/implementation/ADR-P01-local-owner-mvp.md`
- `docs/implementation/STATUS.md`
- `docs/implementation/handoffs/P01.md`

没有修改 `apps/`、`packages/`、`templates/`、测试、依赖、配置或 sibling 真实资产。

## P01 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 上游架构审计 | 通过 | ADR 第 2 节逐项记录已验证事实与差距 |
| 最小改造 ADR | 通过 | ADR 第 1、3、5、8、10 节固定活动依赖图和分阶段路径 |
| 模块映射 | 通过 | ADR 第 4 节映射入口、处理方式、目标阶段和禁止捷径 |
| 数据迁移顺序 | 通过 | ADR 第 6、7 节定义模型不变量、前向切换和停止条件 |
| 禁改区 | 通过 | ADR 第 9 节明确真实资产、远程、发布、阶段越界和破坏性清理禁令 |
| 单 Owner/localhost/本地技术栈 | 通过（架构决策） | ADR 明确固定 OwnerContext、SQLite/Drizzle、CAS、local Job、Chromium；实现仍是 P02-P05 门禁 |

**P01 门禁结论：通过。** 只授权自动创建 P02，不代表 P02 产品能力已实现。

## P02 只读入口

P02 开始时必须先读取：

1. `docs/implementation/MASTER_PLAN.md`
2. 本文件 `docs/implementation/STATUS.md`
3. `docs/implementation/ADR-P01-local-owner-mvp.md`
4. `docs/implementation/handoffs/P01.md`
5. `AGENTS.md`
6. `package.json`、`apps/api/package.json`、`apps/api/drizzle.config.ts`、`.gitignore`
7. `apps/api/src/index.ts`、`apps/api/src/env.ts`、`apps/api/src/db/index.ts`、`apps/api/src/db/schema.ts`
8. 身份/协作隔离参考：`apps/api/src/auth/lucia.ts`、`apps/api/src/middleware/{auth,admin,deck-lock}.ts`、`apps/api/src/routes/{auth,admin,sharing}.ts`
9. 活动路由耦合检索入口：`apps/api/src/routes/{decks,files,resources,preview,export,chat,plan,search}.ts`
10. Web 身份/协作隔离入口：`apps/web/src/routes/(app)/+layout.svelte`、`apps/web/src/routes/(app)/+page.svelte`、`apps/web/src/routes/(app)/deck/[id]/+page.svelte`、`apps/web/src/lib/{api.ts,stores/auth.ts}`、共享/Presence 组件调用点
11. 测试入口：`vitest.config.ts`、`playwright.config.ts`、`tests/run_all.sh` 和现有 DB/API 相关测试约定

## P02 目标与完成门禁

P02 仅实现单用户基础和数据模型：

1. Web/API（及若启动 Worker）显式绑定 loopback；非 loopback 连接、Host 和 Origin 有可重复的拒绝证据。
2. 固定 `OwnerContext` 不依赖 cookie/header/User 表；活动入口不挂载 auth/admin/sharing/presence/lock 和在线 provider 路由。
3. SQLite 只接受固定本机 `file:` 路径；提交编号化 Drizzle/SQL migrations，空库与已有目标库都可重复迁移。
4. 目标 schema 表达 ADR 第 6 节不变量，且不存在 User/Organization/RoleBinding/approval/RBAC schema。
5. 迁移前有现有 DB 预检/备份/哈希；发现未知非临时数据则停止，不得 drop/reset 或自行转换。
6. 单元/迁移/负向安全测试、构建和适用的原版测试通过；真实 `02` HTML/素材仍未读取导入或改动。
7. 更新 STATUS 和 P02 handoff 后，才可判定是否创建 P03。

## P02 禁改区

- `/Users/rosswang/Desktop/HTML - PPT/02_HTML_PPT_组件与模板` 的真实 HTML/素材；P02 不扫描、不导入、不复制、不改写。
- P03 模拟模板、P04 CAS/Job 行为、P05 Chromium 安全预览、P06 UI、P07 汇报旅程、P08 导出及后续功能。
- `upstream` 远程、push、发布、部署、域名/nginx/云环境和凭据。
- 未知数据库/上传文件、上游历史或用户无关改动；禁止破坏性 reset/drop/清理。

## 遗留风险

1. 当前 API 可能因未指定 hostname 而监听非 loopback；P02 未通过负向测试前不得声称 localhost-only。
2. auth/RBAC 在多数路由内联，切换 composition root 后仍需 `rg` 和运行时路由清单证明旧能力不可达。
3. 当前 schema、CUNY seed、Deck/Slide editor 与目标域差异大；最小路径是新目标 schema，不允许机械重命名或无证据转换。
4. 当前预览/导出存在公网字体、图片、地图、视频和 artifact URL；P05 前必须保持隔离状态。
5. 仓库有 Bedrock/SES/SMTP/AI/搜索依赖，但没有 S3；清理依赖应在活动引用清零后分阶段做，不能在 P02 顺手大改。
6. localhost:3001 在 P00 时被未知进程占用；P02 启动验证须使用明确空闲端口或只读确认占用者，不得终止未知进程。
7. 根 `pnpm check` 依赖本机未安装的 bun；仍须使用仓库声明的 pnpm 9.15.0 和可执行的 build/test/Web check 形成证据，除非 P02 明确、最小地修正工具链。
