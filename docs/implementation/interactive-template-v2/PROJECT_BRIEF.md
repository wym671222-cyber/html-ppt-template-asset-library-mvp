# 交互模板与导出修复项目简报

- 状态：已批准，等待父监督器启动执行
- 项目：交互模板与导出修复——自动执行链 v2.0
- 工作区：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 仓库：同上
- 使用者：PocketBay HTML/PPT 模板资产库管理员与已登录成员

## 目标与成功标准

- 下架三个合同续签模板，但保留不可变版本、CAS 和已有 Presentation 引用。
- 让十二个组件在详情页中通过断网沙箱实时交互；卡片仍使用安全 PNG。
- 修复静态快照的 `Verified template HTML contains an undeclared reference` 导出错误。
- 新增受审核白名单约束的 `html-template/v2` 和可离线交互的导出 v3。
- 重新部署 PocketBay；线上目录最终为 27 个活动模板，其中 15 个 Workshop、12 个交互组件。

## 范围

- 范围内：共享模板协议、管理员 ZIP 导入、预览 worker、目录 API/UI、模板退役、Presentation 导出、十二个组件 v2 包、隔离迁移演练、PocketBay 备份/部署/线上验收。
- 范围外：物理删除 CAS 或已验证版本、自动升级既有 PresentationItem、腾讯服务器链、同级来源目录改写、任意非白名单 JavaScript 上传执行。

## 约束与授权

- 固定基线 `a427b530e05d79ae00b1d7196081f4a03c06451b`，实施分支 `feat/interactive-template-v2-export`。
- 单一父监督器、单一实施分支、串行阶段；阶段目标不超过 50% 上下文，70% 强制停止。
- `.workbuddy/` 与 `01_AI协会_Workshop_HTML`、`02_HTML_PPT_组件与模板` 保持原样；来源目录只允许 P05 做必要只读提取与前后哈希核验。
- 不输出 Cookie、密码、token、密钥或管理员 bootstrap 值。
- 用户已授权：创建分支和阶段线程、提交、推送实施分支、备份和迁移现有 PocketBay `/data`、更新现有 PocketBay 项目、退役三个精确模板 ID。
- 未授权：物理删除 CAS/版本、操作其他生产环境、降低审计或安全门槛。

## 当前证据

- 生产曾导入 30 个模板：15 个 Workshop、12 个静态组件、3 个合同续签模板。
- v1 导入/安全预览允许经过验证的 `data:image`；P08 导出器只覆盖纯 HTML/CSS fixture，并拒绝任何带 `src` 的真实静态快照。
- 十二个组件原始实现依赖 GSAP、ECharts、D3、Three.js、p5.js、Matter.js、Interact.js 和原生 JS，当前导入版本只是截图。
- 数据库支持 `template_assets.status IN ('active','retired')`；本地镜像中三个目标模板均无 Presentation 引用，生产仍须写入前复核。

## 开放决策

- 无。任何改变运行时信任模型、自动升级既有演示或物理删除对象的提议都属于计划变更，必须返回用户审批。
