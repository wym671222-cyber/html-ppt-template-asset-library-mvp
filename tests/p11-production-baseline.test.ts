import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { parseReadOnlyMode } from '../apps/api/src/env.js'

const repositoryRoot = join(import.meta.dirname, '..')

describe('P11 health and read-only behavior', () => {
  it('separates liveness from dependency readiness without leaking diagnostics', async () => {
    let readinessChecks = 0
    const readyApp = createApp({ readiness: () => { readinessChecks += 1 } })

    const live = await readyApp.request('http://127.0.0.1:3001/api/health/live')
    expect(live.status).toBe(200)
    await expect(live.json()).resolves.toEqual({ status: 'live' })
    expect(readinessChecks).toBe(0)

    const ready = await readyApp.request('http://127.0.0.1:3001/api/health/ready')
    expect(ready.status).toBe(200)
    await expect(ready.json()).resolves.toEqual({ status: 'ready' })
    expect(readinessChecks).toBe(1)

    const unavailableApp = createApp({ readiness: () => { throw new Error('database path and secret must not leak') } })
    const unavailable = await unavailableApp.request('http://127.0.0.1:3001/api/health/ready')
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('cache-control')).toBe('no-store')
    await expect(unavailable.json()).resolves.toEqual({ error: 'APP_NOT_READY' })
  })

  it('keeps reads available and rejects every business write with the stable read-only code', async () => {
    const catalog = {
      list: () => ({ owner: 'local-owner', facets: { categories: [], tags: [] }, items: [] }),
    }
    const app = createApp({ catalog: catalog as never, readOnly: true })

    const catalogResponse = await app.request('http://127.0.0.1:3001/api/catalog')
    expect(catalogResponse.status).toBe(200)

    for (const [method, path] of [
      ['POST', '/api/presentations'],
      ['PATCH', '/api/presentations/presentation-1'],
      ['DELETE', '/api/presentations/presentation-1/items/item-1'],
      ['POST', '/api/recovery/backups'],
    ] as const) {
      const response = await app.request(`http://127.0.0.1:3001${path}`, { method })
      expect(response.status, `${method} ${path}`).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({ error: 'APP_READ_ONLY' })
    }

    const normal = await createApp().request('http://127.0.0.1:3001/api/presentations', { method: 'POST' })
    await expect(normal.json()).resolves.toEqual({ error: 'Presentation service unavailable' })
    expect(parseReadOnlyMode(undefined)).toBe(false)
    expect(parseReadOnlyMode('false')).toBe(false)
    expect(parseReadOnlyMode('true')).toBe(true)
    expect(() => parseReadOnlyMode('TRUE')).toThrow('exactly true or false')
  })
})

describe('P11 reproducible build and deployment guardrails', () => {
  it('pins Node and pnpm, commits the adapter-node dependency, and runs CI for every push and PR', () => {
    const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
    const webPackage = JSON.parse(readFileSync(join(repositoryRoot, 'apps/web/package.json'), 'utf8'))
    const lockfile = readFileSync(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')
    const ci = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')

    expect(readFileSync(join(repositoryRoot, '.node-version'), 'utf8').trim()).toBe('22')
    expect(rootPackage.engines).toEqual({ node: '22.x', pnpm: '9.15.0' })
    expect(rootPackage.packageManager).toBe('pnpm@9.15.0')
    expect(webPackage.devDependencies['@sveltejs/adapter-node']).toMatch(/^\^5\./)
    expect(webPackage.devDependencies['@sveltejs/adapter-auto']).toBeUndefined()
    expect(webPackage.devDependencies['@sveltejs/adapter-static']).toBeUndefined()
    expect(lockfile).toContain("'@sveltejs/adapter-node':")
    expect(ci).toContain('pull_request:')
    expect(ci).toContain('push:')
    expect(ci).not.toContain('branches:')
    expect(ci).toContain('node-version: 22.x')
    expect(ci).toContain('version: 9.15.0')
    expect(ci).toContain('pnpm install --frozen-lockfile')
  })

  it('retires the legacy remote deployment path and defines an auditable edge rollback', () => {
    const workflow = readFileSync(join(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')
    const caddy = readFileSync(join(repositoryRoot, 'ops/caddy/Caddyfile.p11-read-only'), 'utf8')
    const runbook = readFileSync(join(repositoryRoot, 'ops/caddy/README.md'), 'utf8')

    expect(workflow).toContain('Deployment guard')
    expect(workflow).not.toMatch(/ssh-action|DEPLOY_PASSWORD|100\.111\.|cuny\.edu|git push/i)
    expect(existsSync(join(repositoryRoot, 'deploy-staging.sh'))).toBe(false)
    expect(caddy).toContain('format json')
    expect(caddy).toContain('roll_size 10MiB')
    expect(caddy).toContain('method GET HEAD')
    expect(caddy).toContain('/api/catalog/assets/*')
    expect(caddy).toContain('respond `{"error":"APP_READ_ONLY"}` 503')
    expect(runbook).toContain('/etc/caddy/backups/Caddyfile.pre-p11-<UTC_TIMESTAMP>')
    expect(runbook).toContain('caddy validate')
    expect(runbook).toContain('systemctl reload caddy')
    expect(runbook).toContain('P11 未执行上述任何服务器命令')
  })
})
