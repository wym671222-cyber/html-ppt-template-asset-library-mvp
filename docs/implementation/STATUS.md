# 实施状态

## 当前状态

- 当前阶段：**P06 已完成并通过门禁**
- 下一阶段：P07 购物车与汇报持久化（仅在本文件、`docs/implementation/handoffs/P06.md` 和 P06 原子提交证明通过后创建）
- 当前分支：`personal/asset-library-mvp`
- P00 基线提交：`d5f4d3e3586058c560a5c8ae2af97a4e67a639f6`
- 上游基线：`upstream/main` @ `15b1a2713894bcde36a848d997f51d67760b441c`
- P01 决策：`docs/implementation/ADR-P01-local-owner-mvp.md`
- P02 决策与证据：`docs/implementation/handoffs/P02.md`

## P06 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 三栏 localhost UI | 活动根页改为单 Owner 资产库：左栏有界搜索/分类/多标签筛选，中栏稳定排序资产卡片，右栏仅显示所选资产元数据与 P05 PNG；包含加载、API 错误及恢复、无结果、空库、图片失败、键盘方向键/焦点和 1080/700px 响应式状态 |
| 最小只读 catalog | `AssetLibraryCatalog` 只查询 `active` 资产、属于该资产的 `current_version_id`、`verified/available` 当前版本及同 source/renderer 的完整 preview+thumbnail PNG 对；搜索/筛选均使用参数绑定，参数名、长度、标签数和结果数有界，标题/id 稳定排序 |
| PNG 回读边界 | 客户端只提交受限 asset id 和固定 `preview|thumbnail`，没有 digest/路径/URL 参数；服务端从当前版本的 P05 登记行取得 digest，经 `LocalContentStore.read()` 重新 SHA-256，复核 CAS 相对路径、字节数、`image/png`、PNG 签名和 1280×720/320×180 尺寸后返回 `no-store` PNG |
| Web 执行边界 | Web 同源代理只转发固定 loopback API 的 JSON/PNG，代理地址必须是无凭据/路径/query 的 loopback HTTP origin；UI 只使用文本绑定与 `<img>`，没有 `{@html}`、iframe/srcdoc/blob/data URL、原始 HTML、外链、表单提交或宿主 cookie，CSP 固定 `frame/object/form-action none` 和同源 image/connect |
| Composition root | catalog 只在生产 `index.ts` 完成安全迁移后实例化并传给 P02 `createApp`；测试导入不打开实际目标库。固定 `OwnerContext`、API/Web loopback Host/Origin、GET-only CORS 和旧 auth/admin/sharing/provider/preview/export/search 路由 404 均回归通过 |
| 测试数据 | unit/API 使用仓库内唯一 P03 fixture 与隔离临时 SQLite/CAS；P06 E2E 也只登记该 fixture，并经真实 P05 `SecurePreviewRenderer`/Chrome 生成受控 PNG。没有读取、扫描、复制或改写 sibling 真实 `02_HTML_PPT_组件与模板` |
| Schema/实际库 | P06 没有 schema、migration 或实际业务数据变更。实际库仅以 `mode=ro&immutable=1` 回读：SHA-256 仍为 `a501811f7b328fd36799049a5b2596b84d385f45b036ff6f9b77720aaab1bba9`，`quick_check=ok`、`foreign_keys=1`、`foreign_key_check=0`、3 条 migration、4 个 P05 触发器，asset/version/content/job/derivative/presentation/item 均为 0 |
| 视觉验收 | Image Gen 概念基准与 1536×1024/680×900 实现截图经 `view_image` 对照；三栏容器、真白/冷灰/深墨蓝/蓝色/琥珀体系、开放式面板、选中态和详情层级一致。应用内浏览器验证 0 iframe、仅同源 favicon/PNG 资源、0 console error、无横向溢出；单卡/朴素预览是严格使用唯一 P03 fixture 的有意差异 |
| 禁区 | 未实现 P07 Presentation/购物车/排序/复制/修订、P08 export、P09/P10；未挂载旧在线能力，未引入身份/RBAC/approval、Postgres/S3/Redis/外部 Worker，未改 remote、push、发布、部署、依赖审批或凭据 |

## P06 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 搜索/筛选/选择/安全预览三栏旅程 | 通过 | `e2e/p06-asset-library.spec.ts`：真实 Chrome 3/3，覆盖加载、搜索、分类、标签、无结果、选择/PNG、方向键焦点、API 错误恢复、680px 响应式 |
| catalog 正/负向与稳定查询 | 通过 | `tests/p06-asset-library.test.ts`：有界参数、未知/重复/空标签/超限拒绝，active/current/verified 与同 renderer/source PNG pair，稳定 facets/items 且 JSON 不泄露 digest/路径/URL |
| PNG CAS/媒体安全 | 通过 | 同一测试覆盖 preview/thumbnail 原字节、任意 digest、`file:`、外部 URL query、HTML kind、missing、tampered CAS；P05 全回归继续以真实 Chrome 验证网络/cookie/DOM 隔离 |
| Owner/loopback/旧能力回归 | 通过 | P02 unit 4/4、P02 Playwright 1/1、P06 Playwright 3/3；伪造 Host 421、外部 Origin 403，旧 auth/admin/sharing/provider/preview/export/search 404 |
| DB/schema/migration 不变量 | 通过 | P06 unit 覆盖空库及已有目标库重复迁移；实际库只读 immutable 检查通过且哈希/3 migrations/schema 不变，未运行 P06 实际迁移 |
| 全量 unit/shell/type/Web | 通过 | Vitest 25 files/719 tests；shell 8/8；shared/API TypeScript；Web `svelte-check` 0 errors（9 个上游既有 warnings）与 Vite build 通过 |
| 根构建环境限制 | 已记录 | `pnpm build` 仍由 Codex pnpm 10 的 ignored lifecycle approval 阻断；未批准依赖，命令生成的 `allowBuilds` 提示占位已精确移除，工作区配置恢复 |
| 差异、真实素材与远程 | 通过 | `git diff --check`、schema/migration unchanged、实际 DB hash、固定 `upstream` remote；变更仅为 P06 catalog/UI/proxy/tests/config/docs，无真实 `02` 素材操作，无 push/发布/部署 |

**P06 门禁结论：通过。** P07 现在可按 P06 handoff 创建；P08-P10 仍不得提前实现。

## P05 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| CAS 信任边界 | `PreviewArtifactRepository` 只按已验证 `TemplateVersion.content_object_digest` 回读 P04 CAS；Job 快照 digest、version source/content digest、包 identity、P03 契约、规范序列化和 CAS 实际哈希全部重验，篡改或不一致均在启动 Chromium 前拒绝 |
| 受控预览运行时 | `SecurePreviewRenderer` 仅在随机临时目录解包 manifest 明确列出的 HTML/CSS，以随机 token 的 `127.0.0.1` 临时 origin 提供资源；Chromium 使用全新空 storage context、禁用 JavaScript/service worker/download，并由 request allowlist 默认拒绝非当前 origin、非 GET、query 和未声明路径 |
| 纵深防御 | 静态策略拒绝脚本、外链、未声明资源、CSS fetch、iframe/frame/object/embed、表单、事件属性、`target`/新窗口和父目录；响应附 strict CSP、no-referrer、nosniff，运行后回读 cookie、DOM、popup、CSP 与请求诊断，任一违规即失败 |
| 可复现派生物 | 同一 P03 fixture 两次真实 Chrome 渲染得到相同 1280×720 preview PNG 与 320×180 thumbnail PNG digest；两者先以 SHA-256 追加写 CAS，再事务登记 `template_preview_derivatives`，同 renderer identity 的冲突输出拒绝且不能覆盖既有成功记录 |
| Job/Worker | `template-preview` Job 通过 P04 `LocalJobRepository` 的按类型 claim 使用 pending→running→succeeded/failed、lease、retry 与 recover 语义；无效输入/策略错误终止失败，临时 Chromium 故障可重试，成功 Job 的 `output_digest` 固定为 preview digest，thumbnail 由同一事务登记 |
| 编号迁移 | 新增 `0002_p05_preview_derivatives.sql` 及 journal entry；派生物表以 TemplateVersion/CAS 外键、identity 唯一约束和 4 个触发器保证 verified source、PNG 类型与追加写入 |
| 实际目标库 | P04 目标库表型且业务记录为空后迁移；迁移前备份 `apps/api/data/backups/asset-library.1786204513675.pre-migration.db` SHA-256 为 `157efd172d700bf5e1782631eba5385b9f2b70f7fd610f8a3f9e337ae39255ad`，迁移后 DB SHA-256 为 `a501811f7b328fd36799049a5b2596b84d385f45b036ff6f9b77720aaab1bba9`；`quick_check=ok`、`foreign_keys=1`、`foreign_key_check=0`、3 条迁移，业务记录仍为空 |
| 禁区 | 没有读取、扫描、导入、复制、移动或改写 sibling 真实 `02_HTML_PPT_组件与模板`；没有新增 API/UI/Presentation/export 路由或身份/组织/RBAC/approval、Postgres/S3/Redis/外部 Worker；remote、push、发布与部署均未改动 |

## P05 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 只接受 P03/P04 已验证内容及负向输入 | 通过 | `tests/p05-secure-preview.test.ts` 覆盖 digest/CAS 篡改、路径/未声明资源、脚本、外链、CSS fetch、iframe、表单、新窗口及无效 Job 快照 |
| Chromium 默认拒绝与隔离 | 通过 | 实际 Google Chrome 覆盖混淆 CSS 外链的 CSP 拒绝；request policy 覆盖外网、`file:`、父目录、未声明路径和 POST；成功诊断证明只请求 2 个 loopback 包内资源且 cookie/DOM/popup/blocked 均为 0 |
| 稳定 preview/thumbnail 与追加写入 | 通过 | 两次 1280×720/320×180 实际渲染 digest 相同；派生物恒为 2 行；冲突渲染、UPDATE/DELETE 和迟到失败均不能覆盖成功输出 |
| Job 生命周期、租约、重试、恢复 | 通过 | P05 测试验证按类型 claim、瞬态失败重试、成功/失败输出隔离；P04 回归继续验证 lease 崩溃恢复、重试上限与并发 claim |
| 空库/已有库迁移与 DB 不变量 | 通过 | P05 测试覆盖空库与已有目标库重复迁移、备份哈希、quick_check/foreign_keys；实际目标库备份、哈希、foreign_key_check 和触发器数量已回读 |
| unit/shell/type/Web/E2E | 通过（组件级） | Vitest 24 files/712 tests；shell 8/8；shared/API/P05 TypeScript、Web svelte-check/Vite build 通过；P02 Playwright 以本机 Chrome 1/1 通过 |
| 根构建环境限制 | 已记录 | `pnpm build` 仍被桌面 pnpm 10 的 ignored lifecycle-script approval 阻断；命令产生的 `pnpm-workspace.yaml` 提示占位副作用已精确移除，未批准或改变依赖策略 |
| 差异与边界 | 通过 | `git diff --check`、固定 `upstream` remote 审计；变更仅为 P05 migration/schema、preview runtime/worker、Job type filter、测试和文档 |

**P05 门禁结论：通过。** P06 现在可按 P05 handoff 创建；P07-P10 仍不得提前实现。

## P04 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 本地 CAS | 新增 `apps/api/src/assets/content-store.ts`：SHA-256 决定对象身份，路径固定为本机 `data/objects/sha256/<prefix>/<digest>`；临时文件先 fsync，再以不可覆盖 hard link 落位；读取及并发遇到既有对象均重新哈希校验 |
| 模拟包登记 | `AssetCatalogRepository` 只接收 P03 适配结果和其确定性 `sourceDigest`；将同一规范化包字节写入 CAS，确认 digest 一致后，在一个 SQLite 事务内追加 `content_objects`、asset/version/tag 引用并设置已验证 current version |
| 不可变与幂等 | 已有 version 的重复登记只接受所有不可变字段完全一致；冲突元数据或内容拒绝，已验证 `TemplateVersion` 与 CAS 记录不被改写；登记无 API 路由、无真实素材扫描 |
| Job/Worker | `0001_p04_catalog_jobs.sql` 将旧 `queued/running` 安全规范化为 `pending`，新增 `max_attempts`、lease owner/expiry 及索引；`LocalJobRepository` 用 SQLite 事务 claim/recover，`LocalJobWorker.runOnce()` 是最小本机生命周期，无外部队列或 Worker |
| Job 不变量 | pending→running→succeeded/failed、租约失效恢复、重试上限、并发 claim 和成功输出不可被迟到失败覆盖都有单测与 SQL 约束；成功输出必须已有 `content_objects` 引用 |
| 实际迁移 | 已确认目标库所有表均为 P02 目标表且为空后执行；迁移前备份 SHA-256 为 `b6320848ac4805c8791f7d3805d8f58261bfe70ce31b97b0950509da2d23186d`，迁移后 DB SHA-256 为 `157efd172d700bf5e1782631eba5385b9f2b70f7fd610f8a3f9e337ae39255ad`；应用连接 `foreign_keys=1`、`quick_check=ok` |
| 禁区 | 仅使用仓库内 P03 fixture；没有读取、扫描、导入、复制、移动或改写 sibling `02_HTML_PPT_组件与模板`，没有新增预览/UI/汇报/导出、远程、push、发布或云服务 |

## P04 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| CAS 确定性、原子性及负向安全 | 通过 | `tests/p04-asset-catalog.test.ts`：相同/不同内容、路径穿越、篡改哈希、写入失败无半对象均覆盖 |
| 资产/version/CAS 事务与幂等 | 通过 | P04 测试验证 sourceDigest=CAS digest、DB 外键引用、verified current version、重复登记无重复行、冲突回滚 |
| Job 状态、租约、重试与恢复 | 通过 | P04 测试验证单一 claim、模拟崩溃后租约恢复、上限失败、Worker 成功和迟到失败拒绝 |
| 空库/已有库迁移与 DB 不变量 | 通过 | P02/P04 Vitest 覆盖空库、重复迁移及未知库停止；实际目标库备份/哈希、`quick_check`、应用连接 `foreign_keys` 通过 |
| unit/shell/type/Web/E2E | 通过（组件级） | Vitest 23 files/706 tests；shell 8/8；shared/API TypeScript、Web svelte-check/Vite build 通过；P02 Playwright 以本机 Chrome 1/1 通过 |
| 根构建环境限制 | 已记录 | `pnpm build` 被桌面 pnpm 10 的 ignored lifecycle-script approval 阻断；未为阶段任务批准或改变依赖，直接 API/shared/Web 检查已通过 |
| 差异与边界 | 通过 | `git diff --check`、固定 `upstream` remote 审计；变更只涉及 P04 CAS/catalog/jobs/migration/test/docs 和 P03 digest 序列化衔接 |

**P04 门禁结论：通过。** P05 现在可按 P04 handoff 创建；P06-P10 仍不得提前实现。

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
