# HTML 模板平台实施总计划

## 生产化修复扩展 v2.1（已批准执行）

P01–P10 及其“本地 MVP 完成后停止”结论保持为历史事实。用户已批准并执行计划 v2.0，P11–P15 已通过父监督者门禁；P16 发布工程已实现并通过功能演练，但生产依赖审计发现 21 个 high，原范围不能安全形成 P17 候选。用户于 2026-08-10 明确批准 v2.1，仅基于该证据新增 P16S 依赖安全阶段，不做同类项目研究。

- 状态：`blocked`（P16S 已通过；等待用户按完整 SHA 单独批准 G2，P17 未创建）
- 计划版本：`2.1`（已批准；2026-08-10T09:03:13+08:00）
- G2 候选：`8d125d2d9afb213f449dbdc2d32c4939f5407441`（仅候选，不等于已授权 push 或部署）
- 仓库：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 实现分支：`feat/production-auth-hardening`（批准后从基线创建）
- 基线提交：`9c88b48aafd3bf2529cc31c5db9e346a915bf3aa`
- 父监督者：当前 Codex 主任务；阶段 worker 不创建后继阶段
- 终局阶段：P17
- 上下文门：目标不超过 50%，硬上限 70%；阶段内只能机械拆分，不得改变架构、范围或验收。

### 全局架构与安全边界

1. 保留 SvelteKit Web → loopback Hono API → SQLite/CAS 的单机架构；不新增第二套身份服务器。
2. 移除活动 Lucia/CUNY 邮箱依赖，使用现有 `@node-rs/argon2`、加密随机数和 SQLite 实现最小身份模块；浏览器只持有 `__Host-ppt_session` Cookie，数据库只保存令牌 SHA-256。
3. `users.status` 仅为 `pending|active|disabled`，`role` 仅为 `admin|member`；部分唯一索引保证最多一名管理员。
4. 用户名先 trim/lowercase，再校验 `^[a-z][a-z0-9._-]{2,31}$`；密码 10–128 字符，Argon2id 至少 19 MiB/t=2/p=1。
5. 会话固定 7 天且不滚动；禁用、重置和改密后全部撤销。Cookie 固定 `HttpOnly; Secure; SameSite=Lax; Path=/`，不设置 Domain。
6. 模板 catalog 对所有 active 用户共享；Presentation、Item、Export 均由 `owner_user_id` 约束，跨用户对象统一返回 404。管理员只管账号，不能浏览他人 Presentation；系统恢复为管理员专属。
7. API 继续只监听 `127.0.0.1:3001`；Web 只监听 Caddy 可达的主机桥接地址，生产 Origin 固定为 `https://ppt.ajjy-ai.site`；写请求精确校验 Origin。
8. 代码放 `/opt/html-ppt/releases/<commit>`，数据放 `/var/lib/html-ppt`，服务用户 `htmlppt`；目录 `0700`，DB/WAL/备份/会话文件 `0600`。
9. 只使用 P03 fixture，禁止触碰 sibling 真实资产。所有迁移先备份、拒绝未知表、审计旧 trigger，并验证 quick/FK/ledger/业务计数。
10. 每阶段必须：读取指定入口 → 定向测试 → 全量相关回归 → 精确 staging → 审核 staged diff → 单一原子 commit → clean status → handoff；失败或不确定不得推进。

### 阶段总览

| ID | 阶段 | 目标 | 模型 | 思考 | 上下文 | 前置 | 后继 |
|---|---|---|---|---|---:|---|---|
| P11 | 可复现构建与故障止险基线 | 干净构建、健康检查、只读开关、Caddy 日志配置 | `gpt-5.6-sol` | high | 40% | 无 | P12 |
| P12 | 身份数据与固定会话核心 | 用户/会话/限流 schema 与安全会话服务 | `gpt-5.6-sol` | xhigh | 50% | P11 | P13 |
| P13 | 注册审批与密码管理 API | 注册、审批、登录、禁用、重置、改密闭环 | `gpt-5.6-sol` | high | 45% | P12 | P14 |
| P14 | 用户数据归属与恢复边界迁移 | Presentation/Export 私有化与恢复更新 | `gpt-5.6-sol` | xhigh | 50% | P13 | P15 |
| P15 | 登录审批与个人资产前端 | 中文身份 UI、路由门、管理员页与 E2E | `gpt-5.6-terra` | high | 45% | P14 | P16 |
| P16 | systemd 与原子发布工程 | 非 root 服务、数据分离、CI/WorkBuddy 发布演练 | `gpt-5.6-sol` | xhigh | 50% | P15 | P16S |
| P16S | 生产依赖安全修复 | 关闭 prod high/critical 并重建可部署候选 | `gpt-5.6-sol` | xhigh | 50% | P16 | P17 |
| P17 | 生产迁移切换与终局验收 | 精确提交推送、生产迁移、切换和最终验收 | `gpt-5.6-sol` | xhigh | 45% | P16S | 无 |

### P11 — 可复现构建与故障止险基线

- 目标：先消除已确认的 adapter-node 手工补装、无日志和匿名写入风险，不进入身份或 Owner 实现。
- 交付：提交 `@sveltejs/adapter-node` 和 lockfile；统一 Node 22 + `pnpm@9.15.0`；CI 覆盖所有 push/PR；新增 `/api/health/live`、`/api/health/ready` 和 `APP_READ_ONLY`；提供仅允许 catalog/PNG GET/HEAD 的临时 Caddy allowlist、JSON 日志轮转和回滚手册；停用指向旧 CUNY/Tailscale 主机的部署工作流。
- 只读入口：根及 Web/API manifests、Svelte adapter、hooks/BFF、composition root、CI/deploy workflows、现有 Caddy/PM2 只读快照。
- 允许范围：构建/CI、健康端点、只读策略、ops 配置与测试文档。
- 禁止范围：用户表、登录 UI、Owner 迁移、生产 DB 写入、服务重启、真实资产。
- 接口：`GET /api/health/live|ready`；`APP_READ_ONLY=true` 时 catalog/preview GET 保持可用，其他业务写请求返回稳定 `503 APP_READ_ONLY`。
- 验证：frozen install；API/Web typecheck/build；只读正负向测试；Caddy 配置在临时容器 validate；干净检出构建；确认 CI 不再引用旧服务器。
- 完成门：原子 commit、clean status、`handoffs/P11.md`；若申请 G1，还必须先展示 Caddy 备份路径、validate 命令和恢复命令，未获 G1 不执行服务器写操作。
- 回滚：代码 revert 该 commit；生产临时保护仅恢复 Caddy 备份并 validate/reload，不触碰应用数据。

### P12 — 身份数据与固定会话核心

- 目标：建立无邮箱身份数据和可立即撤销的数据库会话，不开放注册页面。
- 交付：迁移 `0005_p12_auth_core.sql` 新增 `users`、`sessions`、`auth_throttle`；替换固定身份内部类型；实现 Argon2id、随机 256-bit token、SHA-256 token hash、固定 7 天会话、Cookie 序列化、会话撤销和持久化限流；移除 Lucia 依赖及其不可达身份编译链，旧在线路由继续 404。
- schema：`users(id,username,password_hash,role,status,must_change_password,approved_by,approved_at,password_changed_at,created_at,updated_at)`；`sessions(id,user_id,token_hash,expires_at,created_at)`；`auth_throttle(key_hash,window_started_at,count,blocked_until)`。
- 约束：用户名 NOCASE 唯一；最多一名 admin；session token hash 唯一；密码、raw token、Cookie 不进入 audit/diagnostic。
- 迁移：更新 journal、目标表 allowlist、recovery ledger/表预期；测试 DB/隔离副本执行，P17 前不迁移生产库。
- 验证：空库/现有 5-migration 库/重复迁移；旧 trigger 审计；密码 9/10/128/129；令牌只存 hash；7 天绝对过期；撤销与限流跨进程重启仍有效；quick/FK/ledger/计数。
- 负向：未知表、重复用户名、第二管理员、篡改/过期 token、错误 Cookie、Origin 绕过、日志凭据模式全部拒绝。
- 完成门：迁移与安全测试、全量 P02–P10 回归、原子 commit、clean status、`handoffs/P12.md`。
- 回滚：仅对隔离 DB 恢复迁移前副本；生产回滚留到 P17，阶段内不得改真实库。

### P13 — 注册审批与密码管理 API

- 目标：完成服务端身份闭环，仍不改变 Presentation Owner。
- 接口：`POST /api/auth/register|login|logout|change-password`、`GET /api/auth/session`、`GET /api/admin/users?status=`、`POST /api/admin/users/:id/approve|disable|reset-password`。
- 行为：注册只收 username/password 并创建 pending，不创建 session；active 才能登录；正确密码后才返回 pending/disabled 状态；错误凭据统一 `INVALID_CREDENTIALS`；改密后清除 Cookie 并撤销全部 session。
- 管理：离线 bootstrap 命令隐藏输入且仅允许零管理员时创建；管理员不能禁用自己或提升第二管理员；重置生成只显示一次的临时密码并设置 `must_change_password=true`。
- 安全：注册 3/IP/小时；登录同时按 IP+username 与 IP 限流；所有写端点精确 Origin；现有 append-only `audit_events` 记录成功/失败动作和非秘密诊断。
- 验证：API 契约、审批状态机、bootstrap、单管理员、限流、审计、密码重置一次性显示、全部会话撤销；认证失败不改变 DB。
- 禁止：前端页面、Owner/Export 迁移、邮件、MFA、OAuth、管理员查看业务内容、生产操作。
- 完成门：定向 auth/API 测试 + 全量回归 + 原子 commit + clean status + `handoffs/P13.md`。
- 回滚：revert 代码和隔离 DB；不删除用户表或生产数据。

### P14 — 用户数据归属与恢复边界迁移

- 目标：将固定 `local-owner` 替换为认证用户，同时保留共享模板和既有 CAS/固定版本不变量。
- 交付：迁移 `0006_p14_presentation_ownership.sql` 为 `presentations` 增加 `owner_user_id` 外键/索引；插入必须非空、Owner 不可变 trigger；所有 Presentation/Item/Export 查询按 user 过滤；导出 manifest 升级 v2 并固定 owner user id；全局 recovery 仅 admin 可达，恢复后删除全部 session。
- 迁移硬门：生产 `presentations`、`presentation_items`、`presentation_exports` 必须全部为 0；任一非零立即阻断并请求归属映射决策，绝不自动归给管理员。
- 接口行为：未登录 401；已登录跨用户对象 404；普通用户 recovery 403；管理员没有绕过 Owner 浏览业务内容的能力。
- 验证：用户 A/B 创建、读取、修改、排序、导出全隔离；catalog/PNG 对二者共享；迁移、旧 trigger、revision/CAS/export/recovery 全回归；backup manifest 和日志无密码/token。
- 禁止：共享 Presentation、管理员内容浏览、真实资产、生产迁移。
- 完成门：隔离 DB 正负向、完整 P04–P10 安全回归、原子 commit、clean status、`handoffs/P14.md`。
- 回滚：测试库恢复迁移前快照；生产有新用户流量后只允许前向修复。


### P15 — 登录审批与个人资产前端

- 目标：把后端身份/Owner 能力形成可用中文旅程。
- 交付：SvelteKit hook 从数据库会话填充 `locals`；根业务路由未登录跳登录；注册、登录、待审批、禁用提示、强制改密、退出、管理员审批/禁用/重置页面；Header 显示用户名；普通用户不显示 recovery。
- 数据流：浏览器只通过同源 BFF；Set-Cookie 正确透传；静态预览携带同源 Cookie；任何 owner id 不由浏览器提交或信任。
- 验证：桌面/移动 E2E 走注册→待审批→审批→登录→Presentation→导出→退出；重置→强制改密→旧 session 无效；A/B 隔离；CSRF/Origin、Cookie、无邮箱字段、键盘和错误焦点。
- 禁止：生产部署、管理员内容浏览、社交登录、邮箱流程、视觉大改。
- 完成门：API/UI/E2E、console 0 error、原子 commit、clean status、`handoffs/P15.md`。
- 回滚：revert UI commit；后端表不删除。

### P16 — systemd 与原子发布工程

- 目标：在不触碰生产状态的前提下，把发布流程变成 WorkBuddy 可复现、可验证、可回滚的包。
- 交付：`htmlppt` systemd API/Web 单元；`/opt/html-ppt/releases/<commit>` + `current`；`ASSET_LIBRARY_DATA_ROOT=/var/lib/html-ppt`；Caddy TLS/安全头/JSON 日志/`/api/health/ready` 健康检查；HTML `no-cache` 和累积保留 `_app/immutable` 哈希资源；迁移器只在存在待迁移时备份；WorkBuddy preflight/deploy/rollback 手册。
- 运行：API `127.0.0.1:3001`；Web 使用当前已验证 Docker bridge 地址 `172.18.0.1:4173`，若执行前该地址漂移则 P17 阻断而非改为公网 bind；设置 `ORIGIN=https://ppt.ajjy-ai.site`。
- CI：all-branch frozen install、typecheck、unit/shell、Web build、Chrome E2E；不含生产密钥和自动部署。
- 演练：在临时目录/备用端口启动非 root 服务，迁移隔离 DB，验证权限、日志脱敏、Caddy validate、健康检查、静态 hash 兼容和回滚；不得 reload 生产 Caddy。
- 工程门：干净 clone build、服务/迁移/rollback 演练、依赖和凭据扫描、原子 commit、clean status、`handoffs/P16.md`。P16 产品提交 `81ed30c067138a2f9225a7e5da0e90a06717f573` 已满足工程门，但依赖扫描为 0 critical/21 high，因此安全门阻断且不得报告 P17 候选。
- 回滚：删除临时演练目录仅限工具创建且已验证的路径；仓库 revert；不清理生产旧发布。

### P16S — 生产依赖安全修复（v2.1 新增，已批准）

- 目标：不改变账号、Owner、导出、恢复或部署架构，只修复已确认的生产依赖 high/critical 风险，形成新的唯一候选 SHA。
- 允许范围：根/Web/API manifests、`pnpm-lock.yaml`、与依赖升级直接相关的 import/type/build 适配、已退役且未挂载依赖入口的最小删除或 fail-closed 占位、依赖审计/回归测试、STATUS 与 `handoffs/P16S.md`。
- 修复原则：优先移除无活动调用链的生产依赖；必须保留的直接依赖升级到 audit 给出的 patched 范围；传递依赖通过升级直接父依赖解决。禁止 `auditConfig`/CVE ignore、降低 audit 阈值、`--force`、无证据 override 或恢复旧邮件/云端/在线能力。
- 已知必审链：直接 `drizzle-orm`、`hono`；以及当前生产图中的 Nodemailer、XML、归档、富文本/CSS 与 AWS 传递链。是否移除或升级只由活动 composition root、编译图和测试证据决定，不把“未观察到利用”当作豁免。
- 不变量：migration SQL、journal/ledger、5/6/7 trigger 合同、SQLite/CAS 数据格式、API/BFF 行为、中文身份旅程、A/B 404、systemd/Caddy/WorkBuddy 失败关闭均不得漂移。
- 验证：干净导出 `pnpm@9.15.0 install --frozen-lockfile`；`pnpm audit --prod --audit-level high` 必须 exit 0 且 high=0、critical=0；direct/transitive 生产树回读；全量 Vitest/shell/type/Web/root build；P15 2/2、P06–P09 10/10 Chrome；P16 release rehearsal/local preflight；迁移 5→7、6→7、7 no-op 和 wrong-ledger 负向。
- 完成门：一个原子 P16S commit、tracked clean、无凭据/禁止路径、`handoffs/P16S.md`；父监督者独立复现 zero high/critical 后，才报告该新完整 SHA 为 P17 候选并另行请求 G2。
- 禁止：生产/实际 DB/CAS、服务器、Caddy/systemd/PM2、remote/push、G1/G2、真实 sibling 资产、功能扩张或审计豁免。
- 回滚：revert P16S commit 并恢复其 lock/manifests；不触碰任何生产状态。

### P17 — 生产迁移切换与终局验收

- 前置审批：P16S 必须通过并由父监督者报告新的候选完整 SHA；随后必须获得 G2，批准语句包含该完整 SHA。没有精确 SHA 不执行任何 push 或生产写操作。
- 发布顺序：push `feat/production-auth-hardening` → 等待该 SHA CI 全绿 → 无 force 地将远端 `personal/asset-library-mvp` 快进到同一 SHA → WorkBuddy 只读 preflight → 开启维护/只读 → 备份并记录 DB/CAS/Caddy/systemd/commit 哈希 → 部署 release → 迁移 → 交互式创建唯一管理员 → 启动 systemd → Caddy validate/reload → 公网 smoke → 移除临时匿名 allowlist但保留应用只读开关可回退。
- preflight：DNS/TLS、磁盘、端口、Docker bridge、Caddy 配置、线上 commit、DB quick/FK/5 migrations、业务计数、现有备份、无未知表；Presentation/Item/Export 非零立即阻断。
- 验收：20 次冷启动 CSS/JS/API 全 200 且 MIME 正确；注册/审批/登录/强制改密；A/B 隔离；admin-only recovery；401/403/404/Origin 负向；systemd/主机重启恢复；无 `EADDRINUSE`；进程非 root；DB 权限正确；Caddy 日志可定位失败且无凭据。
- 回滚：在开放注册/产生新业务数据前可停止新服务、恢复 DB/CAS/Caddy 备份并重启旧服务；一旦产生新数据，只前向修复。旧 `/opt/slide-maker`、旧 PM2 配置和所有备份保留，不删除。
- 终局门：公网、权限、重启、日志、备份/恢复点、GitHub 精确 SHA 全部有证据；提交 `handoffs/P17.md`，更新 STATUS/CHAIN_STATE 为 complete，工作树 clean；不得自动创建 P18。

### 阶段入口、允许范围与验证命令

各阶段开始时都必须先读 `AGENTS.md`、本计划、`STATUS.md`、`CHAIN_STATE.json`、前一阶段 handoff 和本阶段列出的入口；所有命令使用仓库锁定的 pnpm，不运行 `pnpm approve-builds`。

| 阶段 | 额外只读入口 | 允许修改范围 | 必跑定向命令 |
|---|---|---|---|
| P11 | manifests、adapter/hooks/BFF、API composition root、CI/deploy workflows | manifests/lock、健康与只读策略、`.github`、`ops/caddy`、P11 tests/docs | `corepack pnpm install --frozen-lockfile`; `node_modules/.bin/vitest run tests/p11-production-baseline.test.ts`; API/Web check/build; 临时 Caddy validate |
| P12 | DB schema/migrator/paths、owner、旧 Lucia/auth imports、recovery table/ledger | API auth/db/migration、shared auth types、P12 tests/docs | `node_modules/.bin/vitest run tests/p12-auth-core.test.ts`; shared/API tsc; `bash tests/run_all.sh`; isolated quick/FK/ledger scan |
| P13 | P12 handoff、auth service、audit schema、route/rate-limit conventions | auth/admin routes、bootstrap CLI、audit/limit service、P13 tests/docs | `node_modules/.bin/vitest run tests/p13-auth-approval.test.ts`; API tsc; credential-pattern scan; full Vitest/shell |
| P14 | Presentation/Export repositories、owner、P08 contract、P09 recovery、旧 triggers | owner/repositories/export/recovery、`0006` migration、shared types、P14 tests/docs | `node_modules/.bin/vitest run tests/p14-user-ownership.test.ts tests/p09-local-recovery.test.ts`; API tsc; quick/FK/ledger/count scan; P04–P10 full regression |
| P15 | Web hooks/layout/BFF、现有旧 auth pages、P14 interfaces、Playwright configs | Web auth routes/components/stores/hooks、P15 E2E/tests/docs | `pnpm --filter @slide-maker/web check`; `pnpm --filter @slide-maker/web build`; `node_modules/.bin/playwright test --config=playwright.p15.config.ts` |
| P16 | env/data paths、migrator startup、adapter-node build、现有 Caddy/PM2 read-only snapshot | ops/systemd/caddy/workbuddy、CI、runtime paths/cache、P16 tests/docs | `bash tests/p16-release-rehearsal.sh`; `bash ops/workbuddy/preflight.sh --target local`; clean-clone frozen build; secret scan; Caddy validate |
| P16S | manifests/lock、prod audit dependency paths、active composition root、P16 handoff | manifests/lock、依赖直接适配、退役入口最小清理、P16S tests/docs | frozen install；`pnpm audit --prod --audit-level high`；全量门；P15/P06 Chrome；P16 rehearsal/preflight |
| P17 | P16S handoff/approved SHA、线上只读 preflight、G2 approval record | 仅发布记录、STATUS/CHAIN_STATE/P17 handoff；产品源码冻结 | `bash ops/workbuddy/preflight.sh --target 119.29.241.146`; `bash ops/workbuddy/deploy.sh --target production --commit <approved-sha> --approved-commit <approved-sha>`; `bash ops/workbuddy/smoke.sh --origin https://ppt.ajjy-ai.site`; rollback drill/readback |

公共全量门：`node_modules/.bin/vitest run`、`bash tests/run_all.sh`、shared/API TypeScript、Web check/build、适用的真实 Chrome E2E、`git diff --check`。每次 commit 前必须 `git diff --cached --check` 并确认 staged paths 不含 `.workbuddy/`、生产数据、凭据或 sibling 真实资产。

模型理由：P12/P14/P16/P16S/P17 涉及身份安全、复杂迁移、依赖兼容或生产切换，固定 `gpt-5.6-sol/xhigh`；P11/P13 为边界明确的多文件后端工作，使用 `gpt-5.6-sol/high`；P15 以 UI/交互和 E2E 为主，使用 `gpt-5.6-terra/high`。


### 公共接口与迁移汇总

- 新增健康：`GET /api/health/live`、`GET /api/health/ready`。
- 新增身份：`POST /api/auth/register|login|logout|change-password`、`GET /api/auth/session`。
- 新增管理：`GET /api/admin/users`、`POST /api/admin/users/:id/approve|disable|reset-password`。
- `0005_p12_auth_core.sql`：users/sessions/auth_throttle；`0006_p14_presentation_ownership.sql`：presentation owner/触发器/索引。
- 既有 catalog 响应不暴露 owner；Presentation/Export 响应也不向客户端暴露他人 owner id。

### 计划级验收

- 所有阶段 context 估算 ≤50%，每阶段恰好一个模型/思考级别、一个后继和一个原子 commit。
- 所有 migration 在隔离 DB 和生产副本门禁上验证，未知数据/表/旧 trigger 失败即停止。
- 账号安全、跨用户 404、会话撤销、Origin、日志脱敏、只读模式、干净构建、systemd/Caddy/WorkBuddy 回滚均有负向证据。
- P16S 后生产审计 high=0、critical=0，且不使用忽略、降阈值或无证据 override。
- P01–P10 fixture/CAS/Chromium/export/recovery 不变量继续全量通过；真实 sibling 资产保持未访问。

### 明确未授权

- v2.1 仅授权 P16S 本地 manifest/lock/直接适配、测试与原子提交；仍禁止推进 P17、push、服务器或生产写操作，直至另行满足 G2。
- 仅 G0：禁止 push、Caddy reload、服务变更、生产 DB/CAS 写入和管理员初始化。
- 未有 G1：禁止临时 Caddy 只读/日志变更。
- 未有 G2：禁止 push、生产迁移、systemd/Caddy 切换和部署。
- 任意审批均不授权 force push、删除旧发布/PM2/备份、读取或迁移真实资产、输出凭据。

## 历史 P01–P10 计划与证据（保持不变）

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
