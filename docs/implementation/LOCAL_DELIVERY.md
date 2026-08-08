# MVP 本地交付说明

## 交付范围与边界

本交付物是本机、单 Owner、loopback-only 的 HTML 汇报模板资产库 MVP。唯一允许的验收模板输入是仓库内 `fixtures/p03-simulated-template/`。它不包含真实 `02_HTML_PPT_组件与模板` 资产导入、云存储、多人/身份/RBAC、发布、部署或远程推送。

实际本地目标路径固定为：

- SQLite：`apps/api/data/asset-library.db`
- CAS：`apps/api/data/objects/sha256/`
- 备份：`apps/api/data/recovery-backups/`
- 隔离恢复演练：`apps/api/data/recovery-drills/`

这些路径均为 git-ignore 的本地状态。P10 验收时实际业务库为空；不要把 fixture 旅程理解成真实素材已被导入或验收。

## 启动前检查

不要运行迁移、备份、恢复或产品服务来代替只读检查。先确认分支和工作树，并用 immutable/query-only 模式检查现有数据库：

```sh
git status --short --branch
sqlite3 "file:$PWD/apps/api/data/asset-library.db?mode=ro&immutable=1" \
  'PRAGMA query_only=ON; PRAGMA foreign_keys=ON; PRAGMA quick_check; PRAGMA foreign_key_check;'
```

若发现未知表、对象、符号链接、哈希不一致或不确定的非临时数据，停止；不要 drop、reset、自行迁移、清理或覆盖。启动 API 会运行其受控的 migration preflight，可能创建新的本地 pre-migration backup；因此它不是只读验收命令。

## 本地运行

在已有依赖和本机 Google Chrome 可用的前提下，分别启动 API 与 Web；两者都固定绑定 loopback：

```sh
# terminal 1
API_PORT=3001 node_modules/.bin/tsx apps/api/src/index.ts

# terminal 2
cd apps/web
P06_API_URL=http://127.0.0.1:3001 node_modules/.bin/vite dev --host 127.0.0.1 --port 5173 --strictPort
```

打开 `http://127.0.0.1:5173/`。活动 API 只接受 loopback Host/Origin 和固定 OwnerContext；旧 auth/admin/sharing/provider/preview/export/search 路由应为 404。Web 仅显示受控 catalog JSON、P05 PNG、Presentation/导出/恢复的受控 JSON 与下载，不会执行模板 HTML。

## 可重复验收

```sh
P05_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
P06_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node_modules/.bin/vitest run

bash tests/run_all.sh
node_modules/.bin/tsc --noEmit -p packages/shared/tsconfig.json
node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json --rootDir .

(cd apps/web && node_modules/.bin/svelte-kit sync && \
  node_modules/.bin/svelte-check --tsconfig ./tsconfig.json && node_modules/.bin/vite build)

P02_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
P05_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
P06_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node_modules/.bin/playwright test --config=playwright.p02.config.ts

P02_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
P05_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
P06_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node_modules/.bin/playwright test --config=playwright.p06.config.ts
```

P10 当前实测结果为 Vitest 28 files/737 tests、shell 8/8、P02 Chrome 1/1、P06-P09 Chrome 10/10。P08 offline case 证明解包 ZIP 为 0 HTTP(S)、0 宿主 cookie、0 script/iframe/form；P09 在隔离临时 DB/CAS 内重验 CAS、PNG、固定 version Presentation、manifest/HTML/ZIP 和恢复边界。

## 已知环境限制

根 `pnpm build` 在当前 pnpm 运行时因 `better-sqlite3` 与 `esbuild` 的 ignored lifecycle scripts 而失败。不要在本交付流程运行 `pnpm approve-builds`，也不要添加 `allowBuilds` 或修改锁文件；这不是产品代码失败，直接 API/shared/Web 检查已通过。

## 恢复说明

P09 仅支持从受控清单恢复到全新的隔离目录，绝不覆盖源数据库、CAS、export、backup 或已有 restore。实际目标当前为空，历史 P09 backup/restore 只证明空目标的非破坏性；有对象的恢复保证由 fixture-only 自动回归证明。任何真实业务数据接入或异机/云灾备都不在本 MVP 内，需另行授权。
