# 实施状态

## 生产化修复链 v2.2 当前状态（2026-08-10）

- Workflow phase：`blocked`（P17 生产通道）
- Plan version：`2.2`（已批准，2026-08-10T14:19:02+08:00）
- 历史批准版本：`2.0`（2026-08-09T23:50:11+08:00）
- 当前实现阶段：P11–P16T `passed`；P17 `blocked`
- 实现分支：`feat/production-auth-hardening`
- 基线：`9c88b48aafd3bf2529cc31c5db9e346a915bf3aa`
- 当前任务：无；P17 执行者已在生产 preflight 前安全停止并交付阻断记录
- 上一轮 G2：用户于 2026-08-10T10:06:13+08:00 批准 `8d125d2d9afb213f449dbdc2d32c4939f5407441`，但发布分支 CI 红灯后在生产 preflight 前安全停止；该授权已关闭且不适用于新 SHA
- 当前 G2：用户于 2026-08-10T16:40:05+08:00 明确批准提交 `72eadaa476a83b4a58f320149d7a5d0e0ad980ad` 推送并部署到 `ppt.ajjy-ai.site`
- 最小修复授权：用户明确批准仅修复 P13 bootstrap build-graph 测试的确定性超时，保持断言与覆盖不变；形成新候选 SHA 后重新请求 G2。
- 下一安全动作：父监督者向用户报告生产连接阻断；恢复可审计的 WorkBuddy/SSH 服务器通道后，从生产只读 preflight 重新开始。不得猜测凭据、绕过连接门或直接部署。

| 阶段 | 状态 | Commit | Task | Gate | 当前证据 |
|---|---|---|---|---|---|
| P11 | passed | `8d3cc0d91d2e4292967b3fba80f3aff5c7ed5542` | `/root/p11_reproducible_baseline` | passed | 父级复跑 P11 4/4、shared/API tsc、adapter-node Web build、shell 90/90；边界和原子提交已核验 |
| P12 | passed | `7a0bfa457541a76c26b70a8d3613a0870339be98` | `/root/p12_auth_core` | passed | 父级复跑 P12 11/11、shared/API tsc、shell 8/8；迁移、令牌/Cookie/限流和退役边界已核验 |
| P13 | passed | `9851afc0737564413bc543e8f2756106346ba353` | `/root/p13_auth_approval_api` | passed | 父级复跑 P13 10/10、P12+P13 21/21、shared/API tsc、API build、shell 8/8；强制改密和 IP 信任缺口修正后验收 |
| P14 | passed | `5c2d13f5e15cda9840a459a6c46e6a041bb0beed` | `/root/p14_user_ownership_retry` | passed | 父级复跑 P14+P09 13/13、shared/API tsc、shell 8/8、root build 2/2；迁移阻断、A/B 隔离、恢复撤销与 fixed owner 修正已核验 |
| P15 | passed | `45898624eb4f8935a7112210f5cb103ab21610fc` | `/root/p15_auth_frontend` | passed | 父级 HTTPS Chrome 2/2、P06–P09 10/10、全量 Vitest 771/771、shell 8/8、类型/构建与边界扫描通过；hydration/用例依赖修正后验收 |
| P16 | passed | `81ed30c067138a2f9225a7e5da0e90a06717f573` | `/root/p16_atomic_release` | passed | 父级定向 22/22、全量 777、shell/type/build、rehearsal/preflight 通过；v2.1 将 prod audit high 关闭门移交 P16S |
| P16S | passed | `8d125d2d9afb213f449dbdc2d32c4939f5407441` | `019fe931-bd91-7ca0-9503-c0e8fcffe052` | passed | 父级复现 audit 真实 exit 0/五档全 0、定向 24/24、全量 779、shell/type/build、rehearsal/preflight 与 Chrome 12/12；提交边界和凭据扫描通过 |
| P16T | passed | `72eadaa476a83b4a58f320149d7a5d0e0ad980ad` | `/root/p16t_ci_stabilization` | passed | 父级确认单提交/三路径/唯一单测级 15 秒差异；独立复跑 P13 三轮、全量 779、shell/type/build、audit 全 0、rehearsal/preflight 与 Chrome 12/12 通过 |
| P17 | blocked | `8a389d54861648ea4c537a872e7ce831eb31bc6e` | `/root/p17_production_release` | blocked | `72eadaa…` 已推送到两 origin ref；CI 31371260100/31371448617 均绿；SSH publickey 拒绝且 WorkBuddy composer 无法可靠提交只读命令，未执行生产 preflight/备份/部署 |

### P17 v2.2 当前阻断（2026-08-10）

- 已以精确 refspec、普通非 force push 将 `72eadaa476a83b4a58f320149d7a5d0e0ad980ad` 依次更新到 `origin/feat/production-auth-hardening` 和 `origin/personal/asset-library-mvp`；没有 push 父级状态 HEAD、upstream、tag 或其他 ref。
- feature CI run `31371260100` 与 personal CI run `31371448617` 都在该完整 SHA 上成功，均覆盖 frozen install、build、type、tests、release rehearsal 和 Chrome E2E。
- 对 `root@119.29.241.146` 与 `ubuntu@119.29.241.146` 的非交互、短超时、只读 SSH 探测均被 `publickey` 拒绝；没有建立服务器会话，也没有尝试密码、私钥读取或其他绕过。
- 按用户要求转用已存在的 WorkBuddy“部署项目到轻量服务器并配置域名”任务。Computer Use 只读确认历史任务与既有服务器连接说明可见，但任务 composer 的发送控件无法可靠启用；一次输入注入触发 WorkBuddy 自带的可恢复 DOM 错误，点击其“重置输入框”后恢复。没有消息提交给 WorkBuddy agent，更没有服务器命令执行。
- 因无法从可信通道取得 `bash ops/workbuddy/preflight.sh --target 119.29.241.146` 的现场证据，P17 必须在任何生产访问、备份、部署或停机之前停止。Caddy、systemd、PM2、DB/CAS、管理员、服务和网站均未由本次 P17 改动。
- 当前远端 Git/CI 外部效果无需回滚；不得 force 回退。恢复通道后必须从精确候选 checkout 的只读生产 preflight 重新开始，并重新确认现场未漂移。

### P16T 候选实现与当前证据

| 范围 | 当前已验证结果 |
|---|---|
| 唯一实现 | 只为 `tests/p13-auth-approval.test.ts` 中 bootstrap build-graph 的现有 `it` 增加 Vitest 第三参数 `15_000`。真实 `node_modules/.bin/tsc`、API manifest/tsconfig 断言、`dist/auth/bootstrap-admin.js` 产物断言及其余 778 个测试均未改变；无 skip、retry、全局 timeout、mock 或 CI workflow/产品源码修改。 |
| 定向稳定性 | P13 文件连续 3 次各 10/10 通过；目标真实编译测试单次约 1.0–1.2 秒。工作区全量 Vitest 35 files/779 tests 通过。 |
| 静态与构建 | shell 8/8、shared/API TypeScript、Web check 0 errors/9 个既有 warnings、Web build、根 Turbo API/Web 2/2 build 全部通过。 |
| 生产依赖 | `npx -y pnpm@9.15.0 audit --prod --audit-level high --json` 真实 exit 0；369 production dependencies，info/low/moderate/high/critical 全 0。 |
| 发布与浏览器 | P16 non-root release rehearsal 与 local preflight 通过；P15 隔离 HTTPS Chrome 2/2、P06–P09 Chrome 10/10 通过。Node 24、无 Caddy/systemd/Docker runtime 的既有限制继续如实保留。 |
| staged-index 干净导出 | 从仅含功能改动的精确暂存索引导出到独立 `/tmp` 树，确认不含 `.workbuddy/`，fresh frozen install 通过。首次在 `svelte-kit sync` 前跑全量 Vitest 时 3 个 Web suite 因缺生成的 `.svelte-kit/tsconfig.json` 仅在收集阶段失败，其余 32 files/756 tests 与 P13 均通过；先执行 Web check/sync 后，同一导出树复现 P13 连续 3 次、全量 779、shell/type/build、audit、rehearsal/preflight 与 Chrome 12/12 全部通过。 |
| 边界 | 只使用仓库 P03 fixture、隔离 SQLite/CAS、临时目录与备用端口；未读取/暂存/修改 `.workbuddy/`，未读取 sibling `02`，未访问实际/生产 DB/CAS、服务器、WorkBuddy、Caddy/systemd/PM2、remote 或 G1/G2；未运行 `pnpm approve-builds`。 |

P16T worker 只形成一个本地原子候选提交并停止。父监督者已独立核对完整 SHA、单提交三路径边界、唯一测试语义差异、tracked-clean 状态，并复跑 P13 三轮、全量/构建/审计/发布演练/Chrome 门禁。新候选现仅等待精确 G2；当前旧 SHA 的 G2 不适用于本候选。

### P17 当前阻断（2026-08-10）

- 已按精确 refspec 将获批产品提交 `8d125d2d9afb213f449dbdc2d32c4939f5407441` 推到新的 `origin/feat/production-auth-hardening`；没有推送本地父级状态提交、upstream、tag 或其他 ref。
- feature 分支 CI run `31349030940` 在同一完整 SHA 上通过 build、type、tests、发布演练和 Chrome E2E 后，`origin/personal/asset-library-mvp` 由 `9c88b48aafd3bf2529cc31c5db9e346a915bf3aa` 无 force 快进到同一产品 SHA。
- personal 分支自动触发 CI run `31349153227`。原 run 与一次 failed-job 重跑均在 `tests/p13-auth-approval.test.ts:354` 的 bootstrap CLI build-graph 测试触发默认 5000 ms 超时；失败耗时约 6.5 秒，其他已执行测试通过，后续 release rehearsal/Chrome 因前置失败未运行。
- 同一 run 连续两次红灯不满足 P17 的“等待该 SHA CI 全绿”门。P17 禁止修改产品源码且 G2 仅批准该完整产品 SHA，因此本阶段不能把测试修复塞入已批准候选，也不能以重复重跑掩盖不稳定门禁。
- 生产 `119.29.241.146`、`ppt.ajjy-ai.site`、WorkBuddy、Caddy、systemd、PM2、数据库、CAS、管理员和服务均未访问或修改；没有维护窗口、停机或生产回滚需求。
- 交接见 `docs/implementation/handoffs/P17.md`。父监督者应把机器状态与本阻断协调后，向用户提出最小的同阶段恢复/新候选审批，不得将当前 P17 标记为通过或 complete。

### P16S 候选实现与当前证据

| 范围 | 当前已验证结果 |
|---|---|
| 直接依赖 | `drizzle-orm` 固定到 patched `^0.45.2`；`drizzle-kit` 升级到移除 gel 直接依赖的 `^0.31.10`。`@hono/node-server` 固定到 patched `^2.0.5`（lock 为 2.1.0），Node `>=20`/Hono 4 peer 与项目目标匹配，既有 `serve` 使用无需适配。Svelte/SvelteKit 分别固定到 `^5.56.8`/`^2.70.2`，使 runtime peer 图使用 patched devalue。账号、Owner、导出、恢复、migration SQL/journal/ledger 和部署配置未改。 |
| 退役邮件链 | 未挂载的 CUNY 邮件入口改为稳定 fail-closed 占位，移除 `nodemailer`、`@aws-sdk/client-ses` 与类型包；四个历史发送函数均只拒绝，不初始化 transport、读取邮件配置或访问网络。 |
| 传递依赖 | lock 在既有直接范围内刷新 lodash、xmldom、AWS XML、Hono、form-data、TipTap/linkify、PostCSS/nanoid、brace-expansion 等 patched 图。gel 最新仍声明 `shell-quote ^1.8.1`，且 Drizzle optional peer 会自动安装 gel；因此仅用证据化 `gel>shell-quote=1.10.0` 窄 override，版本仍满足父范围且高于 advisory patched `>=1.9.0`。没有其他 override。 |
| 生产审计 | `npx -y pnpm@9.15.0 audit --prod --audit-level high --json` 真实 exit 0；JSON 回读 369 production dependencies，info/low/moderate/high/critical 全部为 0。未降阈值、未 ignore、未用 `--force`。 |
| 全量回归 | frozen install 通过；Vitest 35 files/779 tests、shell 8/8、shared/API TypeScript、Web check 0 errors/9 个既有 warnings、Web build 和 root API/Web 2/2 build 通过。 |
| staged-index 干净导出 | 从精确暂存索引导出到独立 `/tmp` 目录，确认不含 `.workbuddy/`；fresh frozen install、production audit、P16S/P12/P14/P16 24/24、root build 2/2、P16 rehearsal 与 local preflight 全部通过。 |
| 身份与浏览器 | P15 隔离 HTTPS Chrome 2/2；P06–P09 Chrome 10/10。注册审批、强制改密、A/B 私有 Presentation/Export、断网 ZIP 与隔离恢复旅程保持通过。 |
| 迁移与发布 | P12/P14/P16 定向 24/24 覆盖 5→7、6→7、7 no-op、完整 ledger 7 搭配 migration 6 trigger 的 wrong-ledger 无备份拒绝；P16 非 root rehearsal 与 local preflight 通过。 |
| 边界 | 仅使用仓库 P03 fixture、隔离 SQLite/CAS、临时目录与空闲备用端口；未读取 sibling `02`，未读取/修改 `.workbuddy/`，未访问实际/生产 DB/CAS、服务器、Caddy/systemd/PM2 或 remote；无 push、G1/G2、`pnpm approve-builds`、audit ignore、降阈值或 `--force`。 |

P16S 产品提交未修改 `CHAIN_STATE.json` 或创建 P17。父监督者已对完整提交 `8d125d2d9afb213f449dbdc2d32c4939f5407441` 独立复核并通过；该 SHA 现在仅作为 G2 候选报告，尚无 push、生产迁移或部署权限。

### P16 交付候选与阻断事实

| 范围 | 当前已验证结果 |
|---|---|
| 运行身份与路径 | systemd 候选固定非 root `htmlppt` 与 `/usr/bin/node`；API `127.0.0.1:3001` 并默认 `APP_READ_ONLY=true`，Web `172.18.0.1:4173`，生产 Origin `https://ppt.ajjy-ai.site`；代码 `/opt/html-ppt/releases/<commit>` + 原子 `current`，数据只在 `/var/lib/html-ppt`。生产模式拒绝其他 data root。可选 API override 必须由 preflight 核验为非 symlink、`root:root 0600` 且只含 read-only flag。 |
| 代理信任边界 | 仅在已证明的“浏览器 → 单层受控 Caddy → Web”拓扑启用 `ADDRESS_HEADER=x-forwarded-for`、`XFF_DEPTH=1`。候选 Caddy 删除浏览器入站转发头并以直连 `{remote_host}` 重建单值 XFF；隔离负向测试证明伪造 XFF 未进入 API 限流键。拓扑、bridge 或直达性无法证明时服务保持停止。 |
| Caddy 与缓存 | 生产候选包含自动 TLS、安全头、0600 JSON 日志、主动 `/api/health/ready`、HTML `no-cache` 与 `_app/immutable` 一年 immutable；原子发布累积保留旧 hash 资源。P16 未安装、validate 或 reload 生产配置。 |
| 迁移与发布 | 迁移器只在检测到 pending migration 且 DB 已存在时创建 pre-migration 备份；已完全迁移的重复运行不新增备份。Migrator/preflight 共用 5/6/7 ledger 的 trigger 合同，并都把实际 ledger count 严格绑定到唯一集合。WorkBuddy deploy/rollback 无默认 production target，deploy 另要求 approved SHA 与 commit 相等；脚本只切换 release symlink，不启动服务、不迁移、不删除旧 release/备份。 |
| 验证 | 全量 Vitest 34 files/777 tests、shell 8/8、shared/API TypeScript、Web check 0 errors/9 条既有 warnings、根 adapter-node build、P15 Chrome 2/2、P06–P09 Chrome 10/10、P16 合同 5/5、暂存索引隔离导出 frozen install 与完整发布演练均通过；P16/P12 负向覆盖无 target/批准 SHA、默认只读、精确 Node、unknown/wrong-ledger trigger，以及 ledger 7/trigger set 6 在 pending=0 时无备份拒绝。 |
| 当前环境限制 | 宿主是 Node 24 而非生产 Node 22；没有 Caddy、`systemd-analyze`，Docker daemon 不可用。因此没有伪称本机 Caddy runtime validate、systemd runtime verify、Node 22 执行或生产桥接可达性证据。 |
| 依赖门禁 | `npx -y pnpm@9.15.0 audit --prod --audit-level high` 检出 81 项：8 low、52 moderate、21 high、0 critical（442 个生产依赖）；high 包含直接生产依赖 `drizzle-orm` 与 `hono`，其余 high 也在生产依赖图。升级/替换会改变 P16 已批准范围与验收，未在 v2.0 内擅自处理或豁免。 |
| 阶段结论 | P16 工程实现完成但安全完成门未通过；本提交不是 P17 可部署候选，不报告/申请 G2，不创建 P17。依赖修复须先批准新的计划版本。 |

P16 只使用仓库 P03 fixture、工具创建的临时目录、备用端口与隔离 SQLite；未读取 sibling 真实资产，未访问或修改实际/生产 DB/CAS、服务器、Caddy、systemd、PM2、remote、`.workbuddy/`、CHAIN_STATE 或 DECISION_LOG，且无 push。

### P13 通过事实与当前证据

| 范围 | 已验证结果 |
|---|---|
| 注册与登录 | 活动 Hono composition root 挂载 `POST /api/auth/register\|login\|logout\|change-password` 和 `GET /api/auth/session`。注册仅接收 username/password，trim/lowercase 后创建 pending member 且不建 session；错误密码与未知用户统一 `INVALID_CREDENTIALS`，只有密码正确后才区分 pending/disabled。 |
| 审批状态机 | `GET /api/admin/users?status=` 以及 approve/disable/reset-password 仅对有效 active admin 且 `must_change_password=false` 的 session 可达；middleware/service 双层稳定拒绝强制改密管理员为 403 `PASSWORD_CHANGE_REQUIRED`。审批只允许 pending member→active，禁止管理员禁用自己，未增加任何角色提升面。数据库部分唯一索引与 bootstrap 事务共同保证最多一名 admin。 |
| 密码与会话撤销 | 管理员重置生成 24 字符加密随机临时密码，只在该次 `no-store` 响应显示，设 `must_change_password=true` 并撤销全部 session；临时登录只保留 session/logout/change-password，所有 admin API 失败关闭。改密验证当前密码，成功后设 false、撤销全部 session 并清除严格 `__Host-ppt_session` Cookie，新密码重登后恢复管理权限。 |
| Origin 与 BFF | 所有 API 写请求现在必须带精确 Origin；生产只接受 `https://ppt.ajjy-ai.site`，测试/本地只接受明确 loopback Origin。现有 Presentation/Recovery BFF 只向 loopback API 转发受控 Origin，旧旅程的 Chrome 回归保持通过。 |
| 持久限流与 IP 信任 | 注册固定 3/IP/小时；登录同时消耗 5/(IP+username)/15 分钟与 20/IP/15 分钟桶。全部复用 P12 `auth_throttle`，仅持久化加域 SHA-256 key，关闭/重开隔离 SQLite 后阻断仍生效。loopback API 忽略浏览器可控 `Forwarded`/`X-Forwarded-For`/`X-Real-IP`，只接受内部单值合法 `X-PPT-Client-IP`；P15 BFF 必须删除入站副本并从可信连接元数据覆盖，缺失/非法值统一按 loopback 桶。 |
| 追加审计与无秘密诊断 | 成功/失败注册、登录、退出、改密、管理操作、bootstrap 和 Origin 拒绝写入 append-only `audit_events`；只保存固定 action/entity id/诊断码。测试回读证明 raw password、session token、Cookie 和临时密码不进入 audit/diagnostic。认证失败前后 users/sessions 逐字段不变，仅 throttle/audit 允许追加。 |
| 离线 bootstrap | `pnpm seed:admin -- <username>` 仅接受用户名参数，密码与确认值必须在 TTY 中隐藏输入；非交互终端失败关闭，不存在 `--password` 通道，输出仅含公开 User。仅当 admin 计数为 0 时事务创建唯一 active admin；CLI 已显式进入 API `tsconfig`，标准 API/root build 类型检查并产出 `dist/auth/bootstrap-admin.js`。 |
| 验证 | P13 定向 10/10，P12+P13 21/21，全量 Vitest 31 files/762 tests，shell 8/8，shared/API TypeScript，API/root build 通过，真实 Chrome P02 1/1 与 P06–P09 10/10 通过。 |
| 边界 | 未修改 Presentation Owner/Export/recovery 权限模型，未实现 P15 UI，未迁移实际/生产 DB，未访问 sibling 真实 `02` 资产，未修改 CHAIN_STATE/DECISION_LOG、remote/服务器/Caddy/PM2，无 push。 |

P13 未修改 Presentation Owner/Export/recovery 权限，未实现 P14/P15，且无实际/生产 DB、sibling `02`、remote/服务器/push 操作。父监督者已于 2026-08-10 独立复核并要求关闭强制改密绕过与不可信代理头缺口；修正后重跑门禁，结论为 `passed`。

P14 首个 worker `/root/p14_user_ownership` 在只读阶段误执行会遍历父目录的 `find ..`，触发 sibling 目录扫描硬边界后立即停止。该命令只返回本仓库 AGENTS 路径，未读取 sibling 文件内容、未写入或提交。父监督者已废弃该 worker 并以显式仓库路径规则重启 `/root/p14_user_ownership_retry`。

### P14 通过事实与当前证据

| 范围 | 当前已验证结果 |
|---|---|
| 空库所有权迁移 | `0006_p14_presentation_ownership.sql` 为 `presentations.owner_user_id` 增加非空 users FK、`owner_user_id/updated_at/id` 索引与 owner 不可变 trigger。隔离空库通过 quick/FK/FK-check、精确目标 trigger、第 7 条 ledger、缺 owner/未知 owner/owner 变更负向。 |
| 非空阻断 | 旧 schema 的 `presentations`、`presentation_items`、`presentation_exports` 任一计数非零均先备份再拒绝，保持 6 条 ledger 且不新增 owner 列；未知 trigger 同样先备份后阻断。没有自动归属。 |
| 认证与业务隔离 | catalog/PNG/Presentation/Export 均要求 active session 且 `must_change_password=false`；未登录 401、强制改密 403。catalog/PNG 在 A/B 间共享且 catalog 响应不暴露 owner；Presentation/Item/Export 的 list/read/create/rename/add/copy/move/override/delete/export/readback 全部按 session user 隔离，跨用户统一 404，admin 无内容绕过。浏览器提交 owner/user id 字段稳定拒绝。 |
| Export/recovery | Export audit/package manifest 固定 v2 并固定 `ownerUserId`，fingerprint、DB 回读、ZIP 内嵌 manifest 与 recovery 均重验。Recovery 为全局 admin-only 能力，未登录 401、member/强制改密 admin 403；概览不含 fixed owner。恢复成功后同时删除源库和恢复库全部 session，旧 Cookie 随即 401。 |
| 无秘密 | P14 测试回读 backup manifest、audit 和 diagnostic，证明 raw password/session Cookie/token/credential/API key 未进入这些输出；活动 catalog/recovery 路径无 fixed owner 字段。 |
| 验证 | P14+P09 13/13；P06/P09/P11/P14 定向 24/24；全量 Vitest 32 files/767 tests；shell 8/8；shared/API TypeScript；Web check 0 errors/9 条既有 warnings；Web/API/root build 通过；真实 Chrome P02 1/1 与 P06–P09 10/10（含 P08 断网 ZIP 与 P09 隔离恢复）。 |
| 边界 | 只使用仓库 P03 fixture 和隔离 DB/CAS；未迁移实际/生产 DB，未读取 sibling 真实 `02` 资产，未实施 P15，未修改 CHAIN_STATE/DECISION_LOG、`.workbuddy/`、remote/服务器/Caddy，无 push。 |

P14 产品提交相对监督基线恰好一个原子 commit，tracked 工作树干净且只保留用户自有 `.workbuddy/`。父监督者独立复跑 P14+P09 13/13、shared/API TypeScript、shell 8/8 和 root build 2/2，并核对迁移三类非空阻断、A/B CRUD/Export 隔离、admin 无内容绕过、恢复全会话撤销以及凭据/路径边界。初审发现的 catalog/recovery fixed `local-owner` 响应遗漏已在提交前修正，结论为 `passed`。

### P12 通过事实与当前证据

| 范围 | 已验证结果 |
|---|---|
| 无邮箱身份 schema | `0005_p12_auth_core.sql` 新增 `users/sessions/auth_throttle`；username 应用层 trim/lowercase 且 SQL 层锁定 3–32 位规则与 NOCASE 唯一，`role=admin\|member`、`status=pending\|active\|disabled`，部分唯一索引保证最多一名 admin。 |
| 密码与类型 | 共享 User 类型已移除 email/name/旧状态；密码限 10–128 字符，固定 Argon2id `m=19456,t=2,p=1`，存储和校验均拒绝低于策略的 hash。 |
| 固定会话/Cookie | 每次生成 32-byte 加密随机 token，DB 仅存 SHA-256；`expires_at=created_at+604800000`，验证不滚动、session UPDATE 被 trigger 禁止，删除/改密/禁用立即失效。Cookie 固定 `__Host-ppt_session; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`，无 Domain，严格拒绝重复、引号、编码、控制字符和超长头。 |
| 持久限流 | `PersistentAuthThrottle` 只存加域 SHA-256 key，SQLite immediate transaction 更新固定窗口/阻断时间；关闭并重开 DB 后阻断状态仍有效。 |
| Lucia/旧链 | API manifest、lockfile、安装树和保留源码无 Lucia/适配器；旧 auth/admin 模块改为不挂载的 fail-closed 404 占位，旧 middleware 同样 fail closed；未开放注册页或 P13 API。 |
| 迁移/恢复 | journal、目标表/trigger allowlist 与 P09 recovery 的表集合/六条 ledger 已对齐。P12 隔离测试覆盖空库、既有五迁移库、重复迁移、未知表/trigger/缺失 trigger 先备份后拒绝，旧 trigger SQL 不变，业务表计数不变，quick/FK/ledger/隔离恢复通过。 |
| 定向与全量 | P12 Vitest 11/11；全量 Vitest 30 files/752 tests；shell 8/8；shared/API TypeScript；Web check 0 errors/9 条既有 warnings；Web/root build；P02 Chrome 1/1 与 P06–P09 Chrome 10/10 通过。 |
| 边界 | 未迁移实际/生产 DB，未访问 sibling 真实 `02` 资产，未实现 P13/P14/P15，未修改 CHAIN_STATE/DECISION_LOG、remote/服务器/Caddy/PM2，无 push。 |

P12 未迁移实际/生产 DB，未访问 sibling 真实 `02` 资产，未实现 P13/P14/P15，且无 remote/服务器/push 操作。父监督者已于 2026-08-10 独立核对提交边界、迁移与身份负向、定向测试、类型检查和 shell 全回归，结论为 `passed`。

### P11 通过事实与当前证据

| 范围 | 已验证结果 |
|---|---|
| 可复现依赖与构建 | 根 `package.json` 固定 Node `22.x`、pnpm `9.15.0`，`.node-version` 为 `22`；Web manifest/lockfile 正式声明 `@sveltejs/adapter-node@^5.5.7` 并移除未使用 adapter。`CI=true npx -y pnpm@9.15.0 install --frozen-lockfile` 成功；根 `pnpm build` 的 API/Web 两个 Turbo build 均成功，Web 明确输出 `Using @sveltejs/adapter-node`。 |
| 干净树复现 | 从精确 staged index 导出到 `/tmp/p11-clean.jFXsIF`（无既有 `node_modules`/build 输出），frozen install 复用 514 packages 后，根 build 与 P11 定向测试成功。宿主只有 Node `24.18.0`，所以出现预期 Node 22 engine warning；Node 22 由 manifest、`.node-version` 与 all-branch CI 固定。 |
| 健康与只读 | API 新增 `GET /api/health/live|ready`，ready 执行 SQLite `SELECT 1`，失败只返回 `503 APP_NOT_READY`；Web 增加受控同源 health BFF。`APP_READ_ONLY=true` 时所有 API `POST|PATCH|PUT|DELETE` 在服务层统一返回 `503 {"error":"APP_READ_ONLY"}`，catalog/PNG 与其他读取不被该开关拦截；API 启动日志改为不含秘密的 JSON。 |
| CI 与旧部署 | CI 已改为所有 push/PR、Node 22.x、pnpm 9.15.0 frozen install。旧 CUNY/Tailscale SSH workflow 被无远程动作的 `Deployment guard` 替代，主动 `git push`/SSH 的 `deploy-staging.sh` 已退役；当前 `.github` 无旧主机、密码 secret 或 ssh-action 引用。 |
| 临时运维资产 | `ops/caddy/Caddyfile.p11-read-only` 只允许 health 与 catalog/PNG 的 GET/HEAD API，其他 `/api/*` 返回稳定只读 503；JSON 日志 10 MiB/10 files/30 天/0600。README 固定 G1 前不得应用，并给出备份路径、两次 validate、reload 与只恢复 Caddy 配置的回滚模板。P11 没有执行服务器、Caddy 或 PM2 写操作。 |
| 定向与全量回归 | P11 Vitest 4/4；全量 Vitest 29 files/741 tests；shell 8/8；shared/API TypeScript；Web check 0 errors/9 条既有 warnings；Web/root build 通过；`git diff --check`、`git diff --cached --check` 通过。 |
| 当前环境限制 | 本机没有 Node 22/corepack，Docker CLI 存在但 daemon socket `/Users/rosswang/.docker/run/docker.sock` 不存在，因此未伪称 Node 22 本机执行或 Caddy 容器 validate。两次 npm Node22 临时探测卡在其架构包安装器，已只终止 worker 自己启动的精确进程树；未触碰用户进程。 |

P11 未修改 schema/migration、用户/登录/Owner、实际 DB/CAS、remote 或服务器，也未读取/扫描 sibling 真实 `02_HTML_PPT_组件与模板`。`.workbuddy/` 保持用户自有未跟踪状态。父监督者已于 2026-08-10 独立核对提交数、差异边界、定向测试、类型检查、Web 生产构建和 shell 结构回归，结论为 `passed`。

### 当前事实与不确定性

- 当前网站可正常访问；已捕获的故障是 CSS/JS 网络加载失败后的无样式页面，不是 UTF-8 编码错误。
- 因事故时没有 Caddy access log，不能把单一网络/代理原因写成已确认根因；计划通过日志、健康检查和可复现发布补齐证据。
- 线上 DB `quick_check=ok`、foreign key check 0、5 migrations；1 asset、0 presentation/item/export。P17 必须现场重查，结果漂移即阻断。
- 本地工作树在计划文件修改前仅有用户自有 `.workbuddy/` 未跟踪目录；不得 stage 或修改它。

### 范围与外部状态

- 本轮只新增/修订 implementation 计划文档和机器状态；未修改产品源码、依赖、数据库、服务器、Git remote 或 GitHub。
- 用户明确豁免同类项目研究；`RESEARCH_REPORT.md` 只记录该决定，不把候选项目作为基线。
- 三层审批门见 `DECISION_LOG.md`；旧 P01–P10 完成证据继续保留在本文件后续历史部分。

## 历史 P01–P10 状态与证据（保持不变）

## 当前状态

- 当前阶段：**P10 MVP 验收与本地交付已完成并通过门禁**
- 下一阶段：**无（按计划停止；不得创建 P11）**
- 当前分支：`personal/asset-library-mvp`
- P00 基线提交：`d5f4d3e3586058c560a5c8ae2af97a4e67a639f6`
- 上游基线：`upstream/main` @ `15b1a2713894bcde36a848d997f51d67760b441c`
- P01 决策：`docs/implementation/ADR-P01-local-owner-mvp.md`
- P02 决策与证据：`docs/implementation/handoffs/P02.md`

## P10 MVP 验收与本地交付

### 证据分层

| 层级 | 当前结论 | 不可外推的边界 |
|---|---|---|
| 规范 | `MASTER_PLAN.md` 的六项全局不变量、P03 v1 契约和 P01 ADR 仍是验收准绳。 | 规范不是运行证明。 |
| 当前 fixture-only 验证 | 仓库内唯一 `fixtures/p03-simulated-template/` 经 P04 CAS、P05 Chrome PNG、P06 catalog、P07 固定版本 Presentation、P08 离线 HTML/ZIP、P09 隔离恢复的完整旅程当前重跑通过。 | 它不证明 sibling `02_HTML_PPT_组件与模板` 的任何真实 HTML 或素材。 |
| 当前实际目标只读验证 | `apps/api/data/asset-library.db` 以 `mode=ro&immutable=1`、`query_only=ON` 回读：`quick_check=ok`、`foreign_keys=1`、`foreign_key_check=0`、5 条 migration，content/asset/version/derivative/presentation/item/export/job 均为 0；CAS 根不存在。 | 只证明空业务目标的完整性和非破坏恢复，不证明实际素材或全对象恢复。 |
| 当前实际备份/恢复只读验证 | P09 backup/restore 的 manifest、snapshot DB、restore report 及目标 DB/WAL/SHM 前后 SHA-256 一致；备份和恢复库同样 `quick_check=ok`、FK 开启、5 条 migration。对象、派生物、Presentation、export 计数都为 0。 | P04-P08 的有对象恢复证明仍只来自 fixture-only 隔离测试。 |

### 当前可重复验收

| 范围 | 命令/实测结果 |
|---|---|
| P02-P09 unit/API/fixture 旅程 | `P05_CHROMIUM_PATH=... P06_CHROMIUM_PATH=... node_modules/.bin/vitest run`：28 files、737 tests 通过；覆盖 CAS、篡改/缺失、路径穿越、符号链接、未声明文件、陈旧 revision/state/manifest、并发/重复、备份/恢复中断、只读/权限、Owner/Host/Origin、旧路由、离线与模板执行边界。 |
| 既有 shell/shared | `bash tests/run_all.sh`：8/8 suites；`node_modules/.bin/tsc --noEmit -p packages/shared/tsconfig.json` 与 `node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json --rootDir .`：通过。 |
| Web | `svelte-kit sync`、`svelte-check --tsconfig ./tsconfig.json`：0 errors、9 条既有上游 warnings；`vite build`：通过（既有 a11y/chunk/adapter warnings）。 |
| Chrome 回归 | `playwright test --config=playwright.p02.config.ts`：1/1；`playwright test --config=playwright.p06.config.ts`：10/10，使用隔离 loopback DB/CAS 和 P03 fixture，含 P08 断网 ZIP（0 HTTP(S)、0 cookie、0 script/iframe/form）与 P09 隔离恢复。 |
| 根构建限制 | `pnpm build` 当前仍在 pnpm ignored lifecycle scripts（`better-sqlite3`、`esbuild`）审批前失败；未运行 `pnpm approve-builds`，自动生成的 `allowBuilds` 占位已移除，lockfile/审批策略未变。直接 API/Web build 已通过。 |

### 全局不变量与 P02-P09 门禁结论

| 项目 | 当前结论与证据 |
|---|---|
| 1. 固定 TemplateVersion | P07/P08/P09 unit/API/Chrome 当前回归通过：item/export 固定具体 version/source hash，current version 漂移、陈旧 revision 和跨 item 均拒绝。 |
| 2. 内容哈希追加写 | P04/P05/P08/P09 当前回归通过：CAS/PNG/export 的 SHA-256、冲突、迟到失败、篡改/缺失和恢复后回读均受测。 |
| 3. fixture-only | 当前 test/E2E 输入只为 P03 fixture；P10 未读取、扫描、导入、复制、移动或改写 sibling 真实资产。 |
| 4. slot 非执行 | P03 契约、P07 slot 负向测试和 Web/Chrome 回归共同证明仅受控 text/color JSON；活动 Web 不注入模板 HTML，不使用 iframe/srcdoc/blob/可执行字符串。 |
| 5. 本机/包内预览导出 | P05 Chromium request policy、P08 断网 ZIP 和 P09 重放当前通过；外网、cookie、父目录、外部 iframe/form/script 默认拒绝。 |
| 6. 阶段记录 | 本状态、`handoffs/P10.md` 与 `LOCAL_DELIVERY.md` 已更新；本阶段无产品代码或 schema/migration 修改。 |
| P02-P09 | 对应 handoff 的实现、负向安全与环境限制已由上列当前全量 unit/shell/type/Web/Chrome 复测，而不是只引用历史结论。 |

### P10 门禁结论

1. 全局不变量与 P02-P09 有当前可复现证据，且 fixture、实际空目标和规范边界已分层记录：**通过**。
2. P03 fixture-only 的 P04-P09 正/负向端到端、恢复后 SQLite/ledger/CAS/P05/P07/P08 重验：**通过**。
3. loopback/Owner、Host/Origin、旧能力 404、无半写/无覆盖和 Web 非执行边界：**通过**。
4. 实际 SQLite/CAS/export/backup 的 immutable/query-only 检查与前后状态：**通过（实际业务目标为空）**。
5. 全量验证：**通过，根 `pnpm build` 的外部审批门禁如实保留，未改变策略**。
6. 本地交付说明：见 `docs/implementation/LOCAL_DELIVERY.md`；无发布、部署、remote 变更或 push：**通过**。

**P10 门禁结论：通过。MVP 在本地验收完成，按 `MASTER_PLAN.md` 停止；不创建 P11 或任何后续阶段。**

## P09 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 可审计备份清单 | 新增 `LocalRecoveryService` 与 `asset-library-local-backup/v1` canonical manifest。清单固定 SQLite 一致性快照、当前/快照数据库 SHA-256、5 条 migration ledger 及 SQL SHA-256，并从索引穷举 P04 `content_objects`、P05 preview/thumbnail、P07 Presentation/revision/item 固定 TemplateVersion、P08 manifest/HTML/ZIP；每个受控对象都有明确相对路径、字节、媒体类型、角色与 SHA-256。对象、记录、备份数量均有硬上限。 |
| 非破坏隔离恢复 | 备份先写隐藏临时目录并完整自校验，再原子 rename；恢复先完整验证备份，只能写全新 `restore-<backup-id>` 隔离目录，数据库、对象与 `restore-report.json` 全部完成重验后才原子 rename。目标存在、任何中断或校验失败均清理临时目录，绝不覆盖原库、原 CAS、原派生物、原 export 或既有恢复。 |
| SQLite/CAS/P05-P08 重验 | 源、备份和恢复库均验证目标 table allowlist、`quick_check=ok`、`foreign_keys=1`、`foreign_key_check=0`、migration ledger；内容对象从 DB 索引反推并重验 CAS 路径/字节/SHA，P05 重验同 renderer 完整 pair、PNG 签名与 1280×720/320×180、隔离诊断，P07 重验连续 position 和固定版本内容摘要，P08 使用原 repository 重验 canonical manifest、HTML、ZIP、CRC/allowlist 与全文件哈希。 |
| 路径与故障边界 | API 不接受文件路径，只接受有界 SHA-256/受控 backup id；相对路径必须匹配 digest 派生 allowlist，拒绝绝对路径、父目录、反斜线、协议、符号链接、未声明文件。DB/CAS/manifest/ZIP 缺失或篡改、陈旧 source/manifest、备份/恢复中断、重复恢复、只读/权限失败均被测试拒绝；诊断限 300 字，清理换行、路径和凭据形态。 |
| API/Web | P02 活动 composition root 只新增 `/api/recovery`、备份、manifest 和恢复端点，沿用固定 Owner、loopback Host/Origin、16KB JSON 与无 query 限制；旧 `/api/auth`、`/api/admin`、`/api/export`、`/api/preview`、`/api/search` 等保持 404。Svelte 只渲染受控 JSON/链接，支持加载、失败、Manifest、备份、隔离恢复、成功焦点与 680px 响应式；无模板 HTML 注入、iframe/srcdoc/blob。 |
| fixture-only 恢复旅程 | P09 unit 在隔离临时 SQLite/CAS 中只登记仓库内 P03 fixture，经真实 P04/P05/P06/P07/P08 路径生成 PNG、固定版本 Presentation 与离线 export，再备份/恢复并重放 catalog、PNG、Presentation、manifest/HTML/ZIP；Playwright 覆盖键盘焦点、响应式、重复恢复与不安全/旧路由。P08 离线回归继续证明 0 HTTP(S)、0 宿主 cookie、0 active element。 |
| 实际目标只读预检与演练 | 实际 DB 先以 `mode=ro&immutable=1`、`query_only=ON` 预检：SHA-256 `7c4d335c80cbf99327f2dbde8790222ddf4c35f82358a7824702ab56f4ee7579`、5 migrations、完整性/FK 通过、7 个业务计数全 0，无未知数据。P09 无 schema/migration 变化。实际备份 `backup-1786210962800-392080b2-b4ae-4768-bbf2-5784848fbc3b` manifest SHA-256 `a0062c968109f66a64a14e291fc4aaf0399cece6a88c23419eb64ec203d5e7b9`；备份/恢复 DB 均为 `a753c907d4b1976c73e1ab6b29b453ea831b6c650854b630c217b1d6c90acf5c`，state SHA-256 `3ab83a561486b4f63c665c9af977bd605bdb3e3ba948d9d86285894502d4b573`。原 DB/WAL/SHM 前后哈希和业务状态完全不变。 |
| 验证 | Vitest 28 files/737 tests；shell 8/8；shared/API TypeScript；Web `svelte-check` 0 errors（9 个上游 warnings）与 Vite build；真实 Google Chrome P02 1/1、P06-P09 10/10。根 `pnpm build` 仍受 pnpm ignored lifecycle approval 阻断，自动占位已精确移除且审批策略未变。 |
| 禁区 | 没有读取、扫描、导入、复制、移动或改写 sibling `02_HTML_PPT_组件与模板`；没有实施 P10 最终验收、P11、旧在线能力、身份/RBAC/approval、云服务、remote/push/发布/部署。 |

## P09 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 清单固定 DB/ledger/CAS/P05/P07/P08 与全部 SHA-256 | 通过 | `tests/p09-local-recovery.test.ts` 8/8；canonical manifest 与恢复后 DB 索引逐字段比对 |
| 全新隔离恢复且原状态不变 | 通过 | fixture-only 全数据恢复、实际空业务库恢复演练；临时目录校验后原子 rename，源 DB/WAL/SHM 哈希前后相同 |
| 缺失/篡改/路径/中断/重复/陈旧/权限失败安全拒绝 | 通过 | P09 unit 故障注入覆盖 DB/CAS/manifest/ZIP、traversal/absolute/symlink/undeclared、backup/restore interruption、repeat/stale/read-only；无半目录/覆盖/秘密 |
| 恢复环境核心旅程、离线与旧能力 404 | 通过 | fixture-only P06/P07/P08 重放；P09 E2E 2/2；P08 offline 回归 0 HTTP(S)/cookie/active element；P02/P06-P09 API/E2E 旧路由 404 |
| Owner/loopback、参数边界、Web 不执行与 P04-P08 回归 | 通过 | 活动 composition root/Host/Origin/JSON/query 测试；全量 Vitest/shell 与 P02/P06-P09 Chrome 回归 |
| SQLite/migration/实际库 | 通过 | immutable/query-only 前后回读，5 条 ledger/SQL hash、quick/FK/FK-check、空库/已有库重复迁移均通过；P09 无 migration |
| 全量验证与范围 | 通过（根构建限制已记录） | 737 Vitest、8/8 shell、shared/API/Web checks、P02 1/1 + P06-P09 10/10 Chrome、`git diff --check` |

**P09 门禁结论：通过。** 只有 P09 原子提交、干净工作树和本状态/交接文件共同成立后才可去重创建 P10；P10 只做 MVP 最终验收与本地交付，通过后停止且不得创建 P11。

## P08 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 固定 revision 导出 | 新增 `PresentationExportRepository`，每次 POST 必须提交当前 `expectedRevision` 与按 position 精确排列、无重复的 `itemIds`；在 SQLite 事务中读取快照，生成后再于最终事务重读并比较快照指纹。陈旧 revision、未知/跨 Presentation item、空/重复 item、不可用固定版本或中途变化均拒绝，无导出记录或内容对象登记。 |
| 来源与 P05 重验 | 每个 item 只读取其已固定 `template_version_id`，重新验证 verified/available、source/content digest、P04 CAS 相对路径/字节/实际 SHA-256、规范 P03 包身份/slot schema，以及同 renderer 的 P05 preview/thumbnail PNG pair、CAS 哈希和 1280×720/320×180 尺寸；不依赖 asset current version。 |
| HTML/slot 边界 | 仅对 P03 fixture profile 的已验证 HTML/CSS 做静态受控组装；text slot 经过 HTML 转义，color slot 只接受 P07 已验证 hex 值，CSS 作用域隔离。成品 HTML 自包含且无外链、父目录、`file:`/data/blob/javascript URL、script、iframe、form、事件属性或宿主 cookie；Web 只显示 JSON/安全 PNG 和下载链接，不注入模板 HTML、iframe/srcdoc/blob。 |
| ZIP 与 manifest | 使用固定时间戳、UTF-8、stored-entry 的本机 ZIP writer；文件路径仅允许明确相对 allowlist，禁止绝对/父目录/反斜线/协议/重复路径。audit manifest 固定 Presentation revision、item position、具体 TemplateVersion、slot overrides、source/content SHA-256、P05 derivative SHA-256、每个文件 SHA-256/字节/媒体类型及 HTML/ZIP SHA-256；每次 list/read/download 都重验 CAS、canonical manifest、ZIP local/central/CRC、allowlist 和全部文件哈希。 |
| 追加写与失败诊断 | HTML、ZIP、audit manifest 以 SHA-256 追加写 P04 CAS；`presentation_exports` 仅在全部对象与最终 revision 复核成功后事务登记，同 Presentation revision 幂等回读既有已验证导出。表和导出对象引用不可更新/删除；失败只返回 300 字以内非秘密诊断，不覆盖既有输出，也不改变 Presentation/item/TemplateVersion/P05 派生物。 |
| API/Web | 活动 P02 composition root 只新增 `/api/presentations/:id/exports` 与其 manifest/html/zip 回读；固定 Owner、loopback Host/Origin、无 query、16KB JSON、受限 id/item 数继续生效；旧 `/api/export`、preview/auth/admin/search 等保持 404。Svelte UI 覆盖加载、空态、失败、revision 冲突重载、键盘焦点、下载入口与 680px 响应式。 |
| migration/实际库 | 新增 `0004_p08_presentation_exports.sql` 与 4 个 current-revision/content-type/append-only trigger。实际库迁移前业务表全 0、`quick_check=ok`、4 migrations，备份 `asset-library.1786209246469.pre-migration.db` SHA-256 为 `ca65c083e5478a0aab4e6b3bb877e78a875b8bdfef71d5958ab2fd2fc55f8dad`；迁移后 SHA-256 `7c4d335c80cbf99327f2dbde8790222ddf4c35f82358a7824702ab56f4ee7579`、5 migrations、`foreign_keys=1`、`foreign_key_check=0`、业务表仍全 0。实际重复迁移备份 `asset-library.1786209246723.pre-migration.db` 后哈希不变。 |
| 验证 | Vitest 27 files/729 tests；shell 8/8；shared/API TypeScript；Web `svelte-check` 0 errors（9 个上游 warnings）与 Vite build；真实 Google Chrome P02 1/1、P06-P08 8/8。P08 离线用例在断网 context 解包打开，仅访问解包目录内受控 `file:` 入口，0 HTTP(S)、0 cookie、0 active element。根 `pnpm build` 仍受 pnpm ignored lifecycle approval 阻断，自动占位已精确移除且审批策略未变。 |
| 禁区 | 没有读取、扫描、导入、复制、移动或改写 sibling `02_HTML_PPT_组件与模板`；没有实施 P09 恢复、P10 验收、P11、旧在线 export route、身份/RBAC/approval、云服务、remote/push/发布/部署。 |

## P08 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 固定 revision 生成/读取 HTML/ZIP 与完整 UI 状态 | 通过 | `tests/p08-presentation-export.test.ts` 6/6；`e2e/p08-offline-export.spec.ts` 3/3 |
| manifest 固定 item/version/source/override/output hash 且既有导出不漂移 | 通过 | P08 unit 覆盖 manifest/ZIP 全哈希回读、同 revision 幂等、current version 置空后既有 manifest 不变 |
| 受控相对文件与离线断网打开 | 通过 | stored ZIP local/central/CRC/allowlist 重验；Chrome 离线打开只访问解包目录，0 HTTP(S)/cookie/script/iframe/form |
| CAS/revision/JSON/path/URL/跨 item/不可用/篡改负向及无半写 | 通过 | P08 unit/API 覆盖 stale、unknown/cross/duplicate/empty item、malformed JSON/manifest、query/path/active URL、unavailable version、CAS tamper，失败时 export/content 计数不变 |
| Owner/loopback、旧能力 404、Web 不执行模板 | 通过 | P02/P06/P07/P08 API 与 E2E 回归；HTML 仅为带 attachment/CSP 的导出物回读，宿主页面无 iframe/srcdoc/blob/HTML 注入 |
| migration/SQLite/P04-P07 不变量 | 通过 | 空库/重复迁移、实际库备份/哈希/quick_check/FK、append-only trigger、全量 P04-P07 回归通过 |
| 全量验证与范围 | 通过（根构建限制已记录） | 729 Vitest、8/8 shell、shared/API/Web checks、P02 1/1 + P06-P08 8/8 Chrome、`git diff --check` |

**P08 门禁结论：通过。** P09 仅可在 P08 原子提交、干净工作树和本状态/交接文件共同成立后创建。

## P07 完成事实

| 项目 | 已验证事实/决策 |
|---|---|
| 本机 Presentation 旅程 | 活动 P02 composition root 新增仅限 localhost 单 Owner 的 Presentation 创建、读取、重命名、加入、复制、删除、排序与 slot revision API；Web 仍以 P06 catalog/安全 PNG 为唯一模板选择与呈现边界，具备加载、空态、错误、冲突重载、键盘焦点和 680px 响应式 E2E 证据。 |
| 固定版本与 catalog 资格 | 加入项目时服务端重新验证 asset active、其 current version、verified/available、source/CAS 一致和完整同 renderer P05 PNG pair；`PresentationItem.template_version_id` 永久固定，后续 asset current version 改变不会改写既有 item，retired 版本不能新增。 |
| revision/排序事务 | 每项逻辑写入要求 `expectedRevision`；单一 SQLite transaction 检查 CAS、写 item/name、重建连续 0 起 position、再恰好递增一次 revision/updated_at。陈旧请求、非法 position、跨 Presentation item、未知 item/version 和失败输入均回滚且不产生重复 item 或 revision 漂移。 |
| slot 覆盖 | 只接受对应 TemplateVersion schema 声明的 text/color JSON string；强制大小/长度上限，拒绝未声明 key、HTML、控制符、JS/data/file/HTTP URL、路径、非字符串和非 hex color。`0003` 还修正 P02 trigger 对 slot schema 对象的 JSON id 比较；Web 只绑定受控文本，从不注入模板 HTML。 |
| migration/实际库 | `0003_p07_presentation_items.sql` 前向移除 P02 的“不可排序/只能末尾删除”阶段限制，保留 template version 固定与 slot 声明 trigger。实际库迁移前已只读确认目标表、`quick_check=ok`、无未知数据和所有业务表 0；自动备份为 `apps/api/data/backups/asset-library.1786207558184.pre-migration.db`（SHA-256 `a501811f7b328fd36799049a5b2596b84d385f45b036ff6f9b77720aaab1bba9`），迁移后 SHA-256 `ca65c083e5478a0aab4e6b3bb877e78a875b8bdfef71d5958ab2fd2fc55f8dad`、4 migrations、`foreign_keys=1`、`foreign_key_check=0`、业务表仍为 0。 |
| 验证 | Vitest 26 files/723 tests；shell 8/8；API TypeScript；Web `svelte-check` 0 errors（9 个上游 warnings）与 Vite build；真实 Google Chrome P06+P07 5/5。根 `pnpm build` 仍受 pnpm ignored lifecycle approval 阻断，未改变审批策略。 |
| 禁区 | 没有读取、扫描、导入、复制、移动或改写 sibling `02_HTML_PPT_组件与模板`；没有 P08 export、P09/P10、旧 auth/admin/sharing/lock/presence/provider/preview/export/search 路由、身份/RBAC/approval、云服务、remote/push/发布/部署。 |

## P07 门禁

| 要求 | 结果 | 证据 |
|---|---|---|
| 创建/读取/重命名/加入与清晰 UI 状态 | 通过 | `tests/p07-presentations.test.ts` API，`e2e/p07-presentations.spec.ts` Chrome 2/2 |
| 固定 verified/available current version | 通过 | P07 unit 覆盖版本固定、retired 拒绝；加入查询重验 P06 catalog 条件 |
| 连续排序、复制、删除与无半写入 | 通过 | P07 unit 覆盖 add/copy/move/delete 的 0 起连续位置与 transaction 回滚 |
| revision CAS | 通过 | P07 unit/API 覆盖每次成功递增一次和 stale 409 数据不变；E2E 覆盖冲突重载 |
| slot 安全与模板不执行 | 通过 | 已声明 title/color 成功，未声明/HTML/JS/URL/path/类型错误拒绝；P06 Web DOM 负向回归继续通过 |
| loopback/旧路由 | 通过 | P02/P06/P07 API 与 Playwright 回归：固定 Owner、Host 421、Origin 403、旧能力 404 |
| migration/SQLite/P04-P06 不变量 | 通过 | 空库/重复迁移测试、实际库备份/哈希/`quick_check`/FK 回读；P04/P05/P06 测试均通过 |
| 全量验证与范围 | 通过（根构建限制已记录） | 723 Vitest、8/8 shell、type/Web build、P06+P07 Chrome 5/5、`git diff --check` |

**P07 门禁结论：通过。** P08 仅可在 P07 原子提交、干净工作树和本状态/交接文件共同成立后创建。

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
