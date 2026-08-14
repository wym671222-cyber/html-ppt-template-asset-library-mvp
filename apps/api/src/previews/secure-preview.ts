import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { chromium } from '@playwright/test'
import {
  assertValidTemplatePackage,
  isInteractiveTemplatePackageManifest,
  type TemplatePackageSource,
} from '@slide-maker/shared'
import { compileInteractiveTemplateRuntime } from '../templates/interactive-template-runtime.js'
import { renderInteractiveSecurePreview } from './interactive-secure-preview.js'

const PREVIEW_CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; frame-ancestors 'none'"
const FORBIDDEN_HTML = /<(?:script|iframe|frame|object|embed|form|base)\b|<meta\b[^>]*\bhttp-equiv\s*=|\son[a-z][a-z0-9_-]*\s*=|\b(?:srcdoc|srcset|target|action|formaction|download|style)\s*=/i
const UNQUOTED_HTML_REFERENCE = /\b(?:src|href|poster)\s*=\s*(?!["'])/i
const HTML_REFERENCE = /\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi
const FORBIDDEN_CSS = /@import\b|\burl\s*\(/i
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/]+={0,2})$/i
const MAX_DATA_IMAGE_BYTES = 2 * 1024 * 1024

export type PreviewSecurityDiagnostic = Readonly<{
  allowedRequestCount: number
  blockedRequestCount: number
  blockedSecurityEventCount: number
  cookieHeaderCount: number
  contextCookieCount: number
  documentCookiePresent: boolean
  forbiddenDomNodeCount: number
  newWindowCount: number
  runtimeOpaqueOrigin?: boolean
  templateOpaqueOrigin?: boolean
  cookieAccessBlocked?: boolean
  localStorageAccessBlocked?: boolean
  sessionStorageAccessBlocked?: boolean
  parentDomAccessBlocked?: boolean
  topLocationAccessBlocked?: boolean
  popupAccessBlocked?: boolean
  topNavigationBlocked?: boolean
  networkAccessBlocked?: boolean
  networkAuditHitCount?: number
  selfNavigationAuditHitCount?: number
  selfNavigationBlocked?: boolean
  runtimeContextBound?: boolean
  commandProtocolBound?: boolean
  forgedCommandRejected?: boolean
  allowScriptsOnlySandbox?: boolean
}>

export type SecurePreviewRender = Readonly<{
  previewPng: Buffer
  thumbnailPng: Buffer
  rendererVersion: string
  diagnostic: PreviewSecurityDiagnostic
}>

export type SecurePreviewRendererOptions = Readonly<{
  chromiumExecutablePath?: string
  temporaryRoot?: string
  navigationTimeoutMs?: number
}>

export class PreviewPolicyError extends Error {}

function safePackagePath(packageRoot: string, file: string): string {
  const path = resolve(packageRoot, file)
  const fromRoot = relative(packageRoot, path)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) throw new PreviewPolicyError(`Package path escapes preview root: ${file}`)
  return path
}

function assertDataImage(value: string): void {
  const match = DATA_IMAGE.exec(value)
  if (!match) throw new PreviewPolicyError('Preview data URL must be a base64 PNG, JPEG, WebP or GIF image')
  const encoded = match[2]
  const content = Buffer.from(encoded, 'base64')
  if (content.byteLength === 0 || content.byteLength > MAX_DATA_IMAGE_BYTES || content.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new PreviewPolicyError('Preview data image is malformed or too large')
  const kind = match[1].toLowerCase()
  const signature = content.subarray(0, 12).toString('hex')
  const valid = kind === 'png' ? signature.startsWith('89504e470d0a1a0a')
    : kind === 'jpeg' ? signature.startsWith('ffd8ff')
      : kind === 'gif' ? content.subarray(0, 6).toString('ascii') === 'GIF87a' || content.subarray(0, 6).toString('ascii') === 'GIF89a'
        : content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new PreviewPolicyError('Preview data image MIME type does not match its byte signature')
}

function assertDeclaredReference(reference: string, declaredFiles: ReadonlySet<string>, allowData: boolean): void {
  const value = reference.trim()
  if (!value || value.startsWith('#')) return
  if (value.toLowerCase().startsWith('data:')) {
    if (!allowData) throw new PreviewPolicyError('Preview data URLs are allowed only for images')
    assertDataImage(value)
    return
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0])
  } catch {
    throw new PreviewPolicyError(`Preview reference is not valid URI text: ${value}`)
  }
  if (decoded.startsWith('/') || decoded.split('/').includes('..') || !declaredFiles.has(decoded)) {
    throw new PreviewPolicyError(`Preview reference is not a declared package resource: ${value}`)
  }
}

export function assertSafePreviewPackage(source: TemplatePackageSource): void {
  try {
    assertValidTemplatePackage(source)
  } catch (error) {
    throw new PreviewPolicyError(error instanceof Error ? error.message : 'Stored template package is invalid')
  }

  const declaredFiles = new Set(source.manifest.files)
  const actualFiles = Object.keys(source.files)
  if (actualFiles.length !== declaredFiles.size || actualFiles.some((file) => !declaredFiles.has(file))) {
    throw new PreviewPolicyError('Stored template package contains an undeclared resource')
  }

  for (const file of source.manifest.files) {
    if (!/\.(?:html|css)$/.test(file)) throw new PreviewPolicyError(`Preview accepts only HTML and CSS resources: ${file}`)
    const content = source.files[file]
    if (typeof content !== 'string') throw new PreviewPolicyError(`Preview resource is not text: ${file}`)
    if (file.endsWith('.css')) {
      if (FORBIDDEN_CSS.test(content)) throw new PreviewPolicyError(`Preview CSS cannot import or fetch resources: ${file}`)
      continue
    }
    if (FORBIDDEN_HTML.test(content)) throw new PreviewPolicyError(`Preview HTML contains an active or navigational element: ${file}`)
    if (UNQUOTED_HTML_REFERENCE.test(content)) throw new PreviewPolicyError(`Preview HTML references must be quoted: ${file}`)
    for (const match of content.matchAll(HTML_REFERENCE)) assertDeclaredReference(match[3], declaredFiles, match[1].toLowerCase() !== 'href')
  }
}

export function isAllowedPreviewRequest(requestUrl: string, method: string, previewOrigin: string, allowedPaths: ReadonlySet<string>): boolean {
  if (method !== 'GET') return false
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return false
  }
  return url.protocol === 'http:' && url.origin === previewOrigin && !url.username && !url.password && !url.search && allowedPaths.has(url.pathname)
}

function contentType(file: string): string {
  return file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') return reject(new Error('Preview server did not bind an IPv4 loopback TCP port'))
      resolveListening(address.port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
}

export class SecurePreviewRenderer {
  constructor(private readonly options: SecurePreviewRendererOptions = {}) {}

  async render(source: TemplatePackageSource): Promise<SecurePreviewRender> {
    if (isInteractiveTemplatePackageManifest(source.manifest)) {
      try {
        return await renderInteractiveSecurePreview(compileInteractiveTemplateRuntime(source), this.options)
      } catch (error) {
        if (error instanceof PreviewPolicyError) throw error
        if (error instanceof Error && /Interactive (?:template|runtime)/.test(error.message)) throw new PreviewPolicyError(error.message)
        throw error
      }
    }
    assertSafePreviewPackage(source)
    const temporaryRoot = resolve(this.options.temporaryRoot ?? tmpdir())
    if (lstatSync(temporaryRoot).isSymbolicLink()) throw new PreviewPolicyError('Preview temporary root must not be a symbolic link')
    const workspace = mkdtempSync(join(temporaryRoot, 'asset-library-p05-preview-'))
    const packageRoot = join(workspace, 'package')
    mkdirSync(packageRoot, { mode: 0o700 })

    const token = randomUUID()
    const allowedFiles = new Set(source.manifest.files)
    for (const file of source.manifest.files) {
      const destination = safePackagePath(packageRoot, file)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      writeFileSync(destination, source.files[file], { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    }

    let cookieHeaderCount = 0
    const server = createServer((request, response) => {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      let url: URL
      try {
        url = new URL(request.url ?? '/', origin)
      } catch {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end()
        return
      }
      const prefix = `/${token}/`
      let file = ''
      try {
        file = decodeURIComponent(url.pathname.slice(prefix.length))
      } catch {
        response.writeHead(400).end()
        return
      }
      if (request.headers.cookie) cookieHeaderCount += 1
      if (request.headers.host !== origin.slice('http://'.length) || request.method !== 'GET' || !url.pathname.startsWith(prefix) || !allowedFiles.has(file)) {
        response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
        return
      }
      const path = safePackagePath(packageRoot, file)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': PREVIEW_CSP,
        'Content-Type': contentType(file),
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(readFileSync(path))
    })

    let browser
    try {
      const port = await listen(server)
      const previewOrigin = `http://127.0.0.1:${port}`
      const allowedPaths = new Set([...allowedFiles].map((file) => `/${token}/${file}`))
      const entryUrl = `${previewOrigin}/${token}/${source.manifest.entry}`
      browser = await chromium.launch({
        executablePath: this.options.chromiumExecutablePath,
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
        javaScriptEnabled: false,
        locale: 'en-US',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        storageState: { cookies: [], origins: [] },
        timezoneId: 'UTC',
        viewport: { width: 1280, height: 720 },
      })
      context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs ?? 15_000)
      const initialCookies = await context.cookies()
      if (initialCookies.length > 0) throw new PreviewPolicyError('Chromium preview context did not start with empty cookie state')
      let allowedRequestCount = 0
      const blockedRequests: string[] = []
      await context.route('**/*', async (route) => {
        const request = route.request()
        if (isAllowedPreviewRequest(request.url(), request.method(), previewOrigin, allowedPaths)) {
          allowedRequestCount += 1
          await route.continue()
        } else {
          blockedRequests.push(request.url())
          await route.abort('blockedbyclient')
        }
      })

      const page = await context.newPage()
      let newWindowCount = 0
      let blockedSecurityEventCount = 0
      page.on('console', (message) => {
        if (/Content Security Policy|Refused to load/i.test(message.text())) blockedSecurityEventCount += 1
      })
      page.on('popup', (popup) => {
        newWindowCount += 1
        void popup.close()
      })
      await page.goto(entryUrl, { waitUntil: 'networkidle' })
      const domAudit = await page.evaluate(() => {
        const forbiddenSelectors = 'script, iframe, frame, object, embed, form, base, meta[http-equiv]'
        const forbiddenAttributes = [...document.querySelectorAll('*')].filter((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name) || ['srcdoc', 'target', 'action', 'formaction'].includes(attribute.name.toLowerCase())))
        return {
          documentCookiePresent: document.cookie.length > 0,
          forbiddenDomNodeCount: document.querySelectorAll(forbiddenSelectors).length + forbiddenAttributes.length,
        }
      })
      const diagnostic: PreviewSecurityDiagnostic = {
        allowedRequestCount,
        blockedRequestCount: blockedRequests.length,
        blockedSecurityEventCount,
        cookieHeaderCount,
        contextCookieCount: initialCookies.length,
        documentCookiePresent: domAudit.documentCookiePresent,
        forbiddenDomNodeCount: domAudit.forbiddenDomNodeCount,
        newWindowCount,
      }
      if (blockedRequests.length > 0) throw new PreviewPolicyError('Chromium blocked a request outside the controlled preview allowlist')
      if (blockedSecurityEventCount > 0) throw new PreviewPolicyError('Chromium CSP blocked an active or external resource request')
      if (cookieHeaderCount > 0 || initialCookies.length > 0 || domAudit.documentCookiePresent) throw new PreviewPolicyError('Chromium preview context contained host cookie state')
      if (domAudit.forbiddenDomNodeCount > 0) throw new PreviewPolicyError('Chromium preview DOM contains a forbidden active element')
      if (newWindowCount > 0) throw new PreviewPolicyError('Chromium preview attempted to open a new window')

      const previewPng = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', type: 'png' })
      await page.setViewportSize({ width: 320, height: 180 })
      const thumbnailPng = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', type: 'png' })
      const rendererVersion = `p05-chromium-v1:${browser.version()}`
      await context.close()
      return { previewPng, thumbnailPng, rendererVersion, diagnostic }
    } finally {
      if (browser) await browser.close()
      if (server.listening) await close(server)
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}
