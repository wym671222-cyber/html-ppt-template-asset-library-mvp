# HTML 模板包 v2 契约

`html-template/v2` 是 `html-template/v1` 的受审核交互扩展；v1 的清单、摘要和既有登记行为保持兼容。

## 导入边界

- 管理员只能通过 ZIP 导入 v2；单 HTML 导入入口始终生成 v1。
- ZIP 根目录必须有且只有一个 `manifest.json`，其余文件必须与 `manifest.files` 精确相等。
- 包只接受清单声明的 UTF-8 `.html`、`.css`、`.js` 文本；拒绝绝对路径、父目录、反斜杠、盘符、符号链接、未声明目录或资源。
- HTML/CSS/JS 不得引用外部 URL。HTML 资源引用必须指向清单文件或经过字节签名、严格 Base64 和 2 MiB 上限验证的 `data:image`；CSS `url()` 只允许同样的数据图片。
- 脚本必须是清单声明的外部 `.js` 文件；拒绝内联脚本、内联事件、frame/object/embed/form、导航属性和 meta refresh。

## Manifest

v2 保留 v1 的全部字段，并且只增加：

```json
{
  "contractVersion": "html-template/v2",
  "runtime": {
    "mode": "sandboxed-js",
    "viewport": { "width": 1920, "height": 1080 }
  }
}
```

`runtime` 及 `viewport` 不接受额外字段或其他值。

## 规范化 SHA-256 与审核白名单

v2 在写入 CAS 前规范化为无额外空白的 UTF-8 JSON `{manifest,files}`：manifest 字段顺序固定，`tags`、`files` 和 `slots` 按 UTF-8 字节升序，slot 字段顺序固定，`files` 对象按路径升序；文件文本保持导入后的精确 UTF-8 内容。`sourceDigest` 是该规范化字节串的 SHA-256。

只有 `apps/api/src/templates/interactive-template-allowlist.ts` 中经代码审查登记的完整 64 位小写摘要可以导入。ZIP 条目顺序、manifest 键顺序和上述集合字段顺序不改变摘要；任何文件内容改变都会产生新摘要并重新要求审核。

## 候选与晋升

- 合法且白名单命中的 v2 先追加为不可变 TemplateVersion/CAS 候选并排队生成派生物，不立即改写 `template_assets.current_version_id`。
- preview 与 thumbnail 必须属于同一版本、source digest 和 renderer version；两者在同一事务中登记成功后，才可把比当前版本号更高的候选晋升为 current。
- 失败、缺失或部分派生物不晋升；原 v1 current 和已有 PresentationItem 的固定版本引用保持不变。
- 重试旧候选不得把 current 回退到更低版本；CAS、版本和派生物继续保持追加/不可变语义。
