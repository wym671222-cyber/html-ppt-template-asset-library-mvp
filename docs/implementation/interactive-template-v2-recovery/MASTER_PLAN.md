# 交互模板 v2 终局恢复与上线主计划

- 状态：批准版本 v3.0 执行中；机械拆分计划 v3.1
- 计划版本：3.1；批准版本：3.0
- 实施分支：`feat/interactive-template-v2-export`
- 实施基线：`bdd9acf35174fefe7953aa59c5d7bb670d4cf901`
- 终局阶段：P06

## 全局目标与边界

- `ppt.ajjy-ai.site` 最终采用与 PocketBay 一致的三栏资产库、真实缩略图和大尺寸实时预览；两端运行同一完整 SHA。
- 先通过 PocketBay 恢复门禁并完成 12 项 v2 晋升、3 项软退役，再以 PocketBay 最终 manifest 为唯一事实源同步云服务器。
- 目录同步只包含模板、标签、版本、current 指针、HTML/CSS/JS 内容对象、预览图、缩略图和 renderer identity。
- 用户、密码、Session、汇报、汇报项目、导出历史、恢复备份和密钥不进入传输包；云端既有记录同步前后指纹必须一致。
- 不读取两个真实来源目录；12 个 v2 只使用仓库内确定性生成器；`.workbuddy/` 不读、不改、不暂存。
- P03R 不操作产品、测试、ops、生产或远端。P04/P05A/P05B/P06 只能由父级在前置门禁 passed 后启动。

## 阶段

| ID | 标题 | 模型 | 推理 | 上下文 | 依赖 | 后继 |
|---|---|---|---|---:|---|---|
| P00 | 恢复链初始化与失败基线 | gpt-5.6-sol | high | 30% | 无 | P01 |
| P01 | 密封备份架构 | gpt-5.6-sol | xhigh | 50% | P00 | P02 |
| P02 | 候选与独立门禁 | gpt-5.6-sol | xhigh | 40% | P01 | P03R |
| P03R | v3.0 恢复链重基线 | gpt-5.1-codex-max | high | 20% | P02 | P04A |
| P04A | 实时预览与大尺寸弹窗 | gpt-5.1-codex-max | high | 35% | P03R | P04B |
| P04B | 模板资产目录传输 | gpt-5.1-codex-max | high | 45% | P04A | P05A |
| P05A | PocketBay 双候选密封恢复证明 | gpt-5.1-codex-max | high | 45% | P04B | P05B |
| P05B | PocketBay 迁移与目录导出 | gpt-5.1-codex-max | high | 50% | P05A | P06 |
| P06 | 云服务器同步与终局验收 | gpt-5.1-codex-max | high | 50% | P05B | 无 |

旧计划 v2.1 的 P03A/P03B 不属于活动阶段：P03A 保留为未通过的 `in_progress` 历史，P03B 保留为未启动的 `pending` 历史，二者均由 v3.0 取代。

### P03R — v3.0 恢复链重基线

- 仅更新本恢复链的 PROJECT_BRIEF、DECISION_LOG、MASTER_PLAN、STATUS、CHAIN_STATE 和 P03R handoff。
- 固定 v3.0 批准记录、精确基线、新活动链、阶段模型/推理/上下文、授权与禁止边界。
- 保持 P00–P02 的 passed 提交和门禁证据不变；P04 继续 pending，禁止创建后继线程。
- 门禁：官方 validator、`git diff --check`、显式 staged diff 审查、单个 Conventional Commit、提交后仅保留既有 `.workbuddy/`。

### P04A — 实时预览与大尺寸弹窗

- 列表仅使用 PNG 缩略图；眼睛按钮打开居中大尺寸 16:9 弹窗，交互页面位于首屏，元数据进入可收起信息区。
- 弹窗提供关闭、全屏和适应窗口；v2 提供重播、重置。Esc 先退出全屏、再关闭，关闭后销毁 iframe 并归还焦点。
- v1 真实 HTML/CSS 使用不允许脚本的 opaque sandbox；v2 保持 `sandbox="allow-scripts"` 双层运行时，禁止外网、导航、下载和宿主存储。
- 扩展目录 runtime：`mode = sandboxed-static | sandboxed-js`，并声明 `viewport`、`url` 和 `commands`。
- 只完成 runtime/UI/BFF 安全路径与真实浏览器验收；目录传输留给 P04B，不接触生产。

### P04B — 模板资产目录传输

- 实现仅管理员可用的 `asset-library-catalog-transfer/v1` 密封 ZIP 导出、暂存校验和显式 apply。
- 完成 API composition、精确 BFF、APP_READ_ONLY fail-closed、SQLite transaction、敏感表指纹与所有负测；不接触生产。

## 公共接口与传输合同

- `GET /api/admin/catalog-transfers/export`：导出密封 ZIP，记录来源发布 SHA、活动模板清单、文件摘要和目录状态摘要。
- `POST /api/admin/catalog-transfers`：上传到隔离暂存区并校验，返回 transfer ID、manifest SHA、源/目标目录状态 SHA 和确定性变更清单；不得修改数据库。
- `POST /api/admin/catalog-transfers/:id/apply`：请求必须携带预期 manifest SHA 和目标状态 SHA；目标漂移返回 409 且零数据库副作用。
- 相同版本 ID 与内容摘要一致时幂等复用；摘要冲突、重复 ID、路径穿越、缺失对象或非法 renderer identity 整体失败。
- PocketBay 元数据和 current 指针作为活动目录权威值；目标额外活动模板软退役，不删除版本或 CAS。
- 内容对象先在隔离暂存区完成摘要验证，模板数据库变更在一个事务内提交；提交前后认证与汇报数据指纹必须一致。

### P05A — PocketBay 双候选密封恢复证明

- P04 全量验证通过后形成候选 C；再用仅包含门禁证据的提交形成候选 D，并证明 C/D 运行时和部署输入完全一致。
- PocketBay 保持当前版本，依次部署 C、D；在 C 创建密封备份，记录归档 SHA，在 D 证明同一归档字节不变并可隔离恢复。
- 任一备份、摘要或恢复门禁失败立即停止，不自动回滚，不导入、不晋升、不退役；登录和备份口令由用户手工完成。

### P05B — PocketBay 迁移与目录导出

- 先创建迁移前密封备份并完成隔离恢复，再逐项晋升 12 个 v2；全部真实预览通过后才软退役 3 个既定模板。
- 成功目录为 27 个活动模板，即 15 个 Workshop 加 12 个 v2；历史汇报固定版本保持不变，CAS 不清理。
- 导出最终目录包并记录 manifest SHA、活动模板 ID 清单和资产数量；该包是 P06 唯一允许的同步输入。
- 迁移失败时保持停止状态，由用户明确决定是否激活迁移前备份；不得自动恢复或继续后继。

### P06 — 云服务器同步与终局验收

- 唯一目标为 `119.29.241.146`、Origin 为 `https://ppt.ajjy-ai.site`；部署与 PocketBay 相同的候选 D 完整 SHA，不允许服务器侧补丁。
- 云端先进入维护和只读，记录代码、DB/CAS、账号、汇报和模板指纹；创建 DB/CAS/Caddy/systemd 备份并在隔离目录验证可恢复。
- 生产预检不要求汇报表为空，改为验证用户归属、版本引用、外键、位置唯一性和历史汇报可解析。
- 上传并校验 P05B 目录包，在审核确定性变更清单后开放一次受控写入 apply；随后立即恢复只读并执行完整验收。
- 只有终局门禁全部通过后才恢复正常写入和解除维护。目录 apply 失败必须事务回滚；apply 后验收失败时保持维护，由用户明确批准后才可恢复迁移前 DB、原代码 symlink、Caddy/systemd；CAS 和备份不删除。

## 测试与终局门禁

- 合同负测：篡改摘要、路径穿越、重复 ID、版本冲突、过期目标状态、缺失对象和非法 renderer identity 均零数据库副作用失败。
- 数据保护：传输包不含认证、汇报或恢复数据；同步前后用户、Session、汇报、项目和导出记录计数及内容指纹一致。
- UI：1440×900 与 1920×1080 同时可见左筛选、中双列卡片、右汇报面板，无横向溢出和空白预览。
- v1：真实 DOM/CSS 可见，脚本、外网、导航和下载全部被拒绝。v2：12 个组件用真实鼠标、拖拽和滚轮验收，重播、重置、全屏和关闭有效，HTTP(S) 外连为零。
- 线上：两端完整 SHA 相同；云端活动模板 ID 与最终 manifest 相同；所有活动模板均有有效缩略图和实时页面。
- 历史：云端原账号可登录、原汇报可打开和导出；软退役模板不在活动目录，但历史引用仍有效；浏览器无 console error、破图或加载遮罩残留。
