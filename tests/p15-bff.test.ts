import { describe, expect, it } from 'vitest'
import {
  buildTemplateRuntimeCsp,
  TEMPLATE_RUNTIME_PROTOCOL,
  TEMPLATE_RUNTIME_PROTOCOL_HEADER,
  TEMPLATE_RUNTIME_SESSION_HEADER,
  TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS,
} from '../packages/shared/src/index.js'
import { ASSET_LIBRARY_PAGE_CSP, isTemplateRuntimePath, MAX_WRITE_BYTES, normalizedClientAddress, readBoundedBody, trustedApiHeaders, validatedTemplateRuntimeHeaders, validateBrowserWrite } from '../apps/web/src/lib/server/bff-boundary.js'

describe('P15 BFF boundary', () => {
  it('permits only the same-origin reviewed runtime iframe on the asset-library page', () => {
    expect(ASSET_LIBRARY_PAGE_CSP).toContain("frame-src 'self'")
    expect(ASSET_LIBRARY_PAGE_CSP).not.toContain("frame-src 'none'")
    expect(ASSET_LIBRARY_PAGE_CSP).not.toMatch(/frame-src[^;]*(?:https?:|data:|blob:|\*)/)
    expect(ASSET_LIBRARY_PAGE_CSP).toContain("object-src 'none'")
    expect(ASSET_LIBRARY_PAGE_CSP).toContain("frame-ancestors 'self'")
  })

  it('rejects hostile Origin and non-JSON input before the loopback API', async () => {
    expect(validateBrowserWrite(new Headers({ 'content-type': 'application/json' }), 'http://127.0.0.1:5173')?.status).toBe(403)
    expect(validateBrowserWrite(new Headers({ origin: 'https://attacker.example', 'content-type': 'application/json' }), 'http://127.0.0.1:5173')?.status).toBe(403)
    expect(validateBrowserWrite(new Headers({ origin: 'http://127.0.0.1:5173,http://attacker.example', 'content-type': 'application/json' }), 'http://127.0.0.1:5173')?.status).toBe(403)
    expect(validateBrowserWrite(new Headers({ origin: 'http://127.0.0.1:5173', 'content-type': 'text/plain' }), 'http://127.0.0.1:5173')?.status).toBe(415)
    expect(validateBrowserWrite(new Headers({ origin: 'http://127.0.0.1:5173', 'content-type': 'application/json', 'content-length': String(MAX_WRITE_BYTES + 1) }), 'http://127.0.0.1:5173')?.status).toBe(400)
  })

  it('drops browser forwarding metadata and injects only the normalized trusted address', async () => {
    const browserHeaders = new Headers({ cookie: '__Host-ppt_session=opaque', 'x-ppt-client-ip': '198.51.100.1', forwarded: 'for=198.51.100.2', 'x-forwarded-for': '198.51.100.3', 'x-real-ip': '198.51.100.4' })
    const injected = trustedApiHeaders(browserHeaders, '2001:DB8::9', 'POST', 'http://127.0.0.1:5173')
    expect(injected.get('cookie')).toBe('__Host-ppt_session=opaque')
    expect(injected.get('x-ppt-client-ip')).toBe('2001:db8::9')
    expect(injected.get('forwarded')).toBeNull()
    expect(injected.get('x-forwarded-for')).toBeNull()
    expect(injected.get('x-real-ip')).toBeNull()
    expect(injected.get('origin')).toBe('http://127.0.0.1:5173')
    expect(injected.get('content-type')).toBe('application/json')
  })

  it('normalizes only a single IP address', () => {
    expect(normalizedClientAddress('203.0.113.9')).toBe('203.0.113.9')
    expect(normalizedClientAddress('203.0.113.9, 198.51.100.1')).toBe('127.0.0.1')
  })

  it('bounds chunked bodies while reading them', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('x'.repeat(MAX_WRITE_BYTES))); controller.enqueue(encoder.encode('x')); controller.close() } })
    expect((await readBoundedBody(stream) as Response).status).toBe(400)
  })

  it('copies only an exact nonce-bound runtime header contract and drops unrelated headers', () => {
    expect(isTemplateRuntimePath('/api/catalog/assets/simulated-quarterly-brief/runtime')).toBe(true)
    expect(isTemplateRuntimePath('https://attacker.example/api/catalog/assets/simulated-quarterly-brief/runtime')).toBe(false)
    expect(isTemplateRuntimePath('/api/catalog/assets/simulated-quarterly-brief/runtime?relaxed=1')).toBe(false)
    expect(isTemplateRuntimePath('/api/catalog/assets/simulated-quarterly-brief/runtime/extra')).toBe(false)
    const upstream = new Headers({
      ...TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS,
      'Content-Security-Policy': buildTemplateRuntimeCsp('A'.repeat(43)),
      [TEMPLATE_RUNTIME_PROTOCOL_HEADER]: TEMPLATE_RUNTIME_PROTOCOL,
      [TEMPLATE_RUNTIME_SESSION_HEADER]: 'a'.repeat(32),
      'Set-Cookie': 'must-not-cross-the-runtime-proxy=1',
    })
    const trusted = validatedTemplateRuntimeHeaders(upstream)
    expect(trusted).not.toBeNull()
    expect(trusted?.get('set-cookie')).toBeNull()
    expect(trusted?.get(TEMPLATE_RUNTIME_SESSION_HEADER)).toBe('a'.repeat(32))
    for (const [name, value] of Object.entries(TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS)) expect(trusted?.get(name)).toBe(value)

    const relaxed = new Headers(upstream)
    relaxed.set('Content-Security-Policy', upstream.get('Content-Security-Policy')!.replace("connect-src 'none'", 'connect-src https:'))
    expect(validatedTemplateRuntimeHeaders(relaxed)).toBeNull()
    const wrongSession = new Headers(upstream)
    wrongSession.set(TEMPLATE_RUNTIME_SESSION_HEADER, '../shared-session')
    expect(validatedTemplateRuntimeHeaders(wrongSession)).toBeNull()
    const wrongSandbox = new Headers(upstream)
    wrongSandbox.set('Content-Security-Policy', upstream.get('Content-Security-Policy')!.replace('sandbox allow-scripts', 'sandbox allow-scripts allow-same-origin'))
    expect(validatedTemplateRuntimeHeaders(wrongSandbox)).toBeNull()
  })
})
