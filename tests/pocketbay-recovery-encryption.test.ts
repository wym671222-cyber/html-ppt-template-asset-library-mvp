import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'
import { decryptRecoveryArchive, encryptRecoveryArchive } from '../apps/web/src/lib/recovery-encryption.js'

beforeAll(() => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
})

describe('PocketBay browser-only recovery encryption', () => {
  it('round-trips a stored ZIP with AES-256-GCM and never embeds the passphrase', async () => {
    const archive = createStoredZip([{ relativePath: 'backup-manifest.json', content: Buffer.from('{"fixture":true}\n') }])
    const passphrase = 'fixture-only-strong-passphrase'
    const encrypted = await encryptRecoveryArchive(archive, passphrase)
    expect(Buffer.from(encrypted).includes(Buffer.from(passphrase))).toBe(false)
    expect(Buffer.from(encrypted).equals(archive)).toBe(false)
    expect(Buffer.from(await decryptRecoveryArchive(encrypted, passphrase))).toEqual(archive)
  })

  it('fails closed for a wrong passphrase or a modified envelope', async () => {
    const archive = createStoredZip([{ relativePath: 'backup-manifest.json', content: Buffer.from('{"fixture":true}\n') }])
    const encrypted = await encryptRecoveryArchive(archive, 'fixture-only-strong-passphrase')
    await expect(decryptRecoveryArchive(encrypted, 'different-fixture-passphrase')).rejects.toThrow(/错误|损坏/)
    const tampered = Uint8Array.from(encrypted)
    tampered[tampered.length - 1] ^= 1
    await expect(decryptRecoveryArchive(tampered, 'fixture-only-strong-passphrase')).rejects.toThrow(/错误|损坏/)
  })
})
