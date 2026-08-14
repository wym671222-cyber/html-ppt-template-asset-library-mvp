# 交互模板与导出修复研究结论

- 状态：完成
- 检查日期：2026-08-14
- 研究问题：在现有 SQLite/CAS、不可变 TemplateVersion、PNG 安全预览和 PocketBay 单容器边界下，如何增加受控交互与离线导出。

## 已核实事实

- `html-template/v1`、安全预览器和导出器的引用策略不一致；真实 `data:image` 包可入库但会被导出器拒绝。
- 继续把模板 DOM 拼入外层页面会产生 CSS 冲突，并且无法安全承载脚本；隔离 iframe 可统一静态与交互模板。
- 资产库已有 iframe artifact 运行经验，但资产库页面 CSP 当前禁止 frame，需要为精确 runtime 路径收窄放行。
- 原组件依赖均有精确版本 URL；运行时和导出必须 vendoring，不能继续依赖 CDN。
- 已有 PresentationItem 固定具体 TemplateVersion，因此自然支持“旧演示继续 v1，新添加使用 v2”。
- PocketBay 持久数据集中于 `/data`；现有加密备份和恢复机制可作为生产迁移回滚点。

## 推荐路线

- 保留 v1；增加只允许已声明 HTML/CSS/JS 的 v2，并以规范化包 SHA-256 审核白名单控制可执行代码。
- 目录卡片继续使用 PNG；详情页按需加载 `sandbox="allow-scripts"` 且无 `allow-same-origin` 的自包含运行页。
- 导出升级到 v3，以 iframe 承载每一页；v1 禁脚本，v2 仅运行包内脚本；HTML 与 ZIP 均离线。
- 新版本完成预览派生物后再晋升 `current_version_id`，避免失败候选让现有目录消失。
- 使用 `retired` 软下架三个模板，不修改不可变版本和 CAS。

## 不采用

- 不开放任意管理员 JavaScript；iframe 无法语义证明任意代码不会死循环或耗尽 CPU。
- 不通过放宽导出器的“未声明引用”判断来绕过错误；必须统一包重验和 iframe 打包。
- 不自动改写既有 PresentationItem 的 TemplateVersion。
- 不将原组件 CDN 保留到线上预览或导出。
