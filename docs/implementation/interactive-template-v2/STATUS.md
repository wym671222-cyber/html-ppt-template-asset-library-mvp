# 交互模板与导出修复状态

- 工作流阶段：blocked
- 计划版本：2.0
- 用户批准版本：2.0（2026-08-14T17:56:07+08:00）
- 当前阶段：无；P05 父级门禁失败，执行链已停止
- 活动线程：无
- 最后核实结论：唯一有界修复候选 `9fee3a4c36a18c293f49508478814385cf07858c` 虽使用十二个生产 ID 并通过自动测试，但 D3、Three.js、Interact.js 的验收以 `pointerdown` 或辅助按钮直接改变状态，未真实证明批准计划要求的拖动交互，父级门禁失败。
- 下一安全动作：保持 P06/P07、推送和生产操作停止；只有新批准计划或用户明确授权重开 P05 后才能继续。

### P05 worker 有界修复证据（父级已否决）

- 本 worker 已将 12 个 package fixture 改为准确生产 `assetId`/标题和真实交互族，固定 7 个本地库版本并重新审核 12 个规范化 SHA-256；P01 既有摘要未改。
- Node 22.23.2 / pnpm 9.15.0：P05 定向确定性/负例、真实 Chrome 12 项交互、隔离 SQLite/CAS 全量 preview+thumbnail 晋升、精确三目标退役与旧 v1 v3 导出通过。Chrome 预览诊断保持 P02 `networkAuditHitCount=0` 与 `selfNavigationAuditHitCount=0`。
- 父级代码审查确认：`tests/p05-interactive-fixtures.test.ts` 对 D3 仅派发 `pointerdown` 后点击 `star-zoom`，运行时代码又在任意 `pointerdown` 上直接设置 `data-star-dragged=true`；Three.js 只点击 `orbit-spin`；Interact.js 只点击 `layout-nudge`。这些断言绕过了三类真实拖动处理器，不能满足 P05 完成门禁。
- 这是自动流转协议允许的唯一 bounded repair；因此 P05=`failed`、gate=`failed`、workflow=`blocked`。未启动 P06，未推送新候选，未触碰生产 DB/CAS/PocketBay 或两个真实来源目录。

### P05 blocked 后只读诊断

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
| P05 | failed | `9fee3a4c36a18c293f49508478814385cf07858c` | `01a000e9-37c1-7361-914f-9d40d844a6ac` | failed | 十二个生产 ID、隔离迁移和自动测试已交付，但 D3/Three/Interact 的 Chrome 验收绕过真实拖动处理器；唯一 bounded repair 后父级语义门禁失败 |
| P06 | pending | — | `01a00110-abc1-74b3-b71b-e88f9a02bee6` | pending | 未重跑；唯一 P05 bounded repair 门禁失败，须新批准计划或明确授权重开 P05 |
| P07 | pending | — | `01a00120-bf9d-7950-a479-c15a213bed6d` | pending | 旧只读 blocker 证据保留在 git 历史；PocketBay 配对控制已恢复、Release 264 身份已核实，但容器仍处于 204 sleep layer，未写生产 |

## 阻塞与不确定性

- P00–P04 仍通过；P02 的 self-frame navigation 缺口与 P04 的 v1 `data:image` 导出回归均保持闭环。
- P05 唯一有界修复已使用十二个生产资产 ID 和七类固定运行库，但其 D3/Three/Interact 测试分别用 `pointerdown`/`star-zoom`、`orbit-spin`、`layout-nudge` 直接触发状态，未证明真实拖动。只读差分诊断已证明根因是默认 `300×150` iframe 裁剪，且 `960×540` 下真实拖拽稳定可用；流程授权仍是当前 blocker。
- Release 264 的已审计导入记录已恢复十二项标题到精确 assetId 映射；三个合同续签 retire ID 仍为 `html-4d353ff9f58e974d4e8a`、`html-ef7410b3f4732cb7df31`、`html-221e1002d8e216bfefde`。既有 v1 PresentationItem 验收目标仍须在生产唤醒和认证只读查询后固定。
- PocketBay 控制会话可读，项目身份为 `html-ppt-template-asset-library`、Release 264；连续真实访问仍为 HTTP 204 且控制面为 sleeping。未执行备份、部署、导入、晋升、退役或任何 DB/CAS 写入。
- 保存项目列表没有该子仓库条目；父监督器挂载到 `HTML - PPT` 本地项目，但 prompt 和链状态固定子仓库路径。

## 范围与外部状态

- 工作树：父级仅追加本链 blocked 审计状态；既有未跟踪 `.workbuddy/` 保持原样。
- 远端/部署：远端 `68358b95123db8735766b4443f0359a79d2a0653` 保留作历史候选但已失效，不覆盖、不删除；链已 blocked，不推送新候选。P07 未部署、未备份、未迁移、未 retire，也未写生产 DB/CAS。
- 无关改动：无。
