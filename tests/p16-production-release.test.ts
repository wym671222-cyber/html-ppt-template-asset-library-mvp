import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TARGET_DATABASE_TRIGGER_SETS, TARGET_DATABASE_TRIGGERS } from '../apps/api/src/db/migrate.js'
import { resolveDataRoot } from '../apps/api/src/db/paths.js'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('P16 production runtime and release contract', () => {
  it('requires the separated production data root while allowing isolated absolute test roots', () => {
    expect(resolveDataRoot('/var/lib/html-ppt', 'production')).toBe('/var/lib/html-ppt')
    expect(() => resolveDataRoot(undefined, 'production')).toThrow(/ASSET_LIBRARY_DATA_ROOT/)
    expect(() => resolveDataRoot('/opt/html-ppt/current/data', 'production')).toThrow(/\/var\/lib\/html-ppt/)
    expect(() => resolveDataRoot('../relative-data', 'test')).toThrow(/normalized absolute path/)
    expect(resolveDataRoot('/tmp/html-ppt-isolated-data', 'test')).toBe('/tmp/html-ppt-isolated-data')
  })

  it('ships non-root hardened API and bridge-only Web systemd units', () => {
    const api = read('ops/systemd/html-ppt-api.service')
    const web = read('ops/systemd/html-ppt-web.service')
    for (const unit of [api, web]) {
      expect(unit).toContain('User=htmlppt')
      expect(unit).toContain('Group=htmlppt')
      expect(unit).toContain('UMask=0077')
      expect(unit).toContain('NoNewPrivileges=true')
      expect(unit).toContain('ProtectSystem=strict')
      expect(unit).not.toMatch(/User=root|0\.0\.0\.0/)
    }
    expect(api).toContain('ASSET_LIBRARY_DATA_ROOT=/var/lib/html-ppt')
    expect(api).toContain('API_PORT=3001')
    expect(api).toContain('Environment=APP_READ_ONLY=true')
    expect(api).not.toContain('Environment=APP_READ_ONLY=false')
    expect(api).toContain('EnvironmentFile=-/etc/html-ppt/api.env')
    expect(api).toContain('ExecStart=/usr/bin/node apps/api/dist/index.js')
    expect(api).toContain('ReadWritePaths=/var/lib/html-ppt')
    expect(web).toContain('HOST=172.18.0.1')
    expect(web).toContain('PORT=4173')
    expect(web).toContain('ORIGIN=https://ppt.ajjy-ai.site')
    expect(web).toContain('ADDRESS_HEADER=x-forwarded-for')
    expect(web).toContain('XFF_DEPTH=1')
  })

  it('pins the single controlled Caddy hop, ready health, TLS headers and cache policy', () => {
    const caddy = read('ops/caddy/Caddyfile.production')
    expect(caddy).toMatch(/^ppt\.ajjy-ai\.site \{/m)
    expect(caddy).toContain('reverse_proxy 172.18.0.1:4173')
    expect(caddy).toContain('health_uri /api/health/ready')
    expect(caddy).toContain('format json')
    expect(caddy).toContain('Strict-Transport-Security')
    expect(caddy).toContain('>Cache-Control "no-cache"')
    expect(caddy).toContain('/_app/immutable/*')
    expect(caddy).toContain('public, max-age=31536000, immutable')
    const drop = caddy.indexOf('header_up -X-Forwarded-For')
    const replace = caddy.indexOf('header_up X-Forwarded-For {remote_host}')
    expect(drop).toBeGreaterThan(0)
    expect(replace).toBeGreaterThan(drop)
    expect(caddy).not.toContain('trusted_proxies')
  })

  it('keeps releases, exact runtime and trigger contracts while refusing ambiguous production targets', () => {
    const deploy = read('ops/workbuddy/deploy.sh')
    const rollback = read('ops/workbuddy/rollback.sh')
    const preflight = read('ops/workbuddy/preflight.sh')
    const migrator = read('apps/api/src/db/migrate.ts')
    const runbook = read('ops/workbuddy/README.md')
    const triggerContract = JSON.parse(read('apps/api/drizzle/schema-trigger-contract.json')) as {
      triggersThroughMigration5: string[]
      migration6TriggerAdditions: string[]
      migration7TriggerAdditions: string[]
      migration8TriggerAdditions: string[]
    }
    expect(deploy).toContain('git -C "$source_root" archive --format=tar "$commit"')
    expect(deploy).toContain('install --frozen-lockfile')
    expect(deploy).toContain('production deployment requires --approved-commit')
    expect(deploy).toContain('[ "$approved_commit" = "$commit" ]')
    expect(deploy).toContain('runuser -u htmlppt -- "$node_binary" "$pnpm_path"')
    expect(deploy).toContain('cp -R -n "$old_immutable/." "$new_immutable/"')
    expect(deploy).toContain('atomic_release_link "$release_root" current')
    expect(deploy).not.toContain('HTML_PPT_TARGET')
    expect(deploy).not.toMatch(/git\s+pull|git\s+push|approve-builds/)
    expect(rollback).toContain('--expected-current')
    expect(rollback).not.toContain('HTML_PPT_TARGET')
    expect(rollback).not.toMatch(/rm\s+-rf|git\s+reset|git\s+push/)
    expect(preflight).toContain('[ -x /usr/bin/node ]')
    expect(preflight).toContain('/usr/bin/node "$pnpm_path" --version')
    expect(preflight).toContain('verify-trigger-contract.mjs')
    expect(preflight).toContain("stat -c '%U:%G'")
    expect(preflight).toContain('APP_READ_ONLY=false requires the explicit post-gate --allow-write-override preflight')
    expect(migrator).toContain('appliedMigrationCount')
    expect(migrator).toContain('TARGET_DATABASE_TRIGGER_SETS[migrationKey]')
    expect(migrator).not.toContain('Object.values(TARGET_DATABASE_TRIGGER_SETS)')
    expect(runbook).toContain('浏览器 → 受控 Caddy → Web')
    expect(runbook).toContain('fail closed')
    expect(runbook).toContain('产生新数据后只允许前向修复')
    expect(runbook).toContain('--target production --commit <APPROVED_SHA> --approved-commit <APPROVED_SHA>')
    expect(runbook).toContain('--target 119.29.241.146 --allow-write-override')

    const fullSha = 'a'.repeat(40)
    const otherSha = 'b'.repeat(40)
    for (const invocation of [
      ['ops/workbuddy/deploy.sh', '--commit', fullSha],
      ['ops/workbuddy/rollback.sh', '--commit', fullSha, '--expected-current', otherSha],
    ]) {
      const result = spawnSync('bash', invocation, { cwd: root, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('--target is required; production is never the default')
    }
    const missingApproval = spawnSync('bash', ['ops/workbuddy/deploy.sh', '--target', 'production', '--commit', fullSha], { cwd: root, encoding: 'utf8' })
    expect(missingApproval.status).not.toBe(0)
    expect(missingApproval.stderr).toContain('production deployment requires --approved-commit')
    const mismatchedApproval = spawnSync('bash', ['ops/workbuddy/deploy.sh', '--target', 'production', '--commit', fullSha, '--approved-commit', otherSha], { cwd: root, encoding: 'utf8' })
    expect(mismatchedApproval.status).not.toBe(0)
    expect(mismatchedApproval.stderr).toContain('--approved-commit must exactly equal --commit')

    expect(TARGET_DATABASE_TRIGGER_SETS['5']).toHaveLength(24)
    expect(TARGET_DATABASE_TRIGGER_SETS['6']).toHaveLength(27)
    expect(TARGET_DATABASE_TRIGGER_SETS['7']).toHaveLength(29)
    expect(TARGET_DATABASE_TRIGGER_SETS['8']).toHaveLength(29)
    expect(TARGET_DATABASE_TRIGGER_SETS['8']).toEqual(TARGET_DATABASE_TRIGGERS)
    expect(TARGET_DATABASE_TRIGGER_SETS['5']).toEqual([...triggerContract.triggersThroughMigration5].sort())
    expect(TARGET_DATABASE_TRIGGER_SETS['6']).toEqual([...triggerContract.triggersThroughMigration5, ...triggerContract.migration6TriggerAdditions].sort())
    expect(TARGET_DATABASE_TRIGGER_SETS['7']).toEqual([...triggerContract.triggersThroughMigration5, ...triggerContract.migration6TriggerAdditions, ...triggerContract.migration7TriggerAdditions].sort())
    expect(TARGET_DATABASE_TRIGGER_SETS['8']).toEqual([...triggerContract.triggersThroughMigration5, ...triggerContract.migration6TriggerAdditions, ...triggerContract.migration7TriggerAdditions, ...triggerContract.migration8TriggerAdditions].sort())

    const verifier = join(root, 'ops/workbuddy/verify-trigger-contract.mjs')
    const contract = join(root, 'apps/api/drizzle/schema-trigger-contract.json')
    for (const migrationCount of ['5', '6', '7', '8'] as const) {
      const result = spawnSync(process.execPath, [verifier, '--contract', contract, '--migration-count', migrationCount], {
        encoding: 'utf8',
        input: `${TARGET_DATABASE_TRIGGER_SETS[migrationCount].join('\n')}\n`,
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`migration ledger ${migrationCount}`)
    }
    const unknownTrigger = spawnSync(process.execPath, [verifier, '--contract', contract, '--migration-count', '8'], {
      encoding: 'utf8',
      input: `${TARGET_DATABASE_TRIGGER_SETS['8'].join('\n')}\nunexpected_p16_trigger\n`,
    })
    expect(unknownTrigger.status).not.toBe(0)
    expect(unknownTrigger.stderr).toContain('unapproved trigger')
    const wrongLedger = spawnSync(process.execPath, [verifier, '--contract', contract, '--migration-count', '6'], {
      encoding: 'utf8',
      input: `${TARGET_DATABASE_TRIGGER_SETS['8'].join('\n')}\n`,
    })
    expect(wrongLedger.status).not.toBe(0)
  })

  it('runs all-branch verification CI without an automated deployment action', () => {
    const ci = read('.github/workflows/ci.yml')
    const guard = read('.github/workflows/deploy.yml')
    expect(ci).toMatch(/pull_request:\s*\n\s*push:/)
    expect(ci).toContain('pnpm install --frozen-lockfile')
    expect(ci).toContain('bash tests/p16-release-rehearsal.sh')
    expect(ci).toContain('playwright install --with-deps chrome')
    expect(ci).toContain('playwright test --config=playwright.p15.config.ts')
    expect(ci).not.toMatch(/ssh-action|appleboy|deploy\.sh --commit|119\.29\.241\.146/)
    expect(guard).toContain('Automated deployment is disabled')
  })
})
