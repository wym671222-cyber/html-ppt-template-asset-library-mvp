# PocketBay 生产化调研摘要

- 状态：完成；复用已批准方案前的官方文档核对
- 结论：继续使用仓库自带 Dockerfile 和 PocketBay 单容器运行时；Web 对外监听平台 `PORT`，API 仅监听 loopback，持久数据全部位于 `/data`。
- 平台边界：PocketBay 不提供本项目所需的托管对象存储；版本能力不能替代异地业务数据备份。
- 路线：保持 SQLite/CAS，不迁移真实数据；增加管理员显式上传与可恢复的加密离线备份。
- 未复用：不引入第二容器、外部队列、S3/Postgres、自动目录扫描或腾讯服务器发布工程。

## 来源

- `https://pocketbay.com/docs/deploy`
- `https://pocketbay.com/docs/limitations`
- `https://pocketbay.com/docs/supported-runtimes`
