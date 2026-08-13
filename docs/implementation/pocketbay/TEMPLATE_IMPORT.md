# PocketBay 管理员模板导入

## ZIP 结构

模板包根目录必须包含 `manifest.json`，其 `files` 必须与 ZIP 内其余文件完全一致。入口固定为 `index.html`，资源仅允许 UTF-8 HTML/CSS。

```text
manifest.json
index.html
styles.css
```

Manifest 采用 `html-template/v1`，字段固定为：`contractVersion`、`id`、`version`、`title`、`summary`、`category`、`tags`、`entry`、`files`、`slots`。不接受未知字段。

## 安全与容量边界

- 压缩包最大 5 MiB，展开后最大 10 MiB。
- 最多 32 个声明文件；单文件最大 2 MiB，manifest 最大 64 KiB。
- 拒绝绝对路径、`..`、反斜杠、符号链接、未声明文件/目录、重复路径和 CRC 错误。
- 拒绝脚本、事件属性、iframe/form/object、外部 URL、CSS `@import`/`url()` 和任何未声明资源引用。
- 上传接口仅对已登录管理员开放，并要求同源写请求。

## 导入生命周期

1. 管理员在“平台管理”上传 ZIP。
2. API 严格解析并将规范化模板包登记到 `/data` CAS 和 SQLite。
3. 单并发 worker 使用无 JavaScript、空 cookie、loopback allowlist 的 Chromium 生成 1280×720 preview 和 320×180 thumbnail。
4. 只有同一 renderer 产出的完整 PNG 对写入成功后，模板才出现在资产目录。
5. 同一不可变包重复上传复用同一 Job；冲突 id/version 会失败关闭。

生产容器使用系统 Chromium；预览失败不会把只有源码、没有安全 PNG 的模板暴露到目录。
