# PocketBay 正式生产化实施计划

- 状态：已批准执行
- 计划版本：1.0
- 实施分支：`feat/pocketbay-production`
- 基线提交：`450d9d500088aed82176c10bd7bf44de18edcc6c`
- 终局阶段：PB04

## 全局边界

- 单容器 Web + loopback API；生产数据只写 `/data`。
- 精确 Origin、默认关闭注册、唯一管理员、管理员专属备份与模板导入。
- 每阶段一个原子提交、独立门禁、显式暂存路径；禁止 `.workbuddy/`、sibling `02`、本地 DB/CAS、真实素材和凭据进入提交/部署包。
- 旧 P17 状态、腾讯服务器发布工程和既有生产域名边界不变。

## 阶段

| ID | 标题 | 目标 | 模型 | 推理 | Context % | 依赖 | 后继 |
|---|---|---|---|---|---:|---|---|
| PB00 | 固化最小适配基线 | 提交当前 Docker/运行时适配和独立执行链 | gpt-5.6-sol | high | 30 | - | PB01 |
| PB01 | 生产安全加固 | 精确 Origin、关闭注册、常规运行移除 bootstrap 配置 | gpt-5.6-sol | xhigh | 45 | PB00 | PB02 |
| PB02 | 加密备份与恢复 | 管理员下载加密备份并完成隔离恢复/激活门 | gpt-5.6-sol | xhigh | 50 | PB01 | PB03 |
| PB03 | 管理员模板导入 | 上传、校验、CAS 入库、预览与发布 v1 包 | gpt-5.6-sol | xhigh | 50 | PB02 | PB04 |
| PB04 | 受控上线与终局验收 | 全量门、部署、线上 smoke、恢复演练和运营交接 | gpt-5.6-sol | high | 45 | PB03 | - |

## 公共接口

- 配置：`POCKETBAY_PUBLIC_ORIGIN`、`REGISTRATION_ENABLED`。
- 注册关闭：`POST /api/auth/register` 返回 `403 REGISTRATION_DISABLED`；Web 注册页重定向登录。
- 备份恢复：管理员备份归档下载、恢复包验证/隔离恢复/确认激活接口。
- 模板导入：管理员创建导入任务、读取状态、重试预览接口。

## 计划级验收

- 强密码替换现有管理员口令；旧口令失效；移除初始化配置后重新部署仍可登录。
- 全量 Vitest、shell、shared/API 类型、Web check/build、Chrome E2E、生产依赖审计全部通过。
- 加密备份在隔离环境完成恢复；fixture 模板经管理员上传后可预览、加入演示并导出离线 ZIP。
- 线上健康、登录、管理接口、Origin/注册负向和 PocketBay running 状态通过。
