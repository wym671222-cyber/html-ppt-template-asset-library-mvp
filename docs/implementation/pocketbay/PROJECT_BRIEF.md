# PocketBay 生产化项目简报

- 状态：已批准执行
- 项目：HTML PPT 模板资产库 PocketBay 正式生产化
- 工作区：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 仓库：同上
- 使用者：唯一管理员；公开注册在本阶段保持关闭

## 目标与成功标准

- 将已运行的 PocketBay 最小适配固化为可审计源码，完成精确 Origin、注册关闭、异地加密备份/恢复、管理员模板包导入和受控上线。
- 最终线上同时满足 PocketBay `next_action=done`、`project_status=running`，并通过健康、登录、管理、模板导入、演示创建、导出和恢复演练。

## 范围与约束

- 范围内：单容器 Web + loopback API、`PORT`/`0.0.0.0`、`/data` SQLite/CAS、现有 PocketBay 子域名、管理员上传 `html-template/v1` ZIP。
- 范围外：腾讯 P17、P18、自定义域名、PostgreSQL、对象存储、公开注册、真实素材自动扫描或迁移。
- 严禁读取、扫描、导入、复制、移动或改写 sibling `02_HTML_PPT_组件与模板`；严禁读取、修改或上传 `.workbuddy/`。
- 不提交或输出凭据，不上传本地 DB/CAS/真实素材；测试只使用仓库 P03 fixture 和隔离数据目录。
- 已授权：创建 `feat/pocketbay-production`、原子提交、推送该分支、更新现有 PocketBay 项目、管理员生产配置调整。

## 当前证据

- 当前 PocketBay Release 215 可用，管理员登录及管理 API 已验证；目录为空且没有真实素材。
- 最小适配仍是当前工作树未提交改动，起点 HEAD 为 `450d9d500088aed82176c10bd7bf44de18edcc6c`。
- 旧 `docs/implementation/CHAIN_STATE.json` 保持 P17 blocked；本项目使用本目录中的独立状态机。
