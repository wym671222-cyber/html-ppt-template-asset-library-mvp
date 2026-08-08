# ADR P01：从 CUNY Slide Maker 到本机单 Owner MVP

- 状态：**接受（P01 门禁依据）**
- 日期：2026-08-08
- 决策范围：架构审计与最小改造路径；不包含 P02 或后续功能实现
- 上游基线：`15b1a2713894bcde36a848d997f51d67760b441c`
- 审计分支/起点：`personal/asset-library-mvp` @ `d5f4d3e3586058c560a5c8ae2af97a4e67a639f6`

## 1. 决策摘要

采用“**新建本机产品组合层，按阶段复用上游底层能力；旧 CUNY 身份、协作和在线服务不进入活动依赖图**”的最小改造路径。

MVP 的唯一活动边界为：固定 `OwnerContext`、loopback-only Web/API/Worker、SQLite/Drizzle、本机 SHA-256 内容寻址存储、SQLite Job/本机 Worker、Playwright/Chromium。旧路由或文件即使暂时保留在仓库中，也不得被目标应用入口挂载；未来身份、Postgres、S3、外部队列和独立预览域只保留模块端口，不引入实现、依赖或配置。

不把现有 Deck/Slide 编辑器直接改名为资产库。目标域以 `TemplateAsset`、不可变 `TemplateVersion`、`Presentation`、固定版本的 `PresentationItem`、本地 Job 和内容对象为中心；现有编辑器仅作为可选择性复用的 UI/渲染代码来源。

## 2. 已验证的上游事实

以下事实来自 P00 指定入口及其横切依赖的只读审计：

| 领域 | 已验证事实 | 对 MVP 的判断 |
|---|---|---|
| HTTP 入口 | `apps/api/src/index.ts` 只向 `serve` 传入 `port`，未显式传 `hostname`；日志中的 `localhost` 不是监听范围证明 | 尚不满足 localhost-only；P02 必须显式绑定 loopback 并做 Host/Origin 拒绝测试 |
| 关系数据库 | 已使用 `better-sqlite3`、Drizzle SQLite adapter、WAL 与外键；`drizzle.config.ts` 的 dialect 为 `sqlite` | 可复用底座；不是 Postgres 迁移项目 |
| 迁移机制 | 根脚本当前使用 `drizzle-kit push`；仓库没有已提交的 `apps/api/drizzle/` 迁移文件 | P02 必须建立可审计的版本化迁移，不能把 `push` 当验收迁移 |
| 身份 | 当前不是 SSO/OIDC；是 Lucia + CUNY 邮箱注册、密码、邮件验证、会话 cookie、密码重置 | 全部不属于单 Owner MVP；从活动入口隔离，而不是“迁移 SSO” |
| 用户/审批 | `users` 含 `role`、`status`、token cap；存在 admin 用户管理与 `pending/approved/rejected` 审批 | 目标 schema 和活动路由均不保留 |
| 协作/RBAC | `deck_access`、share/collaborator 路由、锁、presence、前端共享对话框和心跳形成横切依赖 | P02 从活动依赖图整体移除；不逐处把角色判断改成常量 |
| 当前资源 | `templates/themes/artifacts` 是 CUNY Slide/Module 资源；artifact 可保存并运行 `source/rawSource` | 与 HTML 页面包资产契约不同；不得直接充当 `TemplateVersion` |
| 当前文件存储 | `files.ts` 写入 `apps/api/uploads/{deckId}`，数据库保存路径，支持覆盖域外的可变上传生命周期；GET 文件路由不要求 auth | 是本地文件系统但不是内容寻址存储；P04 用新对象存储替代，旧上传不自动迁移 |
| Postgres/S3 | 源码和依赖中未发现 Postgres client/repository 或 S3 client/bucket 实现 | MVP 无需执行 Postgres/S3 数据搬迁；只需禁止引入并保留替换端口 |
| AWS/外联 | 存在 Bedrock、SES、SMTP、Anthropic/OpenRouter、搜索和 Pexels 等在线能力；这不是 S3，但仍在本机资产 MVP 范围外 | 目标入口不挂载；不得因“未来接口”保留活动凭据或网络调用 |
| 预览 | `preview.ts` 调用字符串 HTML renderer；CSP 允许 Google Fonts、任意 HTTPS 图片和外部视频 iframe；artifact iframe 可执行脚本或使用外部 URL | 不是 P05 所需的 Chromium 网络隔离；P05 前不得作为安全预览验收依据 |
| 导出 | 已有 archiver ZIP、HTML renderer、路径约束和 manifest 雏形；manifest 未固定 `TemplateVersion`/来源哈希，字体/地图/视频等可依赖网络 | 可复用局部纯函数/ZIP 经验，不能直接判定 P08 导出闭环完成 |
| Playwright | 仓库已有 `@playwright/test`，E2E 项目明确使用 Chromium | 只证明测试工具可用；不存在产品级预览/缩略图 Worker 或网络阻断 |
| 本地 Job | 没有持久化 Job 表、本机 Worker、lease/重试/诊断和恢复实现 | P04 新建最小实现；不引入 Redis/队列服务 |
| Web | 首页和应用 layout 依赖登录/角色/分享；EditorShell 是“左侧选项卡 + 中央画布”，不是计划中的资产库三栏核心旅程 | P02 先去除身份门禁，P06 再建设目标三栏 UI；P01/P02 不做 UI 重写 |
| 数据现状 | P00 仅用临时 SQLite 做启动验证，仓库未跟踪产品数据库；没有获授权的真实业务数据迁移源 | 采用新目标数据库的前向迁移；不复制 CUNY seed、Deck 或真实 `02` 素材 |

补充边界：前端聊天中的 pending mutation 确认是 AI 变更的客户端安全交互，不是组织/用户审批工作流。由于聊天/AI 不属于首期资产库核心旅程，该链路随旧编辑器隔离；不得把它建模为目标 `approval` 状态。

## 3. 目标活动依赖图

```text
loopback Svelte UI
  -> loopback Hono composition root
     -> fixed OwnerContext
     -> application services
        -> Drizzle repositories -> SQLite
        -> LocalContentStore -> data/objects/sha256/...
        -> LocalJobRepository -> SQLite jobs
           -> in-process/local Worker
              -> Playwright/Chromium with network deny-by-default
```

活动图中不出现 Lucia、User/Organization/Role、approval、sharing/presence/lock、Postgres、S3、Redis、云 Worker、域名或部署配置。AI、邮件、Web 搜索和图片搜索也不属于该图。

## 4. 最小模块映射

| 上游入口/能力 | 处理方式 | 目标模块与阶段 | 禁止的捷径 |
|---|---|---|---|
| `apps/api/src/index.ts`、`env.ts` | 保留 Hono/Node 基础，建立新的产品 composition root；显式 loopback 监听和最小路由集 | Runtime / P02 | 只改日志为 localhost；继续挂载全部旧路由 |
| `db/index.ts`、Drizzle/SQLite | 保留技术栈；路径固定在仓库忽略的 `data/`，开启 WAL/foreign keys，并使用已提交迁移 | Repository / P02 | 继续用 `drizzle-kit push` 代替迁移；允许非 `file:` DB URL |
| `auth/*`、`routes/auth.ts`、`routes/admin.ts`、邮件 | 不进入活动入口；P02 用固定 Owner 取代 cookie/session | OwnerContext / P02 | 模拟登录、硬编码 admin 账号、保留“永远 approved”的用户表 |
| `deck_access`、sharing、lock、presence | 整体隔离并停止挂载；前端移除共享/心跳调用 | 无目标运行模块 / P02 | 把每个 RBAC 判断改成 `true` 后保留协作表和接口 |
| `templates`、`artifacts`、`resources.ts`、seed | 不迁移内建 CUNY 资源；P03 只新建模拟 HTML 包并经过适配器 | Asset Catalog / P03-P04 | 把 artifact `rawSource` 直接认作安全模板；读取真实 `02` 资产 |
| `files.ts`、`uploaded_files`、`uploads/` | 仅作遗留参考；P04 新建不可变对象写入和引用索引 | Local Object Store / P04 | 原地移动/重命名旧文件；以文件名或 deckId 作为对象身份 |
| 无 Job 基线 | 新建 SQLite Job 状态机和单机 Worker | Local Jobs / P04 | 内存队列作为持久化真相；引入 Redis/云队列 |
| `preview.ts`、renderer、artifact iframe | P05 新建 Chromium 执行边界；只复用经测试的纯渲染片段 | Validation/Preview / P05 | 仅靠 CSP/sandbox 声明“网络隔离”；让宿主 cookie 进入页面 |
| `+page.svelte`、`EditorShell`、resources/editor 组件 | P06 选择性复用视觉/状态模式，建设资产目录、预览、购物车三栏 | Asset Library UI / P06 | 在 P02 提前重做 UI；把现有 Slide 编辑器当目标产品 |
| `decks/slides/content_blocks` | 不自动迁移；P07 用 `Presentation`/`PresentationItem` 建模选择、排序、复制和修订 | Composer / P07 | 将 `Slide` 政名为 `PresentationItem`；引用“当前版本”而非固定版本 |
| `export/*`、`routes/export.ts` | P08 可复用 archiver/转义等局部能力，围绕固定 revision/version 重建 manifest 与离线验证 | Export / P08 | 复用当前 manifest 后宣称可追溯；导出依赖公网字体/资源 |
| Vitest、shell tests、Playwright Chromium | 保留分层测试框架；按阶段增加 DB、网络、内容哈希和恢复测试 | Verification / P02-P10 | 用已有 E2E 通过替代产品安全门禁 |
| deploy/nginx/云 provider | 保留为上游历史但不进入 MVP 命令/入口；P01-P10 不发布 | 禁改/隔离 | 修改为新的部署方案、配置凭据、可写远程或 push |

## 5. 单 Owner 与未来扩展接口

### 5.1 MVP 决定

- `OwnerContext` 每个请求固定解析为稳定的本机 owner 标识；不读取 header、cookie、邮箱或数据库用户记录作为身份来源。
- 目标业务表不创建 `users`、`organizations`、`role_bindings`、`deck_access`、approval status，也不为假想多租户预埋 `owner_id`。
- 授权边界由 composition root 保证：API 仅 loopback 可达，所有业务服务都显式接收固定 `OwnerContext`，但 repository 不实现角色分支。
- SQLite 是唯一关系数据库；本机内容对象和 Job 是唯一存储/执行实现。

### 5.2 只保留的端口

端口只表达模块责任，不引入第二种实现：

| 端口 | MVP 实现 | 未来可能替换（本期不实现） |
|---|---|---|
| `OwnerContextProvider` | 固定 local owner | 身份/组织/角色 adapter |
| 领域 repository 边界 | Drizzle + SQLite | Postgres repository/migrator |
| `ContentStore` | SHA-256 本机对象目录 | S3-compatible store |
| `JobRunner` | SQLite Job + 本机 Worker | 外部队列/Worker |
| `PreviewExecutor` | loopback Playwright/Chromium | 独立 preview origin |

禁止创建未使用的 provider registry、运行时选择器、云 SDK、远端配置字段或双写逻辑。未来替换发生在 composition root，不渗透进领域实体。

## 6. 目标数据模型与不变量

P02 建立目标 schema 和迁移，但不实现 P03-P08 的产品旅程。最小表族和约束如下：

| 表族 | 必须表达的约束 |
|---|---|
| `template_assets` | 稳定身份；标题/摘要/分类；可下架但不物理删除；current version 可空且只能指向同资产的已验证版本 |
| `template_versions` | `(asset_id, version_number)` 唯一；契约版本和源内容 digest 必填；一经进入已验证/可用状态，内容引用不可更新或删除 |
| taxonomy/tag 关系 | 标签唯一、关联唯一；只服务本机搜索筛选，不含可见性/组织字段 |
| `presentations` | 名称、状态、单调递增 revision、创建/更新时间 |
| `presentation_items` | 固定 `template_version_id`；同一 presentation 内 position 连续且唯一；覆盖内容只能是 slot schema 允许的 JSON 数据 |
| `content_objects` | SHA-256 digest、媒体类型、字节数、相对路径和创建时间；对象记录只追加，禁止绝对路径作为可移植真相 |
| `jobs` | 类型、状态、输入快照/revision、attempt、诊断、输出 digest、时间戳；失败不能覆盖已验证输出 |
| `audit_events` | 追加式本机事件；只记录动作、实体、结果和非秘密诊断，不记录凭据值 |

具体字段可在 P02 用最少实现调整，但不得破坏上述不变量，也不得增加用户、组织、角色、审批或云定位字段。

## 7. 数据迁移与切换顺序

本次没有获授权的旧业务数据或真实素材迁移。这里的“迁移”是从上游 schema/入口切换到新本机产品 schema，采用前向、非破坏顺序：

1. **P02 预检与备份**：确认分支/HEAD/工作树、目标 DB 路径和 sibling 资产边界；若发现任何现有 DB，先复制备份并记录大小与 SHA-256，禁止原地 drop/reset。
2. **建立新数据库边界**：固定仓库本地 `data/` 路径，只接受 SQLite `file:`；提交编号化 SQL migration 和迁移账本。
3. **先建目标表和约束**：按 `content_objects`/catalog、presentation、jobs、audit 的外键依赖建立表；对空库和迁移后库验证 foreign keys、quick check 和关键唯一性/不可变性。
4. **切换 Owner 入口**：新 composition root 只挂载 health 与本阶段允许的目标路由；固定 Owner；前端不再要求登录、角色或 approval。旧 auth/admin/sharing/presence/lock 路由保持未挂载。
5. **不复制遗留记录**：CUNY `users/sessions/deck_access/decks/slides/content_blocks/templates/artifacts/uploaded_files` 均不自动 copy/rename；旧 seed 不运行到目标 DB。
6. **P03 模拟资产**：仅从仓库中新建的模拟包写入目标 catalog；不扫描或读取真实 `02` HTML/素材。
7. **P04 对象/Job 落位**：临时目录校验、计算 SHA-256、原子落位，再事务性写引用；失败只留下可诊断 Job，不改变 current version。
8. **P05-P08 派生物**：缩略图和导出物各自按内容哈希追加；`PresentationItem` 永远固定 `TemplateVersion`，Export 固定 presentation revision。
9. **P09 恢复后再清理**：只有备份/恢复演练通过且另有明确授权，才可删除遗留本机 DB/上传目录或旧代码；P01 不授权清理。

若 P02 预检发现非临时的上游 DB/上传文件，立即停止记录级迁移并报告；不得自行解释为可丢弃数据。

## 8. localhost 与预览安全决策

- Web、API、Worker 控制端口显式绑定 `127.0.0.1`（如需 IPv6，另建明确的 `::1` 监听和测试），拒绝非 loopback Host/Origin；不以默认监听行为或日志文本作为证据。
- P02 的 localhost 门禁只验证进程暴露边界，不把字符串 renderer 认作安全预览。
- P05 的 Chromium context 不携带宿主 cookie；请求拦截默认 abort，只放行当前 loopback preview origin 和解包后的受控本地资源。
- 禁止公网字体、地图瓦片、视频 iframe、搜索图片、任意 `http(s)` artifact、`file:`/父目录路径、表单提交和新窗口。
- 页面包先做静态路径/契约检查，再在临时目录中运行 Chromium；成功后才原子登记缩略图/状态。CSP 是纵深防御，不是网络隔离的唯一证据。

## 9. 禁改区

P01 及后续阶段都必须遵守：

1. `/Users/rosswang/Desktop/HTML - PPT/02_HTML_PPT_组件与模板` 中除已批准计划文档外的真实 HTML/素材：不读取导入、不复制、不移动、不改写、不扫描建索引。
2. `upstream` 远程配置、任何 push、发布、部署、域名、nginx 或云端环境。
3. P03 前不得登记模板；P04 前不得实现对象写入/Job；P05 前不得宣称安全预览；P06 前不得重写目标 UI；P07 前不得实现购物车/汇报；P08 前不得交付目标导出。
4. 不把 CUNY seed、测试 artifact 或现有 Deck 数据伪装为目标模拟模板。
5. 不引入 SSO/OIDC、User/Organization/RBAC/approval、Postgres、S3、Redis、云队列或外部 Worker；未来端口不能成为提前实现这些服务的理由。
6. 不物理删除或覆盖未知本机数据库、上传文件、已验证版本、对象、缩略图或导出物。

## 10. 分阶段最小改造路径

| 阶段 | 允许的最小变化 | 阶段结束证据 |
|---|---|---|
| P02 | loopback composition root、固定 OwnerContext、目标 SQLite migrations/schema、旧身份/协作链路不挂载 | loopback 负向测试；空库/迁移库测试；无 User/RBAC/approval 表；构建/测试通过 |
| P03 | v1 契约、适配器、仓库内新建模拟包 | 模拟包校验；没有 `02` 素材路径/哈希进入账本 |
| P04 | CAS、catalog repository、SQLite Jobs、单机 Worker | 去重/原子写/失败恢复/状态持久化测试 |
| P05 | Chromium 校验、预览和缩略图 | 外网/cookie/父目录/iframe 负向测试与稳定截图 |
| P06 | 资产目录/预览/购物车三栏核心 UI | localhost 搜索筛选预览选择旅程 E2E |
| P07 | Presentation/Item 修订、排序、复制、固定版本 | 版本固定和连续排序并发/回归测试 |
| P08 | snapshot、HTML/ZIP、manifest、离线打开 | manifest 哈希回读、断网打开和失败诊断 |
| P09 | 集成加固、备份/恢复 | 新目录恢复后的 DB quick check、对象哈希和核心旅程 |
| P10 | MVP 总验收 | MASTER_PLAN 全局不变量逐项有证据后停止 |

## 11. P01 门禁结论

P01 所需的只读架构审计、最小改造 ADR、模块映射、数据迁移顺序和禁改区均已形成；决策明确满足单 Owner、localhost、SQLite/Drizzle、本地内容寻址存储、本地 Job、Playwright/Chromium，以及真实素材/远程/发布禁令。

**结论：P01 门禁通过。** 这只授权按 `MASTER_PLAN.md` 创建 P02；不代表 P02 的 localhost、OwnerContext 或 schema 已实现。
