import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  sendAdminPasswordResetEmail,
  sendDeckSharedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../apps/api/src/email/index.js'

const root = process.cwd()

describe('P16S production dependency boundary', () => {
  it('requires the patched Drizzle line and removes the retired mail transport graph', () => {
    const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      pnpm: { overrides: Record<string, string> }
    }
    const manifest = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(rootManifest.pnpm.overrides).toEqual({ 'gel>shell-quote': '1.10.0' })
    expect(manifest.dependencies['@hono/node-server']).toBe('^2.0.5')
    expect(manifest.dependencies['drizzle-orm']).toBe('^0.45.2')
    expect(manifest.devDependencies['drizzle-kit']).toBe('^0.31.10')
    expect(manifest.dependencies).not.toHaveProperty('nodemailer')
    expect(manifest.dependencies).not.toHaveProperty('@aws-sdk/client-ses')
    expect(manifest.devDependencies).not.toHaveProperty('@types/nodemailer')
  })

  it('keeps every retired email entry point fail closed without network setup', async () => {
    const calls = [
      sendVerificationEmail('member@example.invalid', 'token'),
      sendPasswordResetEmail('member@example.invalid', 'token'),
      sendAdminPasswordResetEmail('member@example.invalid', 'token', 'admin'),
      sendDeckSharedEmail('member@example.invalid', 'member', 'deck', 'deck-id', 'viewer'),
    ]

    for (const call of calls) {
      await expect(call).rejects.toThrow('Legacy email capability is retired')
    }
  })
})
