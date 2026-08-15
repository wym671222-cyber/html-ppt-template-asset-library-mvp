# 交互模板 v2 终局恢复与上线主计划

- 状态：已批准并执行
- 计划版本：2.1
- 实施分支：`feat/interactive-template-v2-export`
- 基线提交：`a7437024d471f6f4679202824ddd30a060642055`
- 终局阶段：P03B

## 全局边界

- 新备份原子写为 `/data/recovery-backups/<backupId>.zip`；内部 manifest/SQLite/CAS 验证不放宽。
- 旧有效目录只读兼容；旧无效目录保留并显式隔离；重复 ID 整体失败。
- 不读取两个真实来源目录；十二包仅由仓库内 P05 确定性生成器产生。
- 生产写入只发生在 P03A/P03B 且前置恢复门禁通过之后。

## 阶段

| ID | 标题 | 模型 | 推理 | 上下文 | 依赖 | 后继 |
|---|---|---|---|---:|---|---|
| P00 | 恢复链初始化与失败基线 | gpt-5.6-sol | high | 30% | 无 | P01 |
| P01 | 密封备份架构 | gpt-5.6-sol | xhigh | 50% | P00 | P02 |
| P02 | 候选与独立门禁 | gpt-5.6-sol | xhigh | 40% | P01 | P03A |
| P03A | PocketBay 双版本同步证明 | gpt-5.6-sol | max | 50% | P02 | P03B |
| P03B | 业务迁移与终局验收 | gpt-5.6-sol | max | 50% | P03A | 无 |

### P00

- 仅新增本链文档、P00 handoff 和一个精确红测；禁止改产品源码、旧链、生产和来源目录。
- 红测必须证明逻辑状态不变、裸 SQLite 物理哈希变化、当前 overview 以精确完整性错误失败。
- 一个原子提交；父级独立复跑红测、旧链哈希、validator 和工作树门禁。

### P01

- 实现密封 ZIP 写入/导入/读取/恢复；旧目录逐项兼容和无效隔离；API/UI 使用 `integrity` 判别联合。
- 主 DB/CAS/root 异常仍整体失败；无效项不得获得 manifest/archive/restore/activate 能力。
- 覆盖篡改、缺失、重复 ID、原子失败、平台物理重写模拟和旧客户端安全边界。

### P02

- 全量 Vitest、shell、shared/API/Web build、Web check、真实 Chrome、生产 audit 和凭据/路径扫描通过。
- P01 产品提交为候选 A；P02 只新增门禁证据形成候选 B。证明两提交的运行时/部署代码相同。
- 仅推送精确实施分支，不触碰生产。

### P03A

- 写前核对 v788、30 active、0 v2、历史 revision 18、现有外部 `.pba` 和恢复错误。
- 部署候选 A，创建密封备份并记录归档 SHA-256；部署候选 B 后证明同一归档字节不变并首次隔离恢复。
- 任一门禁失败立即停止；候选 A 失败可回滚 v788，候选 B 失败可回滚 A；不得导入、晋升或退役。

### P03B

- 创建迁移前密封备份并隔离恢复；逐项生成、上传、等待预览和验证 12 个 v2 current，全部成功后软退役 3 个固定 ID。
- 失败时激活迁移前备份并重启验证 30 个 v1；CAS 不清理。
- 成功门禁：27=15+12、12 个 v2、3 个 retire、历史汇报固定 v1、12 类真实交互零外连、混合导出离线成功、最终备份与 `.pba` 成功。

## 公共接口

- `RecoveryBackup` 改为 `integrity: valid | invalid` 判别联合；invalid 仅含受控 ID、storageKind 和泛化 diagnostic。
- `GET /api/recovery` 在主状态健康时返回逐项备份结果；精确无效备份操作继续返回 409。
- 不改变 portable backup manifest v1、外部加密 `.pba` 或恢复激活确认合同。

## 未授权

- 删除或覆盖旧备份、CAS、模板版本；自动升级历史 PresentationItem。
- 操作其他 PocketBay 项目、腾讯服务器链、其他远端或两个真实来源目录。
- 读取、记录或输出任何凭据值。
