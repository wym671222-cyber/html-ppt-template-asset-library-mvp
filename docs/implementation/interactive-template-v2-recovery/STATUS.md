# 交互模板 v2 终局恢复与上线状态

- 工作流阶段：executing
- 计划版本：3.0
- 用户批准版本：3.0
- 当前阶段：P04 实时预览与目录传输实现
- 活动线程：`/root/p04_live_preview_catalog_transfer`
- 最后核实提交：`33a6f5ff0a52d3d9f0abeefbe4ad446966689457`
- 下一安全动作：只执行 P04 本地产品实现、隔离测试与一个原子提交；不得启动 P05A、操作生产、远端或真实素材目录。

## 阶段账本

| 阶段 | 状态 | 提交 | 线程 | 门禁 | 证据 |
|---|---|---|---|---|---|
| P00 | passed | `3979fd68d90cdb1902870482300a47d7d82c1543` | `/root/p00_recovery_baseline` | passed | 父级复跑红测精确失败且 exit 1；P09 10/10、validator、旧链哈希和工作树门禁通过 |
| P01 | passed | `87ba2e0373f749d9198d38bde9020703b282c703` | `/root/p01_sealed_backup` | passed | 父级定向 38/38、Shared/API build、Web check/build 与代码合同复核通过 |
| P02 | passed | `b3b33347db436c3f515b1ef3fd6476b1d4704fad` | `/root/p02_candidate_gate` | passed | 父级全量 835/835、Shell、Turbo、Chrome 13/13、prod audit 五级全零与 A/B 运行时一致性通过 |
| P03R | passed | `33a6f5ff0a52d3d9f0abeefbe4ad446966689457` | `/root/p03r_v3_rebaseline` | passed | 六文件边界、validator、diff check、历史状态和工作树门禁通过 |
| P04 | in_progress | — | `/root/p04_live_preview_catalog_transfer` | pending | 大尺寸 v1/v2 runtime 与目录传输本地实现 |
| P05A | pending | — | — | pending | 未启动；依赖 P04 |
| P05B | pending | — | — | pending | 未启动；依赖 P05A |
| P06 | pending | — | — | pending | 未启动；依赖 P05B；terminal |

## 被 v3.0 取代的阶段历史

- 旧 P03A：计划 v2.1，原状态 `in_progress`、gate `pending`、线程 `/root/p03a_pocketbay_sync`、无提交；未通过并被 v3.0 取代。
- 旧 P03B：计划 v2.1，原状态 `pending`、gate `pending`、无线程、无提交；未启动并被 v3.0 取代。
- 以上不是 passed 记录，也不授权或表示任何 P04/P05/P06 工作已经开始。

## 当前边界

- v3.0 的 PocketBay/云端生产阶段尚未启动；P04 只允许本地产品实现与隔离测试。
- 后继固定顺序为 PocketBay 恢复证明、PocketBay 迁移与目录导出、云端 `119.29.241.146` / `ppt.ajjy-ai.site` 同 SHA 同步。
- 旧 interactive-template-v2 链保持 blocked/failed 历史，不重写。
- 工作树原有 `.workbuddy/` 未跟踪目录保持不读、不改、不暂存。
- 两个真实素材目录保持不读、不改；P03R 禁止产品源码、测试、ops、生产和远端操作。

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
