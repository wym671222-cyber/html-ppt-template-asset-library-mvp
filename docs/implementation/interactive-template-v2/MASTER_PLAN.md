# 交互模板与导出修复主计划

- 状态：已批准，等待父监督器启动
- 计划版本：2.0
- 来源批准版本：2.0
- 仓库：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 实施分支：`feat/interactive-template-v2-export`
- 基线提交：`a427b530e05d79ae00b1d7196081f4a03c06451b`
- 终局阶段：P07

## 全局架构边界

- `html-template/v1` 保持静态兼容；`html-template/v2` 增加 `runtime: { mode: "sandboxed-js", viewport: { width: 1920, height: 1080 } }`，只允许清单声明的 UTF-8 HTML/CSS/JS 和经过验证的 `data:image`。
- v2 仅通过 ZIP 导入，规范化 SHA-256 必须位于版本库审核白名单；所有第三方库固定版本并包内化。
- `GET /api/catalog/assets/:assetId/runtime` 返回活动当前 v2 的自包含断网页面；前端 iframe 只有 `allow-scripts`。
- `POST /api/admin/templates/:assetId/retire` 幂等软下架并记录审计。
- `html-presentation-export-package/v3` 以隔离 iframe 统一 v1/v2，输出自包含 HTML 与离线 ZIP，同时继续验证历史 v2 导出。
- 十二个组件沿用资产 ID 创建 version 2；候选派生物完整后才晋升。已有演示继续固定 v1。

## 阶段总表

| ID | 标题 | 目标 | 模型 | 推理 | 上下文 % | 依赖 | 后继 |
|---|---|---|---|---|---:|---|---|
| P00 | 执行链与失败基线 | 固化真实 data-image 导出失败回归和运行环境基线 | gpt-5.6-luna | high | 30 | 无 | P01 |
| P01 | v2 协议与白名单导入 | 增加 v2、规范化摘要、审核白名单和候选登记 | gpt-5.6-sol | xhigh | 45 | P00 | P02 |
| P02 | 沙箱运行与安全预览 | 建立断网 iframe runtime 和白名单 v2 PNG 渲染 | gpt-5.6-sol | max | 50 | P01 | P03 |
| P03 | 目录交互与模板下架 | 交互详情、目录 runtime 信息和管理员退役接口 | gpt-5.6-terra | high | 40 | P02 | P04 |
| P04 | 导出协议 v3 | 修复 v1 data-image 并实现 v1/v2 离线交互导出 | gpt-5.6-sol | max | 50 | P03 | P05 |
| P05 | 十二组件与迁移演练 | 生成 12 个 v2 包并在隔离 DB/CAS 演练晋升/退役 | gpt-5.6-terra | high | 45 | P04 | P06 |
| P06 | 全量候选与独立门禁 | 全量验证、审计并形成唯一可部署候选 | gpt-5.6-sol | xhigh | 45 | P05 | P07 |
| P07 | PocketBay 迁移与终局验收 | 备份、部署、迁移并验证线上 27 个活动模板 | gpt-5.6-sol | max | 45 | P06 | 无 |

## 阶段合同

### P00 — 执行链与失败基线

- 交付：链文件、Node 22/pnpm 9.15.0 可复现测试；新增一个先红的 v1 `data:image` 导出回归。
- 只读入口：AGENTS、当前状态/手递、模板包合同、导入器、安全预览器、导出器与 P08/PocketBay 测试。
- 允许：本链目录、针对性测试文件。禁止：产品源码、来源目录、数据库/CAS、远端和部署。
- 门禁：回归以精确错误失败；既有相关测试基线记录；链校验通过；一个原子提交；工作树除 `.workbuddy/` 外干净。
- 回滚：撤销 P00 单提交。

### P01 — v2 协议与白名单导入

- 交付：v1/v2 类型联合、v2 清单验证、包规范化摘要、版本库白名单、管理员 v2 ZIP 导入、候选版本不提前晋升。
- 允许：共享模板协议、API 导入/目录仓储、白名单配置、迁移（如确需）、相关测试和本链 handoff。
- 禁止：浏览器 runtime、目录 UI、导出器、真实素材导入、远端。
- 门禁：合法 v1/v2；外部 URL、未声明资源、路径穿越、非白名单摘要全部负面通过；失败候选保留 v1 current。

### P02 — 沙箱运行与安全预览

- 交付：runtime 编译器/端点、精确 CSP、标准 ready/error/replay/reset 消息、v2 JavaScript 预览 worker。
- 允许：API runtime/preview、BFF 精确代理、相关共享类型与安全测试。
- 禁止：目录视觉改版、退役、导出器、组件包、生产。
- 门禁：iframe 无 Cookie/存储/外网/弹窗/父页面/顶层导航；只对白名单 v2 启用 JS；PNG 尺寸与 CAS 约束保持。

### P03 — 目录交互与模板下架

- 交付：Catalog runtime 字段、详情页按需 iframe、错误/重播/重置、管理员 retire API；卡片 PNG 不变。
- 允许：目录 API/UI、管理员路由、退役仓储与审计、相关测试。
- 禁止：执行真实退役、组件包、导出器、生产。
- 门禁：打开详情才创建 iframe、关闭销毁；retired 不可搜索/新增；已有引用仍可读；精确 CSP/BFF 路由测试通过。

### P04 — 导出协议 v3

- 交付：v3 manifest、v1 无脚本 iframe、v2 断网脚本 iframe、资源摘要去重、自包含 HTML和离线 ZIP、历史 v2 读取兼容。
- 允许：Presentation export、离线归档、接口类型、相关测试。
- 禁止：组件包和生产数据。
- 门禁：Workshop v1、静态组件 v1、交互 fixture v2 混合导出；合法 `data:image` 成功；伪造图片/外部 URL继续失败；所有文件 hash 复验。

### P05 — 十二组件与迁移演练

- 交付：七类固定版本库、确定性包生成器、十二个同资产 ID/version 2 白名单包、隔离晋升/退役脚本与演练证据。
- 允许：只读 `02_HTML_PPT_组件与模板/component-lab.html` 及其明确图片依赖；仓库内脚本/白名单/测试夹具；临时隔离 DB/CAS。
- 禁止：改写/复制回来源目录、读取无关 sibling 文件、生产写入、自动升级既有 PresentationItem。
- 门禁：十二包全通过 preview/runtime；原来源目录前后哈希相同；三个目标 ID 在隔离库退役；旧 Presentation v1 导出仍通过。

### P06 — 全量候选与独立门禁

- 交付：Node 22/pnpm 9.15.0 下类型检查、Vitest、Web check/build、Chrome E2E、恢复演练、生产依赖审计、凭据/路径扫描和唯一候选 SHA。
- 允许：仅修复门禁发现的计划内缺陷和本链证据；候选通过后推送精确实施分支。
- 禁止：降低 audit、ignore、`--force`、未经证据 override、生产写入。
- 门禁：所有测试与审计通过；staged/commit diff 符合 P00-P05；来源目录与 `.workbuddy/` 未变；分支干净；远端同 SHA。

### P07 — PocketBay 迁移与终局验收

- 交付：写前只读核验、加密备份、部署、十二个 v2 晋升、三个模板退役、真实浏览器与离线导出验收、实际 Release/状态/终局 handoff。
- 允许：计划明确的现有 PocketBay 项目和 `/data`；不得操作其他环境。
- 门禁：health live/ready 200；活动总数 27=15+12；十二组件 current v2；三个目标不可见/不可新增；旧演示导出成功；新组件交互和离线导出成功；回滚点可验证。
- 回滚：代码失败切回上一 Release；若数据已晋升，同时激活部署前 SQLite 备份；CAS 只追加不清理。

## 自动流转

- 父监督器标题固定为 `[交互模板与导出修复][SUPERVISOR] 自动执行链 v2.0`；阶段标题固定为 `[交互模板与导出修复][Pxx] <阶段标题>`。
- 父监督器创建阶段线程、等待、独立复核、记录门禁并创建唯一后继。阶段线程不得创建后继、推送或部署。
- 第一次失败回到同一线程做一次有界修复；需改架构、超过 70% 或第二次仍失败则 blocked。
- Luna 可升级 Terra，Terra 可升级 Sol；Sol 不得降级。替换必须记录。

## 明确未授权

- 物理删除内容对象或已验证模板版本。
- 改写两个来源目录或 `.workbuddy/`。
- 自动更新已有 PresentationItem 的 TemplateVersion。
- 操作腾讯服务器链、其他 PocketBay 项目或其他远端。
