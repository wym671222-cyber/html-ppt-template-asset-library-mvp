# 交互模板 v2 终局恢复与上线状态

- 工作流阶段：executing
- 计划版本：2.1
- 用户批准版本：2.1
- 当前阶段：P00 恢复链初始化与失败基线
- 活动线程：`/root/p00_recovery_baseline`
- 最后核实提交：`a7437024d471f6f4679202824ddd30a060642055`
- 下一安全动作：P00 只创建精确红测和 handoff，父级独立复核后才允许 P01。

## 阶段账本

| 阶段 | 状态 | 提交 | 线程 | 门禁 | 证据 |
|---|---|---|---|---|---|
| P00 | in_progress | worker candidate pending commit | `/root/p00_recovery_baseline` | worker passed; parent pending | Node v22.23.2 / pnpm 9.15.0 下精确红测 1/1 按设计失败并重新抛出 `Backup SQLite hash or size verification failed`；既有 P09 10/10 通过；等待父级独立复跑 |
| P01 | pending | — | — | pending | 依赖 P00 |
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
