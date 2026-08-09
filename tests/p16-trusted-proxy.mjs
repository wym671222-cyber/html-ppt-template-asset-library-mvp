import { createServer, request } from 'node:http'

const listenPort = Number(process.env.P16_PROXY_PORT)
const upstreamPort = Number(process.env.P16_WEB_PORT)
if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort)) throw new Error('P16 proxy ports are required')

const server = createServer((incoming, outgoing) => {
  const headers = { ...incoming.headers }
  delete headers.forwarded
  delete headers['x-forwarded-for']
  delete headers['x-real-ip']
  headers['x-forwarded-for'] = incoming.socket.remoteAddress ?? '127.0.0.1'
  headers['x-forwarded-proto'] = 'http'
  headers.host = `127.0.0.1:${listenPort}`
  const upstream = request({ hostname: '127.0.0.1', port: upstreamPort, method: incoming.method, path: incoming.url, headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(outgoing)
  })
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' })
    outgoing.end('upstream unavailable')
  })
  incoming.pipe(upstream)
})

server.listen(listenPort, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'p16_trusted_proxy_ready', host: '127.0.0.1', port: listenPort }))
})
