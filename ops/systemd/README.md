# HTML PPT systemd 候选单元

这两个单元只属于 P16 候选发布包，P16 不安装、不启动。P17 获得包含精确候选 SHA 的 G2 后，WorkBuddy 才可在服务器上把它们以 `root:root 0644` 安装到 `/etc/systemd/system/`，执行 `systemd-analyze verify`，再 `daemon-reload` 与启用。

- `html-ppt-api.service`：固定 `htmlppt` 用户、`127.0.0.1:3001`（由 API composition root 强制）、`ORIGIN=https://ppt.ajjy-ai.site`、`ASSET_LIBRARY_DATA_ROOT=/var/lib/html-ppt`，并默认 `APP_READ_ONLY=true`。只有 P17 的开放写入前门禁全部通过后，才可用 `/etc/html-ppt/api.env` 显式覆盖；该文件必须非 symlink、`root:root 0600`，且唯一非注释行只能是 `APP_READ_ONLY=true|false`。默认 preflight 拒绝 false，只有门禁后的显式 `--allow-write-override` 才能放行。
- `html-ppt-web.service`：固定 `172.18.0.1:4173`，只允许当前已验证的 Caddy Docker bridge 到达；地址漂移即阻断。Web 仅在证明“浏览器 → 单层受控 Caddy → Web”时启用 `ADDRESS_HEADER=x-forwarded-for`、`XFF_DEPTH=1`。
- 两个单元都以 `UMask=0077`、只读代码树和 systemd hardening 运行；只有 API 可写 `/var/lib/html-ppt`。
- 两个单元的 `ExecStart` 都固定 `/usr/bin/node`。生产 preflight 必须验证该精确二进制为 Node 22；发布构建的 pnpm 也由同一个二进制执行，不能用 PATH 中另一 Node 作为替代证据。

不得把 Web 改成 `0.0.0.0`，不得把 API 改离 loopback，也不得在存在 CDN、负载均衡器或第二代理跳点时沿用当前代理地址设置。拓扑无法证明时保持服务未启动并按 runbook fail closed。
