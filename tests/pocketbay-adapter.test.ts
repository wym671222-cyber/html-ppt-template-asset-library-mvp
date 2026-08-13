import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp, isPocketBayOrigin } from '../apps/api/src/app.js'
import { resolveDataRoot } from '../apps/api/src/db/paths.js'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('PocketBay adapter boundaries', () => {
  it('accepts only HTTPS project origins on the PocketBay app domain', () => {
    expect(isPocketBayOrigin('https://demo.pocketbay.app')).toBe(true)
    expect(isPocketBayOrigin('https://demo-2.pocketbay.app')).toBe(true)
    expect(isPocketBayOrigin('http://demo.pocketbay.app')).toBe(false)
    expect(isPocketBayOrigin('https://demo.pocketbay.app/path')).toBe(false)
    expect(isPocketBayOrigin('https://demo.pocketbay.app.evil.example')).toBe(false)
    expect(isPocketBayOrigin('https://pocketbay.app')).toBe(false)
  })

  it('keeps the original production data root contract outside PocketBay runtime', () => {
    expect(resolveDataRoot('/var/lib/html-ppt', 'production')).toBe('/var/lib/html-ppt')
    expect(() => resolveDataRoot('/data', 'production')).toThrow(/var\/lib\/html-ppt/)
  })

  it('allows only the configured persistent root in PocketBay production', () => {
    const previousRuntime = process.env.POCKETBAY_RUNTIME
    const previousDataRoot = process.env.POCKETBAY_DATA_DIR
    try {
      process.env.POCKETBAY_RUNTIME = 'true'
      process.env.POCKETBAY_DATA_DIR = '/data'
      expect(resolveDataRoot('/data', 'production')).toBe('/data')
      expect(() => resolveDataRoot('/var/lib/html-ppt', 'production')).toThrow(/exactly \/data/)
      process.env.POCKETBAY_DATA_DIR = '/data/../data'
      expect(() => resolveDataRoot('/data', 'production')).toThrow(/normalized absolute path/)
    } finally {
      if (previousRuntime === undefined) delete process.env.POCKETBAY_RUNTIME
      else process.env.POCKETBAY_RUNTIME = previousRuntime
      if (previousDataRoot === undefined) delete process.env.POCKETBAY_DATA_DIR
      else process.env.POCKETBAY_DATA_DIR = previousDataRoot
    }
  })

  it('accepts only the configured PocketBay preflight Origin', async () => {
    const app = createApp({ allowedOrigins: ['https://demo.pocketbay.app'] })
    const accepted = await app.request('http://127.0.0.1/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://demo.pocketbay.app' },
    })
    expect(accepted.status).toBe(204)
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://demo.pocketbay.app')

    const rejected = await app.request('http://127.0.0.1/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://other-project.pocketbay.app' },
    })
    expect(rejected.status).toBe(403)
  })

  it('keeps the container single-process boundary and excludes local state', () => {
    const dockerfile = read('Dockerfile')
    const dockerignore = read('.dockerignore')
    const launcher = read('ops/pocketbay/start.mjs')

    expect(dockerfile).toContain('ENV POCKETBAY_DATA_DIR=/data')
    expect(dockerfile).toContain('CMD ["node", "ops/pocketbay/start.mjs"]')
    expect(dockerfile).not.toMatch(/POCKETBAY_ADMIN_(?:USERNAME|PASSWORD)=/)
    for (const excluded of ['.workbuddy', 'apps/api/data', '*.db', 'ops/pocketbay/admin-bootstrap.conf']) {
      expect(dockerignore).toContain(excluded)
    }
    expect(launcher).toContain("HOST: '0.0.0.0'")
    expect(launcher).toContain('P06_API_URL: `http://127.0.0.1:${apiPort}`')
    expect(launcher).toContain('ASSET_LIBRARY_DATA_ROOT: dataRoot')
  })

  it('fails closed before startup when PocketBay ports are invalid', () => {
    const invalidPort = spawnSync(process.execPath, ['ops/pocketbay/start.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PORT: 'invalid' },
    })
    expect(invalidPort.status).not.toBe(0)
    expect(invalidPort.stderr).toContain('requires a numeric PORT')

    const collidingPorts = spawnSync(process.execPath, ['ops/pocketbay/start.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PORT: '3001', POCKETBAY_API_PORT: '3001' },
    })
    expect(collidingPorts.status).not.toBe(0)
    expect(collidingPorts.stderr).toContain('must be a distinct valid port')
  })
})
