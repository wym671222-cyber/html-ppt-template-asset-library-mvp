import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { bootstrapPocketBayAdministrator } from '../apps/api/src/auth/pocketbay-bootstrap.js'
import { parseAppOrigin, parseRegistrationEnabled } from '../apps/api/src/env.js'

const PUBLIC_ORIGIN = 'https://html-ppt-template-asset-library.pocketbay.app'
const root = process.cwd()

describe('PocketBay production hardening', () => {
  it('pins one exact PocketBay production Origin', () => {
    expect(parseAppOrigin(PUBLIC_ORIGIN, 'production', 'true', PUBLIC_ORIGIN)).toBe(PUBLIC_ORIGIN)
    expect(() => parseAppOrigin('https://other-project.pocketbay.app', 'production', 'true', PUBLIC_ORIGIN)).toThrow(/exactly/)
    expect(() => parseAppOrigin(PUBLIC_ORIGIN, 'production', 'true', 'https://attacker.example')).toThrow(/POCKETBAY_PUBLIC_ORIGIN|pocketbay/)
  })

  it('defaults registration closed on PocketBay and preserves the legacy default elsewhere', () => {
    expect(parseRegistrationEnabled(undefined, 'true')).toBe(false)
    expect(parseRegistrationEnabled(undefined, 'false')).toBe(true)
    expect(parseRegistrationEnabled('false', 'false')).toBe(false)
    expect(parseRegistrationEnabled('true', 'true')).toBe(true)
    expect(() => parseRegistrationEnabled('TRUE', 'true')).toThrow(/exactly true or false/)
  })

  it('returns a stable disabled response without accepting another PocketBay subdomain', async () => {
    const auth = { recordFailure: () => undefined } as never
    const app = createApp({ auth, allowedOrigins: [PUBLIC_ORIGIN], registrationEnabled: false })
    const disabled = await app.request('http://127.0.0.1:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: PUBLIC_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'new_user', password: 'fixture-pass-1' }),
    })
    expect(disabled.status).toBe(403)
    expect(disabled.headers.get('cache-control')).toBe('no-store')
    await expect(disabled.json()).resolves.toEqual({ error: 'REGISTRATION_DISABLED' })

    const alternate = await app.request('http://127.0.0.1:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'https://other-project.pocketbay.app', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(alternate.status).toBe(403)
    await expect(alternate.json()).resolves.toEqual({ error: 'Exact Origin required' })
  })

  it('keeps the one-time bootstrap inert without a complete explicit input', async () => {
    let calls = 0
    const create = async () => { calls += 1; return {} as never }
    expect(await bootstrapPocketBayAdministrator({} as never, { POCKETBAY_RUNTIME: 'true' }, create)).toBe(false)
    await expect(bootstrapPocketBayAdministrator({} as never, { POCKETBAY_RUNTIME: 'true', POCKETBAY_ADMIN_USERNAME: 'admin' }, create)).rejects.toThrow(/both username and password/)
    expect(calls).toBe(0)
  })

  it('closes the public Web route and hides the login registration link by server data', () => {
    const registerServer = readFileSync(join(root, 'apps/web/src/routes/register/+page.server.ts'), 'utf8')
    const loginServer = readFileSync(join(root, 'apps/web/src/routes/login/+page.server.ts'), 'utf8')
    const loginPage = readFileSync(join(root, 'apps/web/src/routes/login/+page.svelte'), 'utf8')
    const loginForm = readFileSync(join(root, 'apps/web/src/lib/components/auth/LoginForm.svelte'), 'utf8')
    expect(registerServer).toContain("redirect(303, '/login')")
    expect(loginServer).toContain('registrationEnabled')
    expect(loginPage).toContain('registrationEnabled={data.registrationEnabled}')
    expect(loginForm).toContain('{#if registrationEnabled}')
  })
})
