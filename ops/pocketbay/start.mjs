import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const root = new URL('../../', import.meta.url)
const rootPath = decodeURIComponent(root.pathname)
const port = Number(process.env.PORT)
const apiPort = Number(process.env.POCKETBAY_API_PORT ?? 3001)
const dataRoot = process.env.POCKETBAY_DATA_DIR ?? '/data'
const adminConfigPath = process.env.POCKETBAY_ADMIN_CONFIG_PATH ?? `${rootPath}/ops/pocketbay/admin-bootstrap.conf`

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

if (!validPort(port)) throw new Error('PocketBay requires a numeric PORT environment variable')
if (!validPort(apiPort) || apiPort === port) throw new Error('POCKETBAY_API_PORT must be a distinct valid port')
if (!/^\//.test(dataRoot)) throw new Error('POCKETBAY_DATA_DIR must be an absolute path')

function readAdminBootstrapConfig(path) {
  if (!existsSync(path)) return {}
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) throw new Error('PocketBay administrator bootstrap config is malformed')
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1)
    if (key !== 'POCKETBAY_ADMIN_USERNAME' && key !== 'POCKETBAY_ADMIN_PASSWORD') {
      throw new Error('PocketBay administrator bootstrap config contains an unsupported key')
    }
    values[key] = value
  }
  if (values.POCKETBAY_ADMIN_USERNAME === undefined && values.POCKETBAY_ADMIN_PASSWORD === undefined) return {}
  if (!values.POCKETBAY_ADMIN_USERNAME || !values.POCKETBAY_ADMIN_PASSWORD) {
    throw new Error('PocketBay administrator bootstrap config requires both username and password')
  }
  return values
}

const adminBootstrap = readAdminBootstrapConfig(adminConfigPath)

const common = {
  ...process.env,
  NODE_ENV: 'production',
  POCKETBAY_RUNTIME: 'true',
  POCKETBAY_DATA_DIR: dataRoot,
  ASSET_LIBRARY_DATA_ROOT: dataRoot,
  ORIGIN: 'https://ppt.ajjy-ai.site',
  ...adminBootstrap,
}

const webEnvironment = { ...common }
// SvelteKit must derive the public PocketBay origin from the forwarded Host.
// The API keeps the fixed production Origin above for its own env contract.
delete webEnvironment.ORIGIN
webEnvironment.PROTOCOL_HEADER = 'x-forwarded-proto'
webEnvironment.HOST_HEADER = 'x-forwarded-host'

const api = spawn(process.execPath, ['apps/api/dist/index.js'], {
  cwd: rootPath,
  env: {
    ...common,
    API_PORT: String(apiPort),
    APP_READ_ONLY: process.env.APP_READ_ONLY ?? 'false',
  },
  stdio: 'inherit',
})

const web = spawn(process.execPath, ['apps/web/build/index.js'], {
  cwd: rootPath,
  env: {
    ...webEnvironment,
    HOST: '0.0.0.0',
    PORT: String(port),
    P06_API_URL: `http://127.0.0.1:${apiPort}`,
    P15_BROWSER_ORIGIN: '',
  },
  stdio: 'inherit',
})

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (!api.killed) api.kill('SIGTERM')
  if (!web.killed) web.kill('SIGTERM')
  setTimeout(() => process.exit(code), 1000).unref()
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
api.on('exit', (code, signal) => {
  if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0))
})
web.on('exit', (code, signal) => {
  if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0))
})
