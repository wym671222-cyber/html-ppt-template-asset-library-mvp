# 实施状态

## 当前状态

- 当前阶段：**P03 已完成并通过门禁**
- 下一阶段：P04 资产目录后端（仅在 P03 handoff 与可重复命令证明通过后启动）
- 当前分支：`personal/asset-library-mvp`
- P00 基线提交：`d5f4d3e3586058c560a5c8ae2af97a4e67a639f6`
- 上游基线：`upstream/main` @ `15b1a2713894bcde36a848d997f51d67760b441c`
- P01 决策：`docs/implementation/ADR-P01-local-owner-mvp.md`
- P02 决策与证据：`docs/implementation/handoffs/P02.md`

## P03 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| v1 契约 | 新增 `packages/shared/src/template-package.ts` 与 `docs/implementation/contracts/template-package-v1.md`；manifest、显式 files、包内 entry、text/color slots、绑定规则和拒绝条件已固定 |
| 模拟包 | 仅新建 `fixtures/p03-simulated-template/`，包含 manifest、index.html、styles.css；未引用、扫描、读取、复制或改写 sibling `02_HTML_PPT_组件与模板` |
| 适配器 | `apps/api/src/templates/simulated-adapter.ts` 只读取 manifest 声明文件，校验后生成内存中的 asset/version 形状；计算确定性 source SHA-256；`contentObjectDigest` 固定为 null |
| 阶段边界 | 未写 SQLite、CAS 对象、Job、浏览器预览、UI、Presentation 旅程或导出；未挂载新 API 路由 |
| 测试 | 新增 `tests/p03-template-adapter.test.ts`，覆盖适配、确定性、无副作用、路径/脚本/外链/未声明 slot 拒绝和纯契约错误；4/4 通过 |

## P03 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 模拟包与 v1 契约 | 通过 | `node_modules/.bin/vitest run tests/p03-template-adapter.test.ts`：4 tests passed |
| 全量单测与 shell | 通过 | `node_modules/.bin/vitest run`：22 files/703 tests；`bash tests/run_all.sh`：8/8 suites |
| 类型/构建回归 | 通过 | shared/API `tsc --noEmit` 通过；Web `svelte-check` 0 errors、9 个既有 warnings；Web build 命令需在 `apps/web` 工作目录执行 |
| 边界与差异 | 通过 | `git diff --check`；P03 代码/fixture/docs/tests 无 sibling 真实资产路径引用 |
| 未实现阶段越界能力 | 通过 | 适配器无 DB/CAS/Job/preview/UI/presentation/export 入口；`contentObjectDigest` 未提前登记 |
| 环境限制 | 已记录 | 根 `pnpm build` 的 pnpm 10 lifecycle-script approval 限制沿用 P02；本阶段已用直接 TypeScript、Vitest、shell 和 Web 检查验证 |

**P03 门禁结论：通过。** P04 可在新 handoff 约束下继续；P05-P08 仍未授权。

## P02 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 组合根 | API 只挂载 `/`、`/api/health`、`/api/owner`；旧 auth/admin/sharing/deck lock/presence/provider/在线路由均返回 404，未被导入活动组合根 |
| 单 Owner | `OwnerContext` 固定为 `local-owner`，实现和测试均不读取 cookie、header 或 User 表；目标 schema 没有用户、组织、角色、审批或 RBAC 表 |
| Loopback | API `serve` 和 Vite dev/preview 显式绑定 `127.0.0.1`；API/Web 运行时均验证本机 200、LAN 地址连接失败，API 伪造 Host/外部 Origin 分别为 421/403 |
| Web 活动入口 | 根页仅显示 P02 基础状态；hook 拒绝非 loopback Host、外部 Origin 与所有非 `/`、`/_app/` 路径，旧 `/login` 返回 404；旧页面文件只保留为未达的上游历史 |
| SQLite/迁移 | 固定 `apps/api/data/asset-library.db`，不接受 `DATABASE_URL` 替代路径；提交 `0000_p02_foundation.sql` 和 Drizzle journal；迁移前 quick_check、目标表清单、备份和 SHA-256 均完成 |
| 数据安全 | 空库、已有目标库重复迁移与未知 `users` 表的“备份后停止”均有单元测试；实际目标库重复迁移已产生备份及 SHA-256，未执行 drop/reset/旧数据转换 |
| 目标不变量 | SQL 外键、唯一索引与触发器覆盖版本号唯一、current version 归属/已验证、已验证版本不可改删、内容/审计追加写入、revision 单调、固定版本、连续位置、slot schema、成功 Job 输出不可由失败覆盖 |
| 禁区 | 未读取/修改 sibling `02_HTML_PPT_组件与模板`，未改 remote、push、发布、部署、域名、nginx 或云环境；未实现 P03-P08 行为 |

## P02 修改路径

- `apps/api/{drizzle.config.ts,package.json,tsconfig.json,drizzle/**,src/{app.ts,owner.ts,index.ts,env.ts,db/{index.ts,migrate.ts,paths.ts,schema.ts}}}`
- `apps/web/{vite.config.ts,src/hooks.server.ts,src/routes/+layout.svelte,src/routes/(app)/{+layout.svelte,+page.svelte}}`
- `package.json`、`tests/{p02-foundation.test.ts,test_shared_types.sh,test_validation.sh}`
- `e2e/p02-foundation.spec.ts`、`playwright.p02.config.ts`
- 本文件与 `docs/implementation/handoffs/P02.md`

## P02 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| loopback 正/负向 | 通过 | 独立 3017/5174 进程分别仅监听 `127.0.0.1`；loopback 200，`192.168.124.29` 连接失败；API Host 421、Origin 403，Web 非 loopback Host/Origin 403 |
| 固定 Owner 与旧能力不可达 | 通过 | P02 单测、API 404 路由断言、Web `/login` 404、活动端点静态清单 |
| 编号迁移与 DB 安全 | 通过 | `tests/p02-foundation.test.ts` 空库/重复/未知库覆盖；实际 `tsx src/db/migrate.ts` 对现有目标库预检、备份、SHA-256、quick_check、foreign_keys 通过 |
| 目标 schema | 通过 | P02 单测验证无 User/Organization/RoleBinding/approval/RBAC 表，以及关键唯一性和不可变触发器 |
| unit/shell/build/Web/E2E | 通过（组件级） | `vitest run` 21 files/699 tests；`bash tests/run_all.sh` 8/8；API `tsc`、Web Vite build、svelte-check（0 errors）和 P02 Playwright（1 passed）通过 |
| 环境限制 | 已记录 | 根 `pnpm build`/Turbo 由桌面运行时的 pnpm 10 lifecycle-script approval 阻断，非代码或类型失败；直接执行 API/Web 构建均通过。P02 Playwright 缺少其锁定浏览器，已以本机 Google Chrome 的显式 executablePath 完成同一 Chromium 用例。 |

**P02 门禁结论：通过。** P03 现在获授权创建，但 P03 仅可实施模拟模板 v1 契约/适配器，不得提前实现 CAS、Job、预览、UI、汇报或导出。

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

1. P02 已以独立 3017/5174 端口证明 loopback-only；3001/5173 仍被未知既有进程占用，后续验证必须继续选取空闲端口，绝不终止未知进程。
2. auth/RBAC/协作旧源码仍保留并使 Svelte build 产生既有 warnings，但其 API/网页路由已不在活动组合根；后续阶段不得重新挂载它们。
3. 当前 preview/export legacy 路径仍允许公网资源，但 P02 未挂载；P05/P08 前必须继续隔离，不能把它们当作安全能力。
4. 仓库仍声明 Bedrock/SES/SMTP/AI/搜索依赖；它们不在活动引用图。不要在 P03 顺手清理或重新启用这些依赖。
5. 根 `pnpm build` 在桌面运行时的 pnpm 10 lifecycle-script approval 处阻断；直接 API/Web build、unit、shell 和 P02 E2E 已通过。应在工具链 owner 授权后再处理 pnpm 9/10 一致性，而不是在产品阶段改变依赖策略。
