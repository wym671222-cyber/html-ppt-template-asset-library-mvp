# P11 临时只读与访问日志配置

`Caddyfile.p11-read-only` 是 P11 的待审批运维资产，不是已应用的生产配置。它只让以下 API 通过边缘代理：

- `GET|HEAD /api/health/live|ready`
- `GET|HEAD /api/catalog`
- `GET|HEAD /api/catalog/assets/*`（受控 PNG）

其他 `/api/*` 请求统一返回 `503 {"error":"APP_READ_ONLY"}`；页面与 `_app` 静态资源仍转发到 Web。API 进程还必须设置 `APP_READ_ONLY=true`，形成不依赖边缘配置的写入止险层。

## 本机只读验证

下面的命令只读取仓库配置，并把日志写入临时容器。它不连接生产服务器，也不 reload Caddy：

```sh
docker run --rm \
  -e P11_LOG_PATH=/tmp/html-ppt-access.json \
  -v "$PWD/ops/caddy/Caddyfile.p11-read-only:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.0-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

默认值仅供临时验证：站点 `http://localhost`、Web `127.0.0.1:4173`、API `127.0.0.1:3001`。申请 G1 前必须把 `P11_SITE_ADDRESS`、`P11_WEB_UPSTREAM`、`P11_API_UPSTREAM` 与现场只读快照逐项核对；地址漂移时停止，不能猜测替换。

## JSON 日志与轮转

访问日志采用 Caddy JSON 编码，默认文件 `/var/log/caddy/html-ppt-access.json`、权限 `0600`、10 MiB 轮转、保留 10 个文件且最长 30 天。日志配置不添加请求头、Cookie 或请求体；运维排障只使用时间、请求方法/URI、状态码、耗时和响应大小等 Caddy 标准字段。

## G1 后的备份、验证、应用与回滚模板

以下命令是人工 runbook，不是 P11 已执行证据。只有父监督者展示现场路径并获得 G1 后才可运行；`<UTC_TIMESTAMP>` 必须先替换为实际 UTC 时间戳，禁止使用未解析变量执行恢复。

1. 备份路径：`/etc/caddy/backups/Caddyfile.pre-p11-<UTC_TIMESTAMP>`。
2. 应用前验证：`sudo caddy validate --config /etc/caddy/Caddyfile.p11-candidate --adapter caddyfile`。
3. 备份后原子安装候选配置，再次执行同一 validate；只有两次均通过才可 `sudo systemctl reload caddy`。
4. 回滚恢复：`sudo install -o root -g root -m 0644 /etc/caddy/backups/Caddyfile.pre-p11-<UTC_TIMESTAMP> /etc/caddy/Caddyfile`。
5. 回滚验证：`sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`；通过后才可 `sudo systemctl reload caddy`。

回滚只恢复 Caddy 配置并保留访问日志，不改应用数据库、CAS、备份、PM2 或服务数据。P11 未执行上述任何服务器命令。
