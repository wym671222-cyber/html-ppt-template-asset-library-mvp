import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { chromium } from '@playwright/test'
import {
  isTemplateRuntimeEventMessage,
  TEMPLATE_RUNTIME_PROTOCOL,
  TEMPLATE_RUNTIME_READY,
  TEMPLATE_RUNTIME_REPLAY,
  TEMPLATE_RUNTIME_RESET,
  TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS,
  type TemplateRuntimeEventMessage,
} from '@slide-maker/shared'
import type { CompiledInteractiveTemplateRuntime } from '../templates/interactive-template-runtime.js'
import type { SecurePreviewRender, SecurePreviewRendererOptions } from './secure-preview.js'
import { captureElementThumbnail } from './scaled-screenshot.js'

const HARNESS_CSP = (nonce: string) => [
  "default-src 'none'",
  `script-src 'nonce-${nonce}'`,
  "script-src-attr 'none'",
  `style-src 'nonce-${nonce}'`,
  "style-src-attr 'none'",
  "img-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "frame-src 'self'",
  "child-src 'self'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

function safeJavascriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function harnessHtml(runtimePath: string, nonce: string): Buffer {
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><style nonce="${nonce}">
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100vw;height:100vh}
</style></head><body><iframe id="ppt-runtime-frame" title="Interactive template runtime" sandbox="allow-scripts" src="${runtimePath}"></iframe>
<script nonce="${nonce}">
(() => {
  'use strict'
  const frame = document.getElementById('ppt-runtime-frame')
  window.__pptRuntimeMessage = null
  addEventListener('message', (event) => {
    const value = event.data
    if (event.source !== frame.contentWindow || event.origin !== 'null' || !value || typeof value !== 'object' || Array.isArray(value)
      || value.protocol !== ${safeJavascriptValue(TEMPLATE_RUNTIME_PROTOCOL)}
      || (value.type !== 'ready' && value.type !== 'error')) return
    window.__pptRuntimeMessage = { data: value, origin: event.origin }
  })
})()
</script></body></html>`, 'utf8')
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') return reject(new Error('Interactive preview server did not bind an IPv4 loopback TCP port'))
      resolveListening(address.port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
}

function allowedRequest(requestUrl: string, method: string, origin: string, allowedPaths: ReadonlySet<string>): boolean {
  if (method !== 'GET') return false
  let url: URL
  try { url = new URL(requestUrl) } catch { return false }
  return url.protocol === 'http:'
    && url.origin === origin
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && allowedPaths.has(url.pathname)
}

function isBoundRuntimeWindowMessage(value: unknown): value is { data: TemplateRuntimeEventMessage; origin: 'null' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.origin === 'null' && isTemplateRuntimeEventMessage(record.data)
}

export async function renderInteractiveSecurePreview(
  runtime: CompiledInteractiveTemplateRuntime,
  options: SecurePreviewRendererOptions,
): Promise<SecurePreviewRender> {
  const token = randomBytes(16).toString('hex')
  const harnessNonce = randomBytes(32).toString('base64url')
  const harnessPath = `/${token}/harness.html`
  const runtimePath = `/${token}/runtime.html`
  const harness = harnessHtml(runtimePath, harnessNonce)
  let cookieHeaderCount = 0
  const auditToken = randomBytes(16).toString('hex')
  const networkAuditPath = `/${auditToken}/fetch?secret=1`
  const selfNavigationAuditPath = `/${auditToken}/escaped?secret=1`
  let networkAuditHitCount = 0
  let selfNavigationAuditHitCount = 0
  let unexpectedAuditHitCount = 0

  const auditServer = createServer((request, response) => {
    const address = auditServer.address()
    if (!address || typeof address === 'string') return response.writeHead(503).end()
    const origin = `http://127.0.0.1:${address.port}`
    let url: URL
    try { url = new URL(request.url ?? '/', origin) }
    catch { unexpectedAuditHitCount += 1; return response.writeHead(400, { 'Cache-Control': 'no-store' }).end() }
    if (request.headers.host !== origin.slice('http://'.length) || request.method !== 'GET') unexpectedAuditHitCount += 1
    else if (`${url.pathname}${url.search}` === networkAuditPath) networkAuditHitCount += 1
    else if (`${url.pathname}${url.search}` === selfNavigationAuditPath) selfNavigationAuditHitCount += 1
    else unexpectedAuditHitCount += 1
    return response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
  })

  const server = createServer((request, response) => {
    const address = server.address()
    if (!address || typeof address === 'string') return response.writeHead(503).end()
    const origin = `http://127.0.0.1:${address.port}`
    let url: URL
    try { url = new URL(request.url ?? '/', origin) }
    catch { return response.writeHead(400, { 'Cache-Control': 'no-store' }).end() }
    if (request.headers.cookie) cookieHeaderCount += 1
    if (request.headers.host !== origin.slice('http://'.length)
      || request.method !== 'GET'
      || url.search
      || url.hash
      || (url.pathname !== harnessPath && url.pathname !== runtimePath)) {
      return response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    }
    if (url.pathname === runtimePath) {
      response.writeHead(200, {
        ...TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS,
        'Content-Length': String(runtime.html.byteLength),
        'Content-Security-Policy': runtime.contentSecurityPolicy,
      })
      return response.end(runtime.html)
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': String(harness.byteLength),
      'Content-Security-Policy': HARNESS_CSP(harnessNonce),
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    return response.end(harness)
  })

  let browser
  try {
    const auditPort = await listen(auditServer)
    const auditOrigin = `http://127.0.0.1:${auditPort}`
    const networkAuditUrl = `${auditOrigin}${networkAuditPath}`
    const selfNavigationAuditUrl = `${auditOrigin}${selfNavigationAuditPath}`
    const port = await listen(server)
    const origin = `http://127.0.0.1:${port}`
    const harnessUrl = `${origin}${harnessPath}`
    const runtimeUrl = `${origin}${runtimePath}`
    const allowedPaths = new Set([harnessPath, runtimePath])
    browser = await chromium.launch({
      executablePath: options.chromiumExecutablePath,
      headless: true,
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--no-first-run',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    })
    const context = await browser.newContext({
      acceptDownloads: false,
      colorScheme: 'light',
      deviceScaleFactor: 1,
      javaScriptEnabled: true,
      locale: 'en-US',
      permissions: [],
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      storageState: { cookies: [], origins: [] },
      timezoneId: 'UTC',
      viewport: { width: 1280, height: 720 },
    })
    context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 15_000)
    const initialCookies = await context.cookies()
    if (initialCookies.length > 0) throw new Error('Interactive Chromium context did not start with empty cookie state')
    let allowedRequestCount = 0
    const blockedRequests: string[] = []
    await context.route('**/*', async (route) => {
      const request = route.request()
      if (request.method() === 'GET' && (request.url() === networkAuditUrl || request.url() === selfNavigationAuditUrl)) {
        await route.continue()
      } else if (allowedRequest(request.url(), request.method(), origin, allowedPaths)) {
        allowedRequestCount += 1
        await route.continue()
      } else {
        blockedRequests.push(request.url())
        await route.abort('blockedbyclient')
      }
    })

    const page = await context.newPage()
    let blockedSecurityEventCount = 0
    let newWindowCount = 0
    page.on('console', (message) => {
      if (/Refused to|Content Security Policy/i.test(message.text())) blockedSecurityEventCount += 1
    })
    page.on('popup', (popup) => {
      newWindowCount += 1
      void popup.close()
    })
    await page.goto(harnessUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean((window as unknown as { __pptRuntimeMessage?: unknown }).__pptRuntimeMessage))
    const runtimeMessage = await page.evaluate(() => (window as unknown as { __pptRuntimeMessage: unknown }).__pptRuntimeMessage)
    if (!isBoundRuntimeWindowMessage(runtimeMessage)
      || runtimeMessage.data.type !== TEMPLATE_RUNTIME_READY
      || runtimeMessage.data.sessionId !== runtime.sessionId
      || runtimeMessage.data.assetId !== runtime.assetId
      || runtimeMessage.data.version !== runtime.version
      || runtimeMessage.data.sourceDigest !== runtime.sourceDigest) {
      throw new Error('Interactive runtime did not produce a source-bound ready message')
    }
    const runtimeFrame = page.frames().find((frame) => frame.url() === runtimeUrl)
    if (!runtimeFrame) throw new Error('Interactive runtime iframe was not created')
    const templateFrame = page.frames().find((frame) => frame.name() === 'ppt-template-document' && frame.url().startsWith('data:text/html;base64,'))
    if (!templateFrame) throw new Error('Interactive template data document was not created')

    const supervisorAudit = await runtimeFrame.evaluate(() => {
      const frame = document.getElementById('ppt-template-document') as HTMLIFrameElement | null
      const forbiddenAttributes = [...document.querySelectorAll('*')].filter((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'target', 'action', 'formaction', 'download', 'ping', 'style'].includes(attribute.name.toLowerCase())))
      const unexpectedScripts = [...document.scripts].filter((script) => script.dataset.pptTemplateRuntime !== 'supervisor')
      const untrustedNonces = [...document.querySelectorAll('script,style')].filter((element) => !(element as HTMLScriptElement | HTMLStyleElement).nonce)
      const exactFrame = frame !== null
        && document.querySelectorAll('iframe').length === 1
        && frame.name === 'ppt-template-document'
        && frame.getAttribute('sandbox') === 'allow-scripts'
        && frame.getAttribute('src')?.startsWith('data:text/html;base64,') === true
      return {
        forbiddenDomNodeCount: document.querySelectorAll('frame, object, embed, form, base, meta[http-equiv], link').length
          + forbiddenAttributes.length + unexpectedScripts.length + untrustedNonces.length + (exactFrame ? 0 : 1),
        innerIframeSandbox: frame?.getAttribute('sandbox') ?? null,
      }
    })
    const domAudit = await templateFrame.evaluate(() => {
      let cookieAccessBlocked = false
      let documentCookiePresent = false
      try { documentCookiePresent = document.cookie.length > 0 } catch { cookieAccessBlocked = true }
      const blocked = (read: () => unknown) => { try { read(); return false } catch { return true } }
      const forbiddenSelectors = 'iframe, frame, object, embed, form, base, meta[http-equiv], link'
      const forbiddenAttributes = [...document.querySelectorAll('*')].filter((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'target', 'action', 'formaction', 'download', 'ping', 'style'].includes(attribute.name.toLowerCase())))
      const unexpectedScripts = [...document.scripts].filter((script) => !script.hasAttribute('data-ppt-template-runtime') && !script.hasAttribute('data-ppt-template-script'))
      const untrustedNonces = [...document.querySelectorAll('script,style')].filter((element) => !(element as HTMLScriptElement | HTMLStyleElement).nonce)
      return {
        opaqueOrigin: location.origin === 'null',
        cookieAccessBlocked,
        documentCookiePresent,
        localStorageAccessBlocked: blocked(() => localStorage.length),
        sessionStorageAccessBlocked: blocked(() => sessionStorage.length),
        parentDomAccessBlocked: blocked(() => parent.document.body),
        topLocationAccessBlocked: blocked(() => top?.location.href),
        forbiddenDomNodeCount: document.querySelectorAll(forbiddenSelectors).length + forbiddenAttributes.length + unexpectedScripts.length + untrustedNonces.length,
      }
    })
    const iframeSandbox = await page.locator('#ppt-runtime-frame').getAttribute('sandbox')
    const initialSecurityEventCount = blockedSecurityEventCount
    const initialNewWindowCount = newWindowCount

    const frameElement = page.locator('#ppt-runtime-frame')
    const previewPng = await frameElement.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', type: 'png' })
    const thumbnailPng = await captureElementThumbnail(page, frameElement)

    const sendCommand = (sessionId: string, type: string, sequence: number) => page.evaluate(({ sessionId: commandSession, type: commandType, sequence: commandSequence }) => {
      const frame = document.getElementById('ppt-runtime-frame') as HTMLIFrameElement | null
      frame?.contentWindow?.postMessage({ protocol: 'html-template-runtime/v1', type: commandType, sessionId: commandSession, sequence: commandSequence }, '*')
    }, { sessionId, type, sequence })
    await sendCommand('0'.repeat(32), TEMPLATE_RUNTIME_RESET, 1)
    await page.waitForTimeout(50)
    const forgedCommandRejected = await runtimeFrame.evaluate(() => !document.documentElement.dataset.pptRuntimeLastCommand)
    await sendCommand(runtime.sessionId, TEMPLATE_RUNTIME_RESET, 1)
    await runtimeFrame.waitForFunction(() => document.documentElement.dataset.pptRuntimeLastCommand === 'reset:1')
    await sendCommand(runtime.sessionId, TEMPLATE_RUNTIME_REPLAY, 1)
    await page.waitForTimeout(50)
    const duplicateRejected = await runtimeFrame.evaluate(() => document.documentElement.dataset.pptRuntimeLastCommand === 'reset:1')
    await sendCommand(runtime.sessionId, TEMPLATE_RUNTIME_REPLAY, 2)
    await runtimeFrame.waitForFunction(() => document.documentElement.dataset.pptRuntimeLastCommand === 'replay:2')
    await templateFrame.waitForFunction(() => document.documentElement.dataset.pptRuntimeLastCommand === 'replay:2')
    const commandProtocolBeforeNavigation = duplicateRejected
      && await runtimeFrame.evaluate(() => document.documentElement.dataset.pptRuntimeLastCommand === 'replay:2')

    const activeAudit = await templateFrame.evaluate(async ({ auditUrl }) => {
      const popupAccessBlocked = window.open('about:blank') === null
      let topNavigationAttemptThrew = false
      try { top!.location.href = 'about:blank' } catch { topNavigationAttemptThrew = true }
      let parentNavigationAttemptThrew = false
      try { parent.location.href = 'about:blank' } catch { parentNavigationAttemptThrew = true }
      let networkAccessBlocked = false
      try { await fetch(auditUrl) } catch { networkAccessBlocked = true }
      return { popupAccessBlocked, topNavigationAttemptThrew, parentNavigationAttemptThrew, networkAccessBlocked }
    }, { auditUrl: networkAuditUrl })
    await page.waitForTimeout(100)
    const topNavigationBlocked = page.url() === harnessUrl
    if (!topNavigationBlocked) throw new Error('Interactive runtime escaped its iframe navigation sandbox')
    if (runtimeFrame.url() !== runtimeUrl) throw new Error('Interactive template navigated its runtime supervisor')
    if (networkAuditHitCount !== 0 || unexpectedAuditHitCount !== 0) throw new Error('Interactive template network audit reached its unrestricted loopback listener')

    await templateFrame.evaluate((auditUrl) => {
      setTimeout(() => { location.href = auditUrl }, 0)
    }, selfNavigationAuditUrl)
    await runtimeFrame.waitForFunction(() => document.documentElement.dataset.pptRuntimeNavigationBlocked === 'true')
    await page.waitForFunction(() => {
      const message = (window as unknown as { __pptRuntimeMessage?: { data?: { type?: string; code?: string } } }).__pptRuntimeMessage
      return message?.data?.type === 'error' && message.data.code === 'navigation-blocked'
    })
    await page.waitForTimeout(100)
    if (selfNavigationAuditHitCount !== 0 || unexpectedAuditHitCount !== 0) throw new Error('Interactive template self-navigation reached its unrestricted loopback listener')
    const navigationMessage = await page.evaluate(() => (window as unknown as { __pptRuntimeMessage: unknown }).__pptRuntimeMessage)
    const navigationErrorBound = isBoundRuntimeWindowMessage(navigationMessage)
      && navigationMessage.data.type === 'error'
      && navigationMessage.data.code === 'navigation-blocked'
      && navigationMessage.data.sessionId === runtime.sessionId
      && navigationMessage.data.assetId === runtime.assetId
      && navigationMessage.data.version === runtime.version

    await sendCommand('0'.repeat(32), TEMPLATE_RUNTIME_RESET, 3)
    await page.waitForTimeout(50)
    const postNavigationForgeryRejected = await runtimeFrame.evaluate(() => document.documentElement.dataset.pptRuntimeLastCommand === 'replay:2')
    await sendCommand(runtime.sessionId, TEMPLATE_RUNTIME_RESET, 3)
    await runtimeFrame.waitForFunction(() => document.documentElement.dataset.pptRuntimeLastCommand === 'reset:3')
    const runtimeContextBound = navigationErrorBound
      && postNavigationForgeryRejected
      && runtimeFrame.url() === runtimeUrl
      && page.url() === harnessUrl
    if (blockedRequests.length !== 0) throw new Error('Interactive preview relied on request interception to enforce its runtime boundary')

    const diagnostic = {
      allowedRequestCount,
      blockedRequestCount: blockedRequests.length,
      blockedSecurityEventCount: initialSecurityEventCount,
      cookieHeaderCount,
      contextCookieCount: initialCookies.length,
      documentCookiePresent: domAudit.documentCookiePresent,
      forbiddenDomNodeCount: supervisorAudit.forbiddenDomNodeCount + domAudit.forbiddenDomNodeCount,
      newWindowCount,
      runtimeOpaqueOrigin: runtimeMessage.origin === 'null',
      templateOpaqueOrigin: domAudit.opaqueOrigin,
      cookieAccessBlocked: domAudit.cookieAccessBlocked,
      localStorageAccessBlocked: domAudit.localStorageAccessBlocked,
      sessionStorageAccessBlocked: domAudit.sessionStorageAccessBlocked,
      parentDomAccessBlocked: domAudit.parentDomAccessBlocked,
      topLocationAccessBlocked: domAudit.topLocationAccessBlocked,
      popupAccessBlocked: activeAudit.popupAccessBlocked && newWindowCount === initialNewWindowCount,
      topNavigationBlocked: topNavigationBlocked
        && (activeAudit.topNavigationAttemptThrew || page.url() === harnessUrl)
        && (activeAudit.parentNavigationAttemptThrew || runtimeFrame.url() === runtimeUrl),
      networkAccessBlocked: activeAudit.networkAccessBlocked && networkAuditHitCount === 0,
      networkAuditHitCount,
      selfNavigationAuditHitCount,
      selfNavigationBlocked: selfNavigationAuditHitCount === 0
        && await runtimeFrame.evaluate(() => document.documentElement.dataset.pptRuntimeNavigationBlocked === 'true'),
      runtimeContextBound,
      commandProtocolBound: commandProtocolBeforeNavigation && runtimeContextBound,
      forgedCommandRejected: forgedCommandRejected && postNavigationForgeryRejected,
      allowScriptsOnlySandbox: iframeSandbox === 'allow-scripts' && supervisorAudit.innerIframeSandbox === 'allow-scripts',
    } as const
    const rendererVersion = `p02-chromium-v2:scaled-v2:${browser.version()}`
    await context.close()
    return { previewPng, thumbnailPng, rendererVersion, diagnostic }
  } finally {
    if (browser) await browser.close()
    if (server.listening) await close(server)
    if (auditServer.listening) await close(auditServer)
  }
}
