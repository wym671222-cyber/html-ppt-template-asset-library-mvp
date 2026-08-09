# 项目简报：公网稳定化、账号审批与生产交付

- 状态：计划 v2.0 已明确批准，P11 执行中
- 项目：HTML PPT 模板资产库 MVP 生产化修复
- 工作区：`/Users/rosswang/Desktop/HTML - PPT/03_HTML汇报模板资产管理与组装平台`
- 仓库：`https://github.com/wym671222-cyber/html-ppt-template-asset-library-mvp`
- 目标用户：当前为 MVP 测试人员，最终为公司内部员工

## 目标与成功标准

- 修复 `https://ppt.ajjy-ai.site` 首屏资源偶发加载失败、线上构建不可复现和进程冲突问题。
- 增加“拼音用户名 + 密码”自助注册、唯一管理员审批、禁用与重置密码能力。
- 模板目录对已审批用户共享；Presentation、PresentationItem 和导出严格归属于创建用户。
- 生产服务由专用低权限用户和 systemd 运行，代码发布与 SQLite/CAS 数据分离，Caddy 具备访问日志和健康检查。
- 全部阶段有可重复命令、负向测试、原子提交、干净工作树、handoff 和明确回滚点；最终以公网冷启动、用户隔离和重启恢复验收。

## 范围

- 范围内：构建依赖与 CI、健康检查和只读开关、账号/会话/审批、Owner 迁移、登录与管理 UI、systemd/Caddy/WorkBuddy 发布流程、生产迁移和验收。
- 范围外：邮箱验证、MFA、SSO、组织/多管理员、协同编辑、模板私有化、Postgres/S3/Redis、导入真实 sibling 模板资产、删除旧发布和历史备份。

## 约束与授权

- 固定实现仓库为本仓库；计划实现分支为 `feat/production-auth-hardening`，基线为 `9c88b48aafd3bf2529cc31c5db9e346a915bf3aa`。
- 只使用仓库内 P03 fixture；禁止读取、扫描、导入、复制、移动或改写 `02_HTML_PPT_组件与模板`。
- 当前用户请求只授权修订计划文档，不授权产品实现、commit、push、Caddy 变更、服务重启、生产迁移或部署。
- 计划 v2.0 批准后，只自动授权 P11–P16 的本地源码修改、测试、精确 staging、原子 commit 和只读服务器预检；不自动授权 push 或生产写操作。
- 临时公网只读保护、最终 push/生产迁移/切换分别有独立审批门；凭据只能由用户或 WorkBuddy 在服务器交互式输入，不进入 Codex 输出、命令参数、Git、日志或证据文件。

## 当前状态与已验证证据

- 当前提交与 GitHub/服务器代码提交均为 `9c88b48aafd3bf2529cc31c5db9e346a915bf3aa`；本地仅有用户自有未跟踪目录 `.workbuddy/`。
- 页面和 HTML 均为有效 UTF-8；曾捕获 CSS/JS `ERR_CONNECTION_CLOSED` / `ERR_NETWORK_CHANGED`，故障表现是无样式 HTML，而非文字编码损坏；当前重复冷启动正常。
- 服务器存在手工补装 `@sveltejs/adapter-node`、线上脏工作树、API `EADDRINUSE` 重启、root PM2、缺少 Caddy 访问日志和生产 `ORIGIN` 等确定缺陷。
- 线上 SQLite 只读核验为 `quick_check=ok`、外键异常 0、5 个迁移；1 个模拟模板，Presentation/Item/Export 均为 0。

## 已锁定产品决策

- 用户自助注册后进入 `pending`，唯一管理员人工审批；不要求邮箱。
- 用户名为小写拼音格式，密码 10–128 字符；固定 7 天数据库会话，不滚动续期。
- 改密、重置和禁用均撤销全部会话；管理员离线交互式引导创建。
- 服务管理采用 systemd + 专用用户；GitHub 仅运行 CI，生产由 WorkBuddy 按手册执行。
- 正式账号系统上线前，公网业务进入临时只读保护。

## 开放项

- 无待定产品或架构选择；只剩计划批准与两个生产外部效果审批门。
