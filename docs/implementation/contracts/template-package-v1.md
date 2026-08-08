# HTML 模板包 v1 契约（P03）

P03 只验证仓库内模拟包的结构与适配结果，不登记数据库、不写入内容对象、不创建 Job，也不执行浏览器预览。

## 包结构

每个包必须由显式 `manifest.json` 和 manifest `files` 列表组成。`entry` 固定为包内 `index.html`；文件名只能是包内相对安全路径，不能包含 `..`、绝对路径或外部 URL。v1 仅接受 HTML/CSS 文件清单，适配器不会递归扫描目录。

## Manifest

必填字段为 `contractVersion: "html-template/v1"`、稳定 kebab-case `id`、正整数 `version`、标题/摘要/分类、标签、`entry`、`files` 和 `slots`。slot 只能声明 `text` 或 `color`，并包含 `id`、`required`；文本可设置长度上限和纯文本默认值。

HTML 通过 `data-template-slot="slot-id"` 声明插槽绑定。绑定必须在 manifest 中声明；P03 模拟包拒绝 `<script>`、外部 `src/href` 和未声明绑定。用户值不属于模板 HTML/CSS/JS，后续阶段只能通过 slot schema 处理。

## 适配器输出

适配器读取 manifest 明确列出的文件，校验后生成 `TemplateAsset` 与 `TemplateVersion` 形状的内存对象，并以 manifest 与排序后的文件内容计算确定性的 SHA-256 `sourceDigest`。P03 的 `contentObjectDigest` 固定为 `null`，留给 P04 CAS；适配器没有数据库、对象目录、Job 或预览副作用。
