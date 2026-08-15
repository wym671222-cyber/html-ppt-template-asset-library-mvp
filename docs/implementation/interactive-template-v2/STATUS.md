# 交互模板与导出修复状态

- 工作流阶段：blocked
- 计划版本：2.0
- 用户批准版本：2.0（2026-08-14T17:56:07+08:00）
- 当前阶段：P07 生产恢复门禁失败；自动执行链已停止，不存在后继
- 活动线程：无；P07 阶段线程 `01a00120-bf9d-7950-a479-c15a213bed6d` 已停止
- 最后核实结论：P05/P06 仍通过。P07 在 Release 264 上完成 30 项活动目录、12 对 12 组件映射、固定历史 v1 汇报和 SQLite/CAS/备份只读门禁；精确候选 `66135d5add134da929cb2da7e4810bad340e9ba3` 已成功切换为 PocketBay Release 326。切换后业务目录和汇报仍完整，但 `/api/recovery` 及两个原有效备份 manifest 均因备份 SQLite 哈希/尺寸不符返回 409，另一个旧备份目录缺失，因此未执行 12 项 v2 导入/晋升和 3 项 retire。
- 本轮授权：用户于 2026-08-15 明确授权按原合同重开 P05；范围仅限测试视口、真实手势断言、辅助探针移除、摘要刷新和 P05 门禁复跑。
- 下一安全动作：用户先在 PocketBay 控制台登录；父级只读核对 Release 326/264 与数据恢复范围，再由用户在动作时明确决定是否回滚到 264。不得自动回滚，不得继续导入、晋升或退役；若继续使用 PocketBay 版本同步，需另行批准备份 SQLite 存储格式/同步策略的架构修复。

### 历史 P05 worker 有界修复证据（父级已否决）

- 本 worker 已将 12 个 package fixture 改为准确生产 `assetId`/标题和真实交互族，固定 7 个本地库版本并重新审核 12 个规范化 SHA-256；P01 既有摘要未改。
- Node 22.23.2 / pnpm 9.15.0：P05 定向确定性/负例、真实 Chrome 12 项交互、隔离 SQLite/CAS 全量 preview+thumbnail 晋升、精确三目标退役与旧 v1 v3 导出通过。Chrome 预览诊断保持 P02 `networkAuditHitCount=0` 与 `selfNavigationAuditHitCount=0`。
- 父级代码审查确认：`tests/p05-interactive-fixtures.test.ts` 对 D3 仅派发 `pointerdown` 后点击 `star-zoom`，运行时代码又在任意 `pointerdown` 上直接设置 `data-star-dragged=true`；Three.js 只点击 `orbit-spin`；Interact.js 只点击 `layout-nudge`。这些断言绕过了三类真实拖动处理器，不能满足 P05 完成门禁。
- 这是自动流转协议允许的唯一 bounded repair；因此 P05=`failed`、gate=`failed`、workflow=`blocked`。未启动 P06，未推送新候选，未触碰生产 DB/CAS/PocketBay 或两个真实来源目录。

### 历史 P05 blocked 后只读诊断（已闭环）

- 父级在 Node `22.23.2` 和真实 Chrome 上构造未改仓库的临时差分环，分别以当前测试默认 `300×150` 和产品比例 `960×540` 装载同一 `compileInteractiveTemplateRuntime` 输出，连续重复三次。
- `300×150` 下，D3 圆点边界位于约 `(395,370)`，Three canvas 顶部约 `y=211`，Interact 卡片顶部约 `y=227`，均超出外层 iframe 可视区；三项捕获到的 pointer/mouse 事件均为 `0`，状态不变。
- `960×540` 下，三次结果完全一致：D3 圆点从 `400,210` 变为约 `451.69,235.85`，滚轮缩放为约 `1.3947`；Three WebGL 进入 `ready` 且角度为 `2.10`；Interact 位移为 `46,26`。三项均捕获真实按下、带按钮移动、释放事件，HTTP(S) 请求为 `0`。
- 结论：真实库和 drag handler 没有架构性失效；根因是 P05 Chrome 测试未给外层 iframe 指定尺寸，随后用辅助按钮掩盖了裁剪问题。最小恢复边界已经确定，但 v2.0 只允许一次 bounded repair，仍需新批准计划或明确授权重开 P05。
- 完整复现与建议见 `diagnostics/P05-real-drag.md`；本轮没有修改产品源码、测试、白名单或依赖，也没有触碰生产和两个真实来源目录。

## 阶段账本

| 阶段 | 状态 | 提交 | 线程 | 门禁 | 证据 |
|---|---|---|---|---|---|
| P00 | passed | `23a18fe77ee69cdc90f12a1917308faa771bc645` | `019fffb8-ed1b-78c2-bcb3-012d2db19b63` | passed | 父级复核：相对协调提交恰好一个原子提交；P08 精确红测 6/1 且零 partial export；PocketBay 20/20；validator、链哈希、工作树通过 |
| P01 | passed | `f696ee8988f983f297a8d797308f7f73864a1221` | `019fffc5-7541-73c2-85a2-eee7f3555527` | passed | 父级复核：相对协调提交恰好一个原子提交；v2 白名单/候选晋升边界通过；摘要错配零副作用拒绝；build 与 57 tests、计划红基线、validator、链哈希、工作树通过 |
| P02 | passed | `6dba2c0c2556b70a8d823d23591938799b752247` | `01a00074-dbcb-7c01-b683-02efc6422852` | passed | 父级第一次门禁在 `f17a8d0` 复现 self-frame navigation 外泄；唯一 bounded repair 以 opaque supervisor + `frame-src data:` 在发请求前阻断。父级第二次真实 Chrome 证据为 fetch/self-navigation 0 hits、会话保持与伪造序列拒绝；shared/API/Web build、P02/P15 11 tests、40 文件 810 tests、shell 8/8、P08 精确红线与 validator 全部符合 |
| P03 | passed | `901fc2d028449a94a59169cfe0951a53c3b5dff8` | `01a000bf-4ac0-7560-8d6c-5368af742242` | passed | 父级复核：相对协调提交恰好一个原子提交；目录 runtime/按需 iframe/退役边界与安全协议通过；定向 32/32、全量非 P08 41 文件/812 tests、shared/API/Web build、Web check 0 errors、shell 8/8、P08 精确红线与 validator 通过 |
| P04 | passed | `1045dd6752657add984d4a89504ef9aa357697fa` | `01a000d0-a46a-7e00-bb94-fbf9f548477f` | passed | 父级复核：v3 自包含 HTML/ZIP、v1 data:image 与 v2 opaque 离线 runtime、旧 v2 读取兼容、P08 10/10（含真实 Chromium v1/v2）、定向 36/36、全量 42 文件/822 tests、build/check、shell 8/8、validator 通过 |
| P05 | passed | `626ae6d53b4d52b63d7e618386b499e2387a4a43` | `01a000e9-37c1-7361-914f-9d40d844a6ac` | passed | 固定 `1024×768` 浏览器与 `960×540` iframe；D3 拖拽/滚轮、Three pointer drag、Interact drag 均真实改变状态；P05 4/4、全量 43/826、shell 8/8、build/check 通过 |
| P06 | passed | `66135d5add134da929cb2da7e4810bad340e9ba3` | `01a00110-abc1-74b3-b71b-e88f9a02bee6` | passed | 全量 Vitest 43/826、shell 8/8、Chrome 12/12、生产审计全零、扫描和构建通过；候选边界与 validator 通过 |
| P07 | failed | — | `01a00120-bf9d-7950-a479-c15a213bed6d` | failed | 精确候选已切换到 Release 326，但版本数据同步破坏/遗漏服务器备份 SQLite 完整性；业务数据仍为 30 active、0 v2、历史汇报 revision 18 全 v1；导入/晋升/retire 均为 0 |

## 阻塞与不确定性

- P00–P04 仍通过；P02 的 self-frame navigation 缺口与 P04 的 v1 `data:image` 导出回归均保持闭环。
- 历史 P05 候选曾用 `pointerdown`/辅助按钮绕过真实处理器；该 blocker 已由用户授权的重开修复关闭。当前 P05 候选已删除辅助路径并通过真实 D3/Three/Interact 手势验收。
- Release 264 写前审计已固定十二项标题到精确 assetId 映射；三个合同续签 retire ID 仍为 `html-4d353ff9f58e974d4e8a`、`html-ef7410b3f4732cb7df31`、`html-221e1002d8e216bfefde`。历史验收目标已固定为 revision 18、4 项全 v1 的生产 presentation。
- PocketBay 控制会话确认项目 `html-ppt-template-asset-library` 已从 Release 264 切换到 Release 326；平台返回过 `next_action=done`、`project_status=running`，无 failure stage。休眠后按官方表单唤醒，live/ready 返回 200。
- 写前生产基线为 30 active（15 Workshop + 12 组件 v1 + 3 retire 目标）、0 v2、1 个 revision 18 且 4 项全固定 v1 的汇报；恢复检查为 7 migrations、90 objects、60 derivatives、1 presentation、0 exports，写前数据库 SHA-256 前后一致。
- 部署后目录和历史汇报仍完整，但 `/api/recovery` 和两个已验证备份 manifest 返回 409 `Backup SQLite hash or size verification failed`，另一个旧备份目录缺失。P07 因生产状态漂移停止；12 个导入、12 个 current 晋升和 3 个 retire 均未发生。
- 先前旧页面会话的 401 已通过唤醒、重新登录和当前归档精确请求复核；未据此修改 BFF 源码，当前结论是睡眠/旧会话状态已恢复，不宣称存在已修复的代码缺陷。
- 全依赖审计（非 `--prod`）真实 exit `1`，当前 metadata severity 为 low `2`、moderate `6`、high `1`、critical `1`；该结果已与 production 全零审计分开记录，未进行依赖升级或豁免。
- 保存项目列表没有该子仓库条目；父监督器挂载到 `HTML - PPT` 本地项目，但 prompt 和链状态固定子仓库路径。

## 范围与外部状态

- 工作树：P05/P06 候选和 P07 阻塞证据均保持原子边界；既有未跟踪 `.workbuddy/` 保持原样。
- 远端/部署：精确 P06 产品候选 `66135d5add134da929cb2da7e4810bad340e9ba3` 的安全归档已部署为 PocketBay Release 326；包 SHA-256 `428f0e3d91776e5327371c6e2753fac91b07e73cc4ab4c0ea45ed60967dacb07`。P07 没有导入、晋升或 retire；Release 回滚尚未执行，等待用户在 PocketBay 控制台确认。
- 无关改动：无。
