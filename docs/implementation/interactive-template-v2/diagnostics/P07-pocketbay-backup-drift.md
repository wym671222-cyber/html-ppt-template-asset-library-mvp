# P07 PocketBay 备份 SQLite 漂移诊断

## 结论

Release 326 的业务数据库仍可正常读取，但 PocketBay 版本切换后的 `/data/recovery-backups` 不再满足备份 manifest 的物理完整性合同。当前最符合证据的原因是平台版本数据同步对备份 SQLite 做了物理重写或不完整复制；应用自身启动/迁移路径没有证据会改动这些文件。

这是有边界的根因推断，不是平台内部实现的已确认事实：当前 deploy status 没有暴露文件级 data-sync 日志，PocketBay 控制台仍等待用户登录后只读核对。

## 生产复现

- 写前 Release：264；写后 Release：326。
- 精确部署候选：`66135d5add134da929cb2da7e4810bad340e9ba3`。
- 部署包 SHA-256：`428f0e3d91776e5327371c6e2753fac91b07e73cc4ab4c0ea45ed60967dacb07`。
- 平台切换成功：`next_action=done`、`project_status=running`、无 failure stage；唤醒后 live/ready 为 200。
- 部署前 `/api/recovery` 为 200，当前数据库 `quick_check=ok`、foreign keys 开启、foreign-key check 为 0；7 migrations、90 objects、60 derivatives、1 presentation、0 exports。
- 部署前新备份 `backup-1786771370298-f386009b-a51e-4c2a-88e1-fd135b7a41c4` 的 state SHA-256 为 `0c1ec65b1ac39b74ca919b6afc21030ad064d296c7b7e864e9119eaeb53efb98`，manifest SHA-256 为 `ceb9e9e8f6c227b1e4a9e73649eec78133b1173aa21e5cd66ba8dcb0f5041310`，源数据库物理哈希 before/after 相同。
- 部署后 `/api/recovery`、该备份 manifest 和此前已验证备份 manifest 均稳定返回 409 `Backup SQLite hash or size verification failed`；另一个旧备份返回 `Backup directory is missing`。
- 同期 catalog 仍为 30 active、0 v2；历史 presentation 仍为 revision 18 且四个 item 全固定 v1。主业务数据损坏与模板迁移均不是本次 409 的前提。

## 最小差分环

在 Node `v22.23.2`、pnpm `9.15.0` 下，以临时目录建立 7-migration SQLite 和 `LocalRecoveryService`：

1. 创建合法备份并记录 manifest/SQLite SHA-256。
2. 对 active database 再次执行未变更的 `migrateDatabase()`，模拟 Release 启动路径。
3. 重新读取备份 manifest：物理哈希不变，验证继续通过。
4. 只对备份 SQLite 将 page size 从 4096 改为 8192 并执行 `VACUUM`；所有目标表行数保持完全相同。
5. 重新读取同一 manifest：物理哈希改变，稳定得到生产同一句 `Backup SQLite hash or size verification failed`。

差分结果：

```text
activeStartup.backupHashUnchanged = true
activeStartup.validationPassed = true
physicalRewrite.hashChanged = true
physicalRewrite.logicalCountsUnchanged = true
physicalRewrite.validationError = Backup SQLite hash or size verification failed
```

临时目录在输出结果后删除；没有修改仓库、生产或用户数据。

## 假设裁决

| 假设 | 当前裁决 | 证据 |
|---|---|---|
| PocketBay 版本同步物理重写 SQLite | 最可能，尚待平台侧确认 | 精确错误可由“逻辑不变、物理重写”复现；两个备份同时失配 |
| 应用启动或 migration 改写备份 | 已基本否决 | 基线到候选的 recovery/start/migrate/path/Dockerfile 变更数为 0；本地再次启动迁移不改变备份哈希 |
| 平台复制遗漏/部分复制 | 部分支持 | 一个旧备份目录部署后 missing；其余两个目录存在但数据库物理合同失效 |
| 写前备份与快照并发 | 较弱 | 不同时期的两个备份同时失配，不能由单次新备份竞态解释 |
| 主业务库损坏 | 与当前证据矛盾 | catalog/presentation 和 health 正常，错误发生在 backup SQLite 物理校验 |

## 修复门禁

当前没有可在原 P07 合同内完成的安全修复。放宽或移除物理哈希、跳过坏备份、删除备份目录或把 409 降级为 warning 都会破坏 fail-closed 恢复合同。

若继续使用 PocketBay 版本同步，需要新的架构批准和部署级回归 seam。候选方向可以评估把 SQLite snapshot 封装为平台视为不透明的单一归档/二进制对象，同时保留 manifest、逻辑 hash、quick_check、foreign-key check、旧备份兼容和加密 `.pba` 恢复；不得直接改扩展名后跳过内容验证。

新的门禁必须真实覆盖：部署前备份 → PocketBay 候选版本 `/data` 同步 → 部署后逐备份 manifest 验证 → 隔离 restore → 旧 Release 可回滚。仅有本地单元测试不能证明平台数据同步边界。

## 当前停止状态

- v2 import：0。
- current promotion：0。
- retire：0。
- PresentationItem 迁移：0。
- CAS 物理清理：0。
- Recovery activation：0。
- PocketBay version rollback：0；必须等待用户在控制台登录并在动作时确认。
