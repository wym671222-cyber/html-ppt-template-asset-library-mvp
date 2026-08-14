# PocketBay 生产化状态

- Workflow phase：complete
- 计划版本：1.0（已批准）
- 当前阶段：PB04
- 实施分支：`feat/pocketbay-production`
- 基线：`450d9d500088aed82176c10bd7bf44de18edcc6c`
- 当前任务：PB04 已完成；进入上线后运营观察
- 下一安全动作：管理员使用新口令登录并按 `RECOVERY_RUNBOOK.md` 执行一次隔离恢复演练；动态应用约 10 分钟无真实访问后需在页面点击“唤醒并继续”

## 阶段账本

| 阶段 | 状态 | Commit | 线程 | Gate | 证据 |
|---|---|---|---|---|---|
| PB00 | passed | `b30967fb02da1cc770425bb68017f448e430a7d9` | current parent | passed | 定向 6/6；全量 785；type/check/build/shell 通过；Docker daemon 不可用留待平台构建 |
| PB01 | passed | `7658bd0dce934d1e6ad3344c2c36d042e45a29b1` | current parent | passed | 定向 25/25；全量 790；build/shell/audit 通过；精确 Origin、注册关闭、bootstrap 失活 |
| PB02 | passed | `64c6fbb3b968322a93859158602d11a9c04a6d3e` | current parent | passed | 加密 .pba、受控导入、隔离恢复、重启原子激活；全量 794/build/shell/audit 通过 |
| PB03 | passed | `530e37bd48ab331cca9c70c2f1f2db0535dd2fe2` | current parent | passed | 管理员 ZIP、严格解析、CAS/Job、隔离 Chromium；全量 798/build/shell/audit 通过 |
| PB04 | passed | `ae5f4d4a7a3c603cf41a882f911667fd190a707f` | current parent | passed | Release 235；Docker 构建/8080 健康检查通过；修复 shared dist 生产导出后公网唤醒、登录页与健康探针通过 |

## 外部状态

- PocketBay Release 235 已部署；控制面最终返回 `next_action=done`、`project_status=running`，公开入口为 `https://html-ppt-template-asset-library.pocketbay.app`。
- 线上首次候选 Release 234 因共享包生产导出缺失导致 API `ERR_MODULE_NOT_FOUND`/公网 502；最小修复提交 `ae5f4d4a7a3c603cf41a882f911667fd190a707f` 后 Release 235 构建通过。
- 动态应用休眠时公网会暂时返回 204；通过真实浏览器“唤醒并继续”后，`/` 303、`/login` 200、`/api/health/live` 200、`/api/health/ready` 200。
- 公开命令行 POST 注册探针受 PocketBay 外层代理返回 502，未将其误报为应用 403；注册关闭由 API/Web 源码、全量测试、环境 `REGISTRATION_ENABLED=false` 和登录页无注册入口共同覆盖。
- 旧 P17 保持 blocked；未修改其 CHAIN_STATE/STATUS/handoff。
- `.workbuddy/` 保持用户自有未跟踪目录；未读取或修改。
