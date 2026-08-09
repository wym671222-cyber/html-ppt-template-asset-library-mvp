import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer as createHealthServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chdir } from 'node:process'
import { createServer } from 'vite'

async function main(): Promise<void> {
  chdir(resolve('apps/web'))
  const certificateRoot = mkdtempSync(join(tmpdir(), 'asset-library-p15-cert-'))
  const key = join(certificateRoot, 'key.pem')
  const cert = join(certificateRoot, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 5176, strictPort: true, https: { key: readFileSync(key), cert: readFileSync(cert) } } })
  await vite.listen()
  createHealthServer((_request, response) => { response.writeHead(200); response.end('ok') }).listen(5177, '127.0.0.1')
}
void main()
