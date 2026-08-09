# WorkBuddy 原子发布与回滚手册

本目录是 P16 交付的人工生产发布包。P16 只在临时目录、备用端口和隔离 SQLite 中演练；没有连接服务器、修改 Caddy/systemd、迁移生产数据或 push。P17 只有在用户批准包含 P16 完整候选 SHA 的 G2 语句后才能执行生产步骤。

当前 P16 handoff 记录的生产依赖审计仍有 21 个 high，因此本提交不是 P17 可部署候选，下面步骤只是休眠的操作合同，不能据此申请 G2 或执行。只有新的已批准安全修复阶段关闭该门禁、生成新的完整候选 SHA 后，才可重新评估 P17。

## 1. 强制边界

- 生产目标固定 `119.29.241.146`、Origin 固定 `https://ppt.ajjy-ai.site`；代码根固定 `/opt/html-ppt`，数据根固定 `/var/lib/html-ppt`，服务用户固定 `htmlppt`。
- API 只能监听 `127.0.0.1:3001`。Web 只能监听现场重新验证的 `172.18.0.1:4173`；bridge 漂移就停止，不得改成 `0.0.0.0`。
- `ADDRESS_HEADER=x-forwarded-for` 与 `XFF_DEPTH=1` 只适用于已经证明的单跳拓扑“浏览器 → 受控 Caddy → Web”。候选 Caddy 会删除 `Forwarded`、`X-Real-IP` 和入站 `X-Forwarded-For`，再以 `{remote_host}` 写入单值 XFF。若存在 CDN、负载均衡器、第二层代理或浏览器可直达 4173，保持 Web 停止并 fail closed，先重新设计可信代理链。
- deploy/rollback 没有默认 production target；生产命令必须显式写 `--target production`。deploy 还必须同时传入 `--commit` 与 `--approved-commit`，两者都为 G2 语句中的同一 40 位完整 SHA。
- systemd 与发布构建统一使用精确 `/usr/bin/node`，生产 preflight 必须证明它是 Node 22；pnpm 9.15.0 也必须由该二进制执行，不能用 PATH 中另一 Node 代替。
- 脚本不会删除旧 release、旧 `/opt/slide-maker`、PM2 配置、数据库、CAS 或备份；不会输出 Cookie、密码、token 或密钥。

## 2. G2 后的精确顺序

以下 `<APPROVED_SHA>` 必须替换为用户批准语句中的 40 位完整 SHA；禁止短 SHA。

1. 按 P17 授权推送该 SHA，等待同一 SHA 的 GitHub CI 全绿；无 force 地快进生产分支。
2. 在服务器的精确提交检出中执行只读预检：

   ```sh
   bash ops/workbuddy/preflight.sh --target 119.29.241.146
   ```

3. 开启维护/应用只读后，分别记录当前 commit、`current` symlink、DB/CAS/Caddy/systemd 哈希。用 SQLite backup API 或停写后的受控副本备份 DB/WAL/SHM，并备份 CAS、`/etc/caddy/Caddyfile`、两个 systemd unit；备份目录和文件均为 `htmlppt`/root 所需最小所有权，目录 `0700`、文件 `0600`。Preflight 会用 migrator 共用的合同逐项核验 5/6/7 ledger 对应的完整 trigger 集合；Presentation/Item/Export 任一非零、未知表/trigger、缺失 trigger、quick/FK 失败均立即停止。
4. 原子准备并切换代码 symlink（不启动服务、不自动改 Caddy）：

   ```sh
   sudo bash ops/workbuddy/deploy.sh --target production --commit <APPROVED_SHA> --approved-commit <APPROVED_SHA>
   ```

   发布脚本只从精确 Git commit `git archive`，用 systemd 同一个 `/usr/bin/node` 执行 pnpm 9.15.0 frozen install/build，把旧 release 的 `_app/immutable` 文件以 no-clobber 方式累积进新 release，再原子更新 `current` 并保留 `previous`。缺少显式 production target、批准 SHA，或两个 SHA 不完全相同都会在任何生产写入前失败。

5. 保持维护状态，显式运行迁移：

   ```sh
   sudo -u htmlppt env NODE_ENV=production ORIGIN=https://ppt.ajjy-ai.site ASSET_LIBRARY_DATA_ROOT=/var/lib/html-ppt \
     /usr/bin/node /opt/html-ppt/current/apps/api/dist/db/migrate.js
   ```

   迁移器只在存在 pending migration 时创建 pre-migration DB 备份；无 pending 时不制造重复备份。回读 `quick_check`、FK、7 条 ledger、trigger 与业务计数后，才可交互式创建唯一管理员；密码只能通过隐藏 TTY 输入。
6. 安装并验证 systemd 候选，确认 data root/DB/WAL/备份权限，再启动 API/Web。API unit 默认固定 `APP_READ_ONLY=true`；初始启动不得创建 override。用 `ss` 证明 API 仅 `127.0.0.1:3001`、Web 仅 `172.18.0.1:4173`，进程 UID 是 `htmlppt`，进程 executable 是 `/usr/bin/node`；`curl http://127.0.0.1:3001/api/health/ready` 必须 200，写请求必须返回 `503 APP_READ_ONLY`。
7. 先把 Caddy 候选安装到独立 candidate 路径并 `caddy validate`，再原子替换 `/etc/caddy/Caddyfile`、二次 validate、reload。不得直接覆盖未备份配置。公网执行：

   ```sh
   bash ops/workbuddy/smoke.sh --origin https://ppt.ajjy-ai.site
   ```

8. 只有 P17 已通过备份、迁移、trigger/ledger、权限、监听、非 root、ready、默认只读、Caddy validate/smoke 和可信单跳代理这些“开放写入前门禁”，并由当次获批操作明确记录后，才可在仍有边缘维护保护时创建 override：

   ```sh
   sudo install -d -o root -g root -m 0755 /etc/html-ppt
   sudoedit /etc/html-ppt/api.env
   # 文件唯一非注释行必须是：APP_READ_ONLY=false
   sudo chown root:root /etc/html-ppt/api.env
   sudo chmod 0600 /etc/html-ppt/api.env
   bash ops/workbuddy/preflight.sh --target 119.29.241.146 --allow-write-override
   sudo systemctl restart html-ppt-api.service
   ```

   `/etc/html-ppt/api.env` 禁止符号链接，只允许一个 `APP_READ_ONLY=true|false` 赋值；preflight 会核验 `root:root 0600` 且不会输出文件内容。默认 production preflight 遇到 false 会阻断，只有完成上述门禁后的显式 `--allow-write-override` 才接受；没有该文件时 unit 永远 fail closed 为 true。
9. 在边缘维护保护下完成注册→审批→登录→强制改密、A/B 404 隔离、admin recovery、Origin/401/403/404、主机重启恢复、日志可定位且无凭据等 P17 全门禁后，才移除维护状态。

## 3. 回滚

只有在开放注册或产生新业务数据之前才能恢复旧 DB/CAS；产生新数据后只允许前向修复。

1. 重新开启维护，停止新 systemd 服务，记录当前完整 SHA。
2. 恢复已记录的 DB/CAS/Caddy/systemd 备份，逐项校验哈希、SQLite quick/FK、Caddy validate。
3. 用明确的旧 SHA 和当前 SHA 原子回退代码 symlink：

   ```sh
   sudo bash ops/workbuddy/rollback.sh --target production --commit <OLD_FULL_SHA> --expected-current <CURRENT_FULL_SHA>
   ```

4. 重启对应旧服务，验证 loopback/bridge 监听和公网健康。任何回读失败都保持维护状态。

回滚脚本只切换 `current`/`previous`，不自动停止或启动服务，不删除任何 release/备份/PM2 状态，也不猜测数据恢复点。
