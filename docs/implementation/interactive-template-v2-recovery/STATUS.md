# 交互模板 v2 终局恢复与上线状态

- 工作流阶段：executing
- 计划版本：2.1
- 用户批准版本：2.1
- 当前阶段：P01 密封备份架构
- 活动线程：`/root/p01_sealed_backup`
- 最后核实提交：`3979fd68d90cdb1902870482300a47d7d82c1543`
- 下一安全动作：P01 只实现密封 ZIP、旧备份隔离与恢复 API/UI 合同；不得开始生产或 P02。

## 阶段账本

| 阶段 | 状态 | 提交 | 线程 | 门禁 | 证据 |
|---|---|---|---|---|---|
| P00 | passed | `3979fd68d90cdb1902870482300a47d7d82c1543` | `/root/p00_recovery_baseline` | passed | 父级复跑红测精确失败且 exit 1；P09 10/10、validator、旧链哈希和工作树门禁通过 |
| P01 | in_progress | — | `/root/p01_sealed_backup` | pending | 依赖 P00；实现密封备份架构 |
| P02 | pending | — | — | pending | 依赖 P01 |
| P03A | pending | — | — | pending | 依赖 P02 |
| P03B | pending | — | — | pending | 依赖 P03A |

## 当前边界

- 当前线上保留 v788；不回滚 v710。
- 旧 interactive-template-v2 链保持 blocked/failed 历史，不重写。
- 工作树原有 `.workbuddy/` 未跟踪目录保持不读、不改、不暂存。
- P00 禁止产品源码、生产、远端和真实素材操作。

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
