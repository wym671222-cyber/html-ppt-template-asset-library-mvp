import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import type BetterSqlite3 from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { bootstrapAdministrator } from './service.js'

class MutedOutput extends Writable {
  muted = false

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) process.stdout.write(chunk, encoding)
    callback()
  }
}

export async function readHiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Administrator bootstrap requires an interactive terminal')
  const output = new MutedOutput()
  const line = createInterface({ input: process.stdin, output, terminal: true })
  process.stdout.write(prompt)
  output.muted = true
  try { return await line.question('') }
  finally {
    output.muted = false
    line.close()
    process.stdout.write('\n')
  }
}

export async function runBootstrap(database: BetterSqlite3.Database, args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error('Usage: seed:admin -- <username>')
  const first = await readHiddenPassword('New administrator password: ')
  const second = await readHiddenPassword('Confirm administrator password: ')
  if (first !== second) throw new Error('Password confirmation does not match')
  const user = await bootstrapAdministrator(database, { username: args[0], password: first })
  process.stdout.write(`${JSON.stringify({ created: true, user })}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { sqlite } = await import('../db/index.js')
  try { await runBootstrap(sqlite) }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Administrator bootstrap failed'}\n`)
    process.exitCode = 1
  } finally { sqlite.close() }
}
