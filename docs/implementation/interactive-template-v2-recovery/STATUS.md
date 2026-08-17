# 交互模板 v2 终局恢复与上线状态

- 工作流阶段：executing
- 计划版本：3.1（机械拆分）
- 用户批准版本：3.0
- 当前阶段：P04B 模板资产目录传输
- 活动线程：`/root/p04b_catalog_transfer`
- 最后核实提交：`966bcf95c2e28663286a2dd08f244000b1ae8aa0`
- 下一安全动作：父级从 P04B 原子提交独立复核目录传输、负测、全量回归、构建和工作树门禁；worker 不启动 P05A，不操作生产、远端或真实素材目录。

## 阶段账本

| 阶段 | 状态 | 提交 | 线程 | 门禁 | 证据 |
|---|---|---|---|---|---|
| P00 | passed | `3979fd68d90cdb1902870482300a47d7d82c1543` | `/root/p00_recovery_baseline` | passed | 父级复跑红测精确失败且 exit 1；P09 10/10、validator、旧链哈希和工作树门禁通过 |
| P01 | passed | `87ba2e0373f749d9198d38bde9020703b282c703` | `/root/p01_sealed_backup` | passed | 父级定向 38/38、Shared/API build、Web check/build 与代码合同复核通过 |
| P02 | passed | `b3b33347db436c3f515b1ef3fd6476b1d4704fad` | `/root/p02_candidate_gate` | passed | 父级全量 835/835、Shell、Turbo、Chrome 13/13、prod audit 五级全零与 A/B 运行时一致性通过 |
| P03R | passed | `33a6f5ff0a52d3d9f0abeefbe4ad446966689457` | `/root/p03r_v3_rebaseline` | passed | 六文件边界、validator、diff check、历史状态和工作树门禁通过 |
| P04A | passed | `966bcf95c2e28663286a2dd08f244000b1ae8aa0` | `/root/p04a_live_preview_ui` | passed | 父级 23/23、build、Chrome 8/8、12 v2 真交互、应用内 Browser 及工作树门禁通过 |
| P04B | in_progress | — | `/root/p04b_catalog_transfer` | pending | 只恢复并完成目录传输本地实现；依赖 P04A 已满足 |
| P05A | pending | — | — | pending | 未启动；依赖 P04B |
| P05B | pending | — | — | pending | 未启动；依赖 P05A |
| P06 | pending | — | — | pending | 未启动；依赖 P05B；terminal |

## 被 v3.0 取代的阶段历史

- 旧 P03A：计划 v2.1，原状态 `in_progress`、gate `pending`、线程 `/root/p03a_pocketbay_sync`、无提交；未通过并被 v3.0 取代。
- 旧 P03B：计划 v2.1，原状态 `pending`、gate `pending`、无线程、无提交；未启动并被 v3.0 取代。
- 以上不是 passed 记录，也不授权或表示任何 P04/P05/P06 工作已经开始。

## 当前边界

- v3.0 的 PocketBay/云端生产阶段尚未启动；P04A/P04B 只允许本地产品实现与隔离测试。
- 后继固定顺序为 PocketBay 恢复证明、PocketBay 迁移与目录导出、云端 `119.29.241.146` / `ppt.ajjy-ai.site` 同 SHA 同步。
- 旧 interactive-template-v2 链保持 blocked/failed 历史，不重写。
- 工作树原有 `.workbuddy/` 未跟踪目录保持不读、不改、不暂存。
- 两个真实素材目录保持不读、不改；P04A/P04B 禁止生产、远端和真实素材目录操作。

## P04 split_required

- 原 P04 worker 在约 55–60% 上下文主动停止，没有提交或后继；`git diff --check` exit `0`，未修改 CHAIN_STATE、生产、远端、真实素材目录或 `.workbuddy/`。
- 已有 runtime 与 transfer 草稿均未经过完整测试，不作为通过证据。父级按执行协议机械拆分为 P04A/P04B，批准目标、范围和验收保持不变。

## P04A worker evidence

- worker 只完成 P04A；阶段账本和 `CHAIN_STATE.json` 继续保持 `in_progress / pending / commit:null`，未启动 P04B/P05A，等待父级独立门禁。
- v1 current 模板现在返回 `sandboxed-static` runtime：真实 HTML/CSS 经摘要、身份和静态预览策略复核后内联声明 CSS，响应 CSP 与 opaque `sandbox=""` 同时禁止脚本、外网、导航、下载、frame、worker 和宿主存储能力。v2 保持精确 `sandbox="allow-scripts"`、nonce/session 双层运行时，并仅声明 `replay/reset`。
- 列表卡片仍只有 CAS 重验 PNG；眼睛按钮打开居中大尺寸 16:9 弹窗，首屏为实际 runtime，元数据默认收起。适应窗口、全屏、v2 重播/重置、Esc 先退出全屏再关闭、关闭销毁 iframe 和焦点归还原按钮均已实现。
- 固定运行时命令 `env PATH="/tmp/node22.i31hC1/node-v22.23.2-darwin-arm64/bin:$PATH" "$NODE" "$PNPM_CJS" exec node --version && ... --version && ... --filter @slide-maker/shared build`：exit `0`，Node `v22.23.2`、pnpm `9.15.0`、Shared TypeScript build 通过。
- 首次未给 pnpm 子进程固定 `PATH` 的聚焦测试真实 exit `1`，仅因 `better-sqlite3` ABI 127/137 不匹配；修正子进程路径后从头执行 `pnpm exec vitest run tests/p04a-live-preview.test.ts tests/p02-interactive-runtime.test.ts tests/p06-asset-library.test.ts tests/p15-bff.test.ts`：exit `0`，`4/4 files、23/23 tests`。
- `pnpm --filter @slide-maker/web check`：exit `0`，`0 errors / 9 warnings`；9 条均在未修改的既有文件。`pnpm --filter @slide-maker/api build && pnpm --filter @slide-maker/web build`：exit `0`；API TypeScript 与 Web adapter-node production build 通过，既有 Svelte/Rollup warning 原样保留。
- 应用内 Browser 在 `http://127.0.0.1:5175/` 验证页面 identity、非空 DOM、无 framework overlay、console error/warn `0`；1440×900 为 `280px / 770px / 390px` 三栏和双列卡片，1920×1080 为 `280px / 1250px / 390px` 三栏和双列卡片，两者 document width 等于 viewport、卡片 iframe `0`。v1 实际 heading 可见、sandbox 为空、元数据收起、v2 replay/reset 状态依次为 `replay:1` / `reset:2`，关闭后 iframe `0` 且焦点归还。该 Browser 容器未暴露 Fullscreen API，因此未把它作为全屏通过证据。
- 明确指定 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 执行 `pnpm exec playwright test --config playwright.p06.config.ts e2e/p06-asset-library.spec.ts`：exit `0`，`8/8`；真实全屏进入、退出按钮、第一次 Esc 退出全屏且保留弹窗、第二次 Esc 关闭并归还焦点全部通过，1440×900/1920×1080 与静态 runtime 外连零请求也通过。
- 明确指定同一 Google Chrome 执行 `pnpm exec vitest run tests/p05-interactive-fixtures.test.ts -t "uses a sandboxed offline document and proves every component changes its own observable state"`：exit `0`，过滤后 `1 passed / 3 skipped`；该一项逐个覆盖 12 个确定性 v2，真实 click、drag、wheel 状态变化均通过且 HTTP(S) 请求数组为空。
- 未读取、修改或暂存 `.workbuddy/`；未访问两个真实素材目录、P04B 隔离草稿、生产、PocketBay、云服务器或任何远端，也未 push、部署、回滚或创建后继线程。

## P04A parent gate

- 父级逐文件复核提交 `966bcf95c2e28663286a2dd08f244000b1ae8aa0`，确认 20 文件均属于 runtime、UI、BFF、测试与阶段证据边界；validator 与 `git diff --check` exit `0`。
- 父级在固定 Node `v22.23.2` / pnpm `9.15.0` 下先构建 Shared，再独立复跑 23/23 聚焦测试、API/Web build、Web check `0 errors / 9 pre-existing warnings`，全部 exit `0`。
- 父级真实 Google Chrome 复跑 `8/8`，覆盖全屏、两步 Esc、关闭销毁 iframe、焦点归还和两个桌面视口；12 个 v2 的真实 click/drag/wheel 状态变化与 HTTP(S) 外连零请求门禁 exit `0`。
- 父级应用内 Browser 复核 1440×900 与 1920×1080 三栏双列、无横向溢出、卡片 iframe `0`、v1 真实 DOM/CSS、v2 replay/reset、关闭销毁及 console error/warn `0`。该容器对 Esc 的自动化注入会在页面处理后把焦点重置到 `BODY`，故焦点结论采用指定真实 Google Chrome 的直接 E2E，不伪造容器通过。
- 提交与验收后 tracked worktree 干净，仅保留既有 `?? .workbuddy/`。P04A 通过；父级现按固定顺序启动 P04B，本结论不授权 P05A 或任何生产操作。

## P04B worker evidence

- worker 只完成 P04B；`CHAIN_STATE.json` 继续保持 `P04B / in_progress / pending / commit:null`，等待父级独立门禁，未启动 P05A。
- 新增 `asset-library-catalog-transfer/v1` 确定性密封 ZIP：仅含活动模板资产、标签、全部对应版本/current 指针、模板与 PNG CAS 对象、renderer identity、安全计数诊断、文件摘要、来源目录摘要和 `SOURCE_RELEASE_SHA`；manifest 不含认证、汇报、导出历史、恢复备份或密钥字段。
- 导出与暂存会校验精确 ZIP 文件表、UTF-8 canonical manifest、计数/关系、SHA-256/大小、模板包 canonical bytes、v1/v2 安全策略、v2 allowlist、slot schema、current 元数据、完整 preview/thumbnail pair、PNG 尺寸和 renderer identity。路径穿越、重复 ID、缺失对象、篡改摘要、非法 renderer 和目标冲突均在暂存前失败。
- `POST /api/admin/catalog-transfers` 在 `APP_READ_ONLY=true` 时仍只写隔离 staging 文件、不改业务 DB；apply 无例外返回 `503 APP_READ_ONLY`。apply 重新解析 staged ZIP，在 SQLite `IMMEDIATE` 单事务内复核目标状态、复用同摘要版本、写入模板目录并软退役目标多余活动模板；版本、CAS 和历史 PresentationItem 均不删除。
- apply 前后对 `users`、`sessions`、`auth_throttle`、`presentations`、`presentation_items`、`presentation_exports` 逐表记录 count + SHA-256，并在事务内要求完全一致。数据库中途强制失败负测证明六张目录表整体回滚；仅完整验证后的 immutable CAS 字节可能保留为未引用对象，未验证对象不会进入 live CAS。
- 父级驳回初版后已修复两处语义缺口：已有 manifest 版本同步来源 `status`；manifest 所含版本的 derivative 集合精确同步，目标独有历史版本及 CAS 保留。同 derivative identity 的 content/security/created_at 不一致 fail closed `409`，不会静默覆盖。
- 最终回归证明状态漂移和目标独有较新 renderer 均被 diff 标为 update；apply 后 current 模板可见且目录只选择来源 renderer，二次 validate 为 reuse、二次 apply 成功，受保护指纹不变。导数 delete guard 仅在 `IMMEDIATE` 事务内短暂移除；服务从精确 trigger 名称的 `sqlite_master.sql` 捕获非空定义并在 `finally` 原样恢复。自定义格式的 guard SQL 在成功 reconciliation、幂等 apply 和强制事务回滚后均逐字一致，普通 delete 仍被 append-only trigger 拒绝。
- 管理 API/BFF 固定为 export、stage、apply 三条精确路径，64 MiB 上传上限；匿名为 `401`、member 为 `403`、错误媒体类型为 `415`、过期目标状态为 `409`、只读 apply 为 `503`。BFF 不使用 catch-all proxy，不转发浏览器伪造 forwarding header、内部路径、stack 或秘密。
- 修正 P04A 后遗留的一处 P03 断言：v1 catalog runtime 从旧 `null` 期望更新为已通过 P04A 门禁的 `sandboxed-static` 合同；只改测试，不改退役产品行为。
- 固定 Node `v22.23.2` / pnpm `9.15.0`，先构建 Shared。本次修补最终 P04B `9/9`、聚焦回归 `6 files / 36 tests`、API build、Web check/build 均 exit `0`；Web check 为 `0 errors / 9` 条既有 warning。被驳回候选曾通过的全量 `851/851` 与 shell `8/8` 不作为修补后提交证据，留给父级从 amended SHA 独立复跑。
- 被驳回候选的 API build、Web check/build 和 root Turbo build 均曾 exit `0`，Turbo 为 `3/3 successful`。本次修补已重新通过 Shared/API/Web；修补后 root Turbo 留给父级独立复跑。首次 root Turbo 调用被内部 fallback 解析为 Node 24/pnpm 11，真实 exit `1` 且只触发 engine guard；使用临时 PATH 明确绑定 Node 22/pnpm 9 后从头重跑通过，不把环境误调用记为产品失败或通过证据。
- 全量测试首次发现 P04A 的旧 `runtime:null` 断言，真实为 `1 failed / 850 passed`；更新为批准的静态 runtime 合同后从头重跑为 `851/851`。未执行 production audit，因为本 worker 明确禁止网络；该门禁留给父级/P05A 的获准候选流程。
- 未读取、修改或暂存 `.workbuddy/`；未访问两个真实素材目录，也未触碰 PocketBay、云服务器、生产、凭据、远端、push、deploy、rollback 或后继线程。

## P00 worker evidence

- 起点：`a7437024d471f6f4679202824ddd30a060642055`；模型合同：`gpt-5.6-sol / high`；计划版本：`2.1`。
- 新增 `tests/p00-pocketbay-backup-drift.test.ts`，只使用临时隔离 SQLite/CAS/backup/restore 路径；合法裸目录备份经 `page_size=8192` 与 `VACUUM` 物理重写后，逻辑表状态保持、物理 SHA-256 改变。
- 当前 `LocalRecoveryService.inspectCurrent()` 只因精确错误 `Backup SQLite hash or size verification failed` 失败；测试先断言无 restore 目录、无 activation request、源数据库/CAS 指纹不变，再重新抛出原错误，故命令真实退出 `1`。
- 既有 `tests/p09-local-recovery.test.ts` 为 `10/10` 通过；新链 validator 为 `OK`。旧 `docs/implementation/CHAIN_STATE.json` 与 `docs/implementation/interactive-template-v2/CHAIN_STATE.json` SHA-256 分别保持 `18c97c83c47bfe61b86fb388e5efee5046566b26bd4f13657fa814d04062d53c`、`d60fcb50327aef29cc8aa86ed37fbdabb9e46fd8503d841cb34ef7b131e5cd6f`。
- 本 worker 未修改 `CHAIN_STATE.json`、产品源码、旧链、生产、远端、`.workbuddy/` 或两个真实来源目录；P01 仍为 pending，须由父级独立验收后决定是否启动。

## P00 parent gate

- 父级在固定 Node `v22.23.2` / pnpm `9.15.0` 下独立复跑：P00 红测唯一失败为精确错误，真实 exit `1`；P09 为 `10/10` 通过。
- P00 提交为 `3979fd68d90cdb1902870482300a47d7d82c1543`；tracked worktree 干净，仅保留既有 `.workbuddy/`。
- 官方 validator 通过；旧 interactive 与 PocketBay chain 哈希保持不变。P00 通过并由父级启动 P01。

## P01 worker evidence

- worker 仍只执行 P01；阶段账本保持 `in_progress/pending`，`CHAIN_STATE.json` 未改，等待父级独立门禁。
- 新建与导入备份均持久化为 mode `0600` 的 `<backupId>.zip`；临时文件经过文件 `fsync` 后在同一根目录原子 `rename`，同 ID 提交锁阻止覆盖竞态，根目录在 rename 后 `fsync`。
- portable `asset-library-local-backup/v1`、`backup-manifest.json`、`database/asset-library.db` 与 CAS 相对路径不变；sealed 读取返回验证后的原始 ZIP 字节，每次 manifest/archive/restore/activate 均重新验证 ZIP 文件表、物理与逻辑 SQLite、migration、CAS 和完整索引。
- 旧目录保持只读兼容；目录/ZIP 按唯一受控 ID 聚合，冲突或单项损坏仅返回无能力的 `invalid` 联合项。精确无效操作为 409，missing 为 404；主 DB/CAS/backup root 或唯一 ID 数量边界异常仍整体失败。
- `tests/p00-pocketbay-backup-drift.test.ts` 已转绿：逻辑等价旧目录 SQLite 物理重写后，当前状态正常返回、该项被隔离，且 source/restore/activation 无副作用。
- 固定 Node `v22.23.2` / pnpm `9.15.0`：全量 Vitest `45 files / 835 tests`；指定 P00/P01/P09/P12/P14/encryption `6 files / 38 tests`；shell `8/8 suites`；Shared/API build、Web check/build 全部 exit 0。Web check 为 `0 errors / 9` 条既有 warning。
- 未接触生产、远端、旧链、`.workbuddy/`、`01_AI协会_Workshop_HTML` 或 `02_HTML_PPT_组件与模板`。

## P01 parent gate

- 父级固定 Node `v22.23.2` / pnpm `9.15.0` 复跑 P00/P01/P09/P12/P14/encryption：`6 files / 38 tests` 全通过。
- Shared/API build 通过；Web check 为 `0 errors / 9` 条既有 warning；Web adapter-node build 通过。
- 代码复核确认 portable manifest v1 未变、sealed 每次重新验证、legacy invalid 无操作能力且精确请求 409。P01 通过并启动 P02。

## P02 worker evidence

- worker 只执行 P02；阶段账本保持 `in_progress/pending`，`CHAIN_STATE.json` 未改，等待父级独立门禁。
- 候选 A 为 `87ba2e0373f749d9198d38bde9020703b282c703`；起始协调 SHA 为 `09c192f6f2d40ec2c1b90b066bbdf42493a7aadf`。A 到协调 SHA 仅有新恢复链文档差异，本阶段仅新增 `handoffs/P02.md` 并更新本文件。
- A 与候选 B 的 `Dockerfile`、package manifests/lock、workspace/Turbo 输入、`apps/**`、`packages/**`、`fixtures/**`、`ops/pocketbay/**`、`templates/**` 逐字一致；B 仅由新恢复链 gate evidence 形成不同版本输入。
- 固定 Node `v22.23.2` / pnpm `9.15.0`，且 `pnpm exec node --version` 为 `v22.23.2`：全量 Vitest `45 files / 835 tests`；shell `8/8 suites`；Shared/API/Web build、Web check、root Turbo build 全部 exit `0`。Web check 为 `0 errors / 9` 条既有 warning，Turbo 为 `3/3` successful。
- 真实 Google Chrome：P06/P07/P08/P09 分别 `5/5`、`2/2`、`3/3`、`2/2`，合计 `12/12`；补充 P02 `1/1`。专用端口 `3017/5174/3018/5175` 在对应测试前后均为零 listener。
- production audit `pnpm audit --prod --json` 真实 exit `0`，370 个生产依赖，info/low/moderate/high/critical 全 `0`。完整 audit 真实 exit `1`，638 个依赖，依次为 `0/2/6/1/1`；未 ignore、force、降阈值、override 或修改依赖。
- tracked-file 扫描覆盖候选 B 的 544 个路径：高置信 token 和私钥均 `0`；deployable 凭据赋值、绝对用户路径及禁止真实目录名均 `0`。全 tracked 的 credential-like assignment 为 22 处/6 个测试或 QA 路径；absolute user path 为 36 处/25 个文档、QA 或其他 tracked 路径；未输出任何匹配值。
- `.workbuddy/` tracked/staged 均为 `0`，未读取内容；未触碰生产、远端、旧链、其他项目或两个真实来源目录。父级须从精确 B SHA 独立复核、打包和决定后继。

## P02 parent gate

- 父级在固定 Node `v22.23.2` / pnpm `9.15.0` 下独立复跑：全量 Vitest `45/45 files、835/835 tests`，Shell 全套、Turbo `3/3` 和 production audit 均 exit `0`；生产依赖 `370`，五级严重度全零。
- 真实 Google Chrome 主套件 `12/12`，显式指定 Chrome 的 P02 补充套件 `1/1`；一次未指定浏览器可执行路径的环境调用因本机 Playwright bundled Chromium 不存在而未启动测试，补正为批准的真实 Chrome 后通过，不属于产品回归。
- 候选 A `87ba2e0373f749d9198d38bde9020703b282c703` 与候选 B `b3b33347db436c3f515b1ef3fd6476b1d4704fad` 的运行时和部署输入 diff 为空；从精确提交生成的 tracked ZIP SHA-256 分别为 `d8c4ddd6c80ac3f4293684c66e0cf3c18f590be744218e5ffb976721a7ef61e1`、`d8a8b15bfbd6a84f197588825b2c8656956397b0f72e7c451174b043467dab89`。
- validator 与 tracked-clean 门禁通过；P02 passed，父级启动 P03A。候选归档只位于隔离临时目录，未纳入 Git。
