import { isIP } from 'node:net'

export const MAX_WRITE_BYTES = 16_384

export function normalizedClientAddress(value: unknown): string {
  return typeof value === 'string' && isIP(value) !== 0 ? value.toLowerCase() : '127.0.0.1'
}

export function validateBrowserWrite(headers: Headers, expectedOrigin: string, maxBytes = MAX_WRITE_BYTES): Response | null {
  const origin = headers.get('origin')
  if (origin !== expectedOrigin || origin.includes(',')) return Response.json({ error: 'Exact Origin required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test((headers.get('content-type') ?? '').trim())) return Response.json({ error: 'JSON Content-Type required' }, { status: 415, headers: { 'Cache-Control': 'no-store' } })
  const contentLength = headers.get('content-length')
  if (contentLength !== null && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > maxBytes)) return Response.json({ error: 'JSON request body is invalid or too large' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  return null
}

export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, maxBytes = MAX_WRITE_BYTES): Promise<string | Response> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return Response.json({ error: 'JSON request body is invalid or too large' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(joined)
}

export function validateBrowserBinaryWrite(headers: Headers, expectedOrigin: string, mediaType: string, maxBytes: number): Response | null {
  const origin = headers.get('origin')
  if (origin !== expectedOrigin || origin.includes(',')) return Response.json({ error: 'Exact Origin required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  if ((headers.get('content-type') ?? '').toLowerCase().trim() !== mediaType) return Response.json({ error: `${mediaType} Content-Type required` }, { status: 415, headers: { 'Cache-Control': 'no-store' } })
  const contentLength = headers.get('content-length')
  if (contentLength !== null && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > maxBytes)) return Response.json({ error: 'Binary request body is invalid or too large' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  return null
}

export async function readBoundedBinaryBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | Response> {
  if (!body) return Response.json({ error: 'Binary request body is missing' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return Response.json({ error: 'Binary request body is invalid or too large' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}

export function trustedApiHeaders(browserHeaders: Headers, clientAddress: unknown, method: string, origin: string): Headers {
  const headers = new Headers()
  const cookie = browserHeaders.get('cookie')
  if (cookie) headers.set('Cookie', cookie)
  headers.set('X-PPT-Client-IP', normalizedClientAddress(clientAddress))
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Origin', origin)
    headers.set('Content-Type', 'application/json')
  }
  return headers
}
