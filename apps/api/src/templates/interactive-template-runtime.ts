import { createHash, randomBytes } from 'node:crypto'
import {
  buildTemplateRuntimeCsp,
  INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
  TEMPLATE_RUNTIME_ERROR,
  TEMPLATE_RUNTIME_PROTOCOL,
  TEMPLATE_RUNTIME_READY,
  TEMPLATE_RUNTIME_REPLAY,
  TEMPLATE_RUNTIME_REPLAY_EVENT,
  TEMPLATE_RUNTIME_RESET,
  TEMPLATE_RUNTIME_RESET_EVENT,
  type TemplatePackageSource,
} from '@slide-maker/shared'
import { isAllowlistedInteractiveTemplateDigest } from './interactive-template-allowlist.js'
import { assertSafeInteractiveTemplatePackage } from './interactive-template-policy.js'
import { serializeTemplatePackage } from './simulated-adapter.js'

const LINK_ELEMENT = /<link\b([^>]*)>/gi
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const HTML_REFERENCE = /\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi
const MODULE_SYNTAX = /(?:^|[;}\n\r])\s*(?:import|export)\b|\bimport\s*\(/m
const SAFE_RESOURCE = /^(?:[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)+$/

export class InteractiveTemplateRuntimeError extends Error {}

export type CompiledInteractiveTemplateRuntime = Readonly<{
  html: Buffer
  contentSecurityPolicy: string
  sessionId: string
  sourceDigest: string
  assetId: string
  version: number
}>

export type InteractiveTemplateRuntimeOptions = Readonly<{
  expectedSourceDigest?: string
  expectedAssetId?: string
  expectedVersion?: number
}>

type ParsedAttribute = { name: string; value: string | null }

function parseAttributes(fragment: string, element: string): Map<string, string | null> {
  const attributes = new Map<string, string | null>()
  let offset = 0
  while (offset < fragment.length) {
    while (/\s/.test(fragment[offset] ?? '')) offset += 1
    if (offset >= fragment.length || fragment.slice(offset).trim() === '/') break
    const match = /^([a-z][a-z0-9:_-]*)(?:\s*=\s*(["'])(.*?)\2)?/i.exec(fragment.slice(offset))
    if (!match) throw new InteractiveTemplateRuntimeError(`Interactive runtime ${element} attributes are invalid`)
    const attribute: ParsedAttribute = { name: match[1].toLowerCase(), value: match[2] ? match[3] : null }
    if (attributes.has(attribute.name)) throw new InteractiveTemplateRuntimeError(`Interactive runtime ${element} attribute is duplicated: ${attribute.name}`)
    attributes.set(attribute.name, attribute.value)
    offset += match[0].length
  }
  return attributes
}

function exactAttributeKeys(attributes: ReadonlyMap<string, string | null>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = [...attributes.keys()].sort()
  const allowed = new Set([...required, ...optional])
  return required.every((key) => attributes.has(key)) && keys.every((key) => allowed.has(key))
}

function declaredResource(reference: string, source: TemplatePackageSource, extension: '.css' | '.js'): string {
  if (reference.includes('?') || reference.includes('#')) throw new InteractiveTemplateRuntimeError('Interactive runtime resource references cannot contain query or fragment text')
  let decoded: string
  try { decoded = decodeURIComponent(reference) }
  catch { throw new InteractiveTemplateRuntimeError('Interactive runtime resource reference is not valid URI text') }
  if (!SAFE_RESOURCE.test(decoded) || !decoded.endsWith(extension) || !source.manifest.files.includes(decoded) || typeof source.files[decoded] !== 'string') {
    throw new InteractiveTemplateRuntimeError(`Interactive runtime ${extension} resource is not declared`)
  }
  return decoded
}

function safeJavascriptValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function extractRuntimeResources(source: TemplatePackageSource): { document: string; styles: string[]; scripts: string[] } {
  const entry = source.files[source.manifest.entry]
  if (typeof entry !== 'string' || !/<body\b/i.test(entry) || !/<\/body\s*>/i.test(entry)) {
    throw new InteractiveTemplateRuntimeError('Interactive runtime entry must be a complete HTML document with a body')
  }

  const styles: string[] = []
  let document = entry.replace(LINK_ELEMENT, (_element, fragment: string) => {
    const attributes = parseAttributes(fragment, 'link')
    if (!exactAttributeKeys(attributes, ['rel', 'href'], ['type'])
      || attributes.get('rel')?.toLowerCase() !== 'stylesheet'
      || (attributes.has('type') && attributes.get('type')?.toLowerCase() !== 'text/css')) {
      throw new InteractiveTemplateRuntimeError('Interactive runtime accepts only declared stylesheet link elements')
    }
    const resource = declaredResource(attributes.get('href') ?? '', source, '.css')
    styles.push(source.files[resource])
    return ''
  })

  const scripts: string[] = []
  document = document.replace(SCRIPT_ELEMENT, (_element, fragment: string, body: string) => {
    if (body.trim()) throw new InteractiveTemplateRuntimeError('Interactive runtime scripts must remain external package resources before compilation')
    const attributes = parseAttributes(fragment, 'script')
    const defer = attributes.get('defer')
    if (!exactAttributeKeys(attributes, ['src'], ['type', 'defer'])
      || (attributes.has('type') && !['text/javascript', 'application/javascript'].includes(attributes.get('type')?.toLowerCase() ?? ''))
      || (attributes.has('defer') && defer !== null && defer !== '' && defer !== 'defer')) {
      throw new InteractiveTemplateRuntimeError('Interactive runtime accepts only classic declared script elements')
    }
    const resource = declaredResource(attributes.get('src') ?? '', source, '.js')
    const content = source.files[resource]
    if (MODULE_SYNTAX.test(content)) throw new InteractiveTemplateRuntimeError('Interactive runtime JavaScript modules must be bundled into classic package scripts')
    scripts.push(content)
    return ''
  })

  if (/<(?:link|script)\b/i.test(document)) throw new InteractiveTemplateRuntimeError('Interactive runtime entry contains an unsupported link or script element')
  for (const match of document.matchAll(HTML_REFERENCE)) {
    const reference = match[3].trim()
    if (!reference || reference.startsWith('#')) continue
    if (match[1].toLowerCase() !== 'href' && reference.toLowerCase().startsWith('data:image/')) continue
    throw new InteractiveTemplateRuntimeError('Interactive runtime entry contains a non-self-contained resource reference')
  }
  return { document, styles, scripts }
}

function templateDocumentBootstrap(input: {
  nonce: string
  sessionId: string
  sourceDigest: string
  assetId: string
  version: number
  styles: readonly string[]
  scripts: readonly string[]
}): string {
  const identity = safeJavascriptValue({ assetId: input.assetId, version: input.version, sourceDigest: input.sourceDigest })
  return `<script nonce="${input.nonce}" data-ppt-template-runtime="bootstrap">
(() => {
  'use strict'
  const protocol = ${safeJavascriptValue(TEMPLATE_RUNTIME_PROTOCOL)}
  const sessionId = ${safeJavascriptValue(input.sessionId)}
  const identity = Object.freeze(${identity})
  const nonce = ${safeJavascriptValue(input.nonce)}
  const styles = ${safeJavascriptValue(input.styles)}
  const scripts = ${safeJavascriptValue(input.scripts)}
  let lastSequence = 0
  let failed = false
  let errorSent = false
  const send = (message) => {
    if (parent !== self) parent.postMessage(message, '*')
  }
  const reportError = (code) => {
    failed = true
    if (errorSent) return
    errorSent = true
    send({ protocol, type: ${safeJavascriptValue(TEMPLATE_RUNTIME_ERROR)}, sessionId, assetId: identity.assetId, version: identity.version, code })
  }
  addEventListener('error', () => reportError('runtime-error'), true)
  addEventListener('unhandledrejection', () => reportError('unhandled-rejection'), true)
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== 'null') return
    const command = event.data
    if (!command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).sort().join(',') !== 'protocol,sequence,sessionId,type'
      || command.protocol !== protocol || command.sessionId !== sessionId
      || (command.type !== ${safeJavascriptValue(TEMPLATE_RUNTIME_REPLAY)} && command.type !== ${safeJavascriptValue(TEMPLATE_RUNTIME_RESET)})
      || !Number.isSafeInteger(command.sequence) || command.sequence <= lastSequence) return
    lastSequence = command.sequence
    document.documentElement.dataset.pptRuntimeLastCommand = command.type + ':' + command.sequence
    const eventName = command.type === ${safeJavascriptValue(TEMPLATE_RUNTIME_REPLAY)}
      ? ${safeJavascriptValue(TEMPLATE_RUNTIME_REPLAY_EVENT)}
      : ${safeJavascriptValue(TEMPLATE_RUNTIME_RESET_EVENT)}
    document.dispatchEvent(new CustomEvent(eventName, { detail: Object.freeze({ sequence: command.sequence }) }))
    event.stopImmediatePropagation()
  }, true)
  for (const content of styles) {
    const style = document.createElement('style')
    style.nonce = nonce
    style.dataset.pptTemplateStyle = ''
    style.textContent = content
    document.head.append(style)
  }
  for (const content of scripts) {
    const script = document.createElement('script')
    script.nonce = nonce
    script.dataset.pptTemplateScript = ''
    script.textContent = content
    document.body.append(script)
  }
  queueMicrotask(() => {
    if (!failed) send({ protocol, type: ${safeJavascriptValue(TEMPLATE_RUNTIME_READY)}, sessionId, assetId: identity.assetId, version: identity.version, sourceDigest: identity.sourceDigest })
  })
})()
</script>`
}

function runtimeSupervisor(input: {
  nonce: string
  sessionId: string
  sourceDigest: string
  assetId: string
  version: number
  templateDocumentUrl: string
}): string {
  const identity = safeJavascriptValue({ assetId: input.assetId, version: input.version, sourceDigest: input.sourceDigest })
  return `<!doctype html><html><head><meta charset="utf-8"><style nonce="${input.nonce}" data-ppt-template-runtime="supervisor-style">
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100%;height:100%}
</style></head><body><iframe id="ppt-template-document" name="ppt-template-document" title="Interactive template document" sandbox="allow-scripts"></iframe>
<script nonce="${input.nonce}" data-ppt-template-runtime="supervisor">
(() => {
  'use strict'
  const protocol = ${safeJavascriptValue(TEMPLATE_RUNTIME_PROTOCOL)}
  const sessionId = ${safeJavascriptValue(input.sessionId)}
  const identity = Object.freeze(${identity})
  const templateDocumentUrl = ${safeJavascriptValue(input.templateDocumentUrl)}
  const templateFrame = document.getElementById('ppt-template-document')
  const ancestorOrigin = self.location.ancestorOrigins && self.location.ancestorOrigins.length > 0 ? self.location.ancestorOrigins[0] : ''
  let lastSequence = 0
  let readyReceived = false
  let navigationErrorSent = false
  const exactKeys = (value, keys) => Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  const send = (message) => {
    if (parent !== self) parent.postMessage(message, ancestorOrigin || '*')
  }
  const isBoundTemplateEvent = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.protocol !== protocol || message.sessionId !== sessionId
      || message.assetId !== identity.assetId || message.version !== identity.version) return false
    if (message.type === ${safeJavascriptValue(TEMPLATE_RUNTIME_READY)}) {
      return exactKeys(message, ['protocol', 'type', 'sessionId', 'assetId', 'version', 'sourceDigest'])
        && message.sourceDigest === identity.sourceDigest
    }
    return message.type === ${safeJavascriptValue(TEMPLATE_RUNTIME_ERROR)}
      && exactKeys(message, ['protocol', 'type', 'sessionId', 'assetId', 'version', 'code'])
      && (message.code === 'runtime-error' || message.code === 'unhandled-rejection')
  }
  const reportNavigationBlocked = () => {
    document.documentElement.dataset.pptRuntimeNavigationBlocked = 'true'
    if (navigationErrorSent) return
    navigationErrorSent = true
    send({ protocol, type: ${safeJavascriptValue(TEMPLATE_RUNTIME_ERROR)}, sessionId, assetId: identity.assetId, version: identity.version, code: 'navigation-blocked' })
  }
  addEventListener('message', (event) => {
    if (event.source === templateFrame.contentWindow && event.origin === 'null') {
      const message = event.data
      if (!isBoundTemplateEvent(message)) return
      if (message.type === ${safeJavascriptValue(TEMPLATE_RUNTIME_READY)}) {
        if (readyReceived) return
        readyReceived = true
      }
      send(message)
      event.stopImmediatePropagation()
      return
    }
    if (event.source !== parent || (ancestorOrigin && event.origin !== ancestorOrigin) || !readyReceived) return
    const command = event.data
    if (!command || typeof command !== 'object' || Array.isArray(command)
      || !exactKeys(command, ['protocol', 'type', 'sessionId', 'sequence'])
      || command.protocol !== protocol || command.sessionId !== sessionId
      || (command.type !== ${safeJavascriptValue(TEMPLATE_RUNTIME_REPLAY)} && command.type !== ${safeJavascriptValue(TEMPLATE_RUNTIME_RESET)})
      || !Number.isSafeInteger(command.sequence) || command.sequence <= lastSequence) return
    lastSequence = command.sequence
    document.documentElement.dataset.pptRuntimeLastCommand = command.type + ':' + command.sequence
    templateFrame.contentWindow.postMessage(command, '*')
    event.stopImmediatePropagation()
  }, true)
  addEventListener('securitypolicyviolation', (event) => {
    if (event.effectiveDirective === 'frame-src' || event.effectiveDirective === 'child-src') reportNavigationBlocked()
  }, true)
  templateFrame.src = templateDocumentUrl
})()
</script></body></html>`
}

export function compileInteractiveTemplateRuntime(
  source: TemplatePackageSource,
  options: InteractiveTemplateRuntimeOptions = {},
): CompiledInteractiveTemplateRuntime {
  try { assertSafeInteractiveTemplatePackage(source) }
  catch (error) { throw new InteractiveTemplateRuntimeError(error instanceof Error ? error.message : 'Interactive template package is unsafe') }
  if (source.manifest.contractVersion !== INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION) {
    throw new InteractiveTemplateRuntimeError('Interactive runtime requires html-template/v2')
  }

  const canonical = serializeTemplatePackage(source)
  const sourceDigest = createHash('sha256').update(canonical).digest('hex')
  if (!isAllowlistedInteractiveTemplateDigest(sourceDigest)) throw new InteractiveTemplateRuntimeError('Interactive runtime package digest is not allowlisted')
  if (options.expectedSourceDigest !== undefined && sourceDigest !== options.expectedSourceDigest) throw new InteractiveTemplateRuntimeError('Interactive runtime package digest does not match its immutable TemplateVersion')
  if (options.expectedAssetId !== undefined && source.manifest.id !== options.expectedAssetId) throw new InteractiveTemplateRuntimeError('Interactive runtime package asset identity does not match its immutable TemplateVersion')
  if (options.expectedVersion !== undefined && source.manifest.version !== options.expectedVersion) throw new InteractiveTemplateRuntimeError('Interactive runtime package version does not match its immutable TemplateVersion')

  const nonce = randomBytes(32).toString('base64url')
  const sessionId = randomBytes(16).toString('hex')
  const resources = extractRuntimeResources(source)
  const bootstrap = templateDocumentBootstrap({
    nonce,
    sessionId,
    sourceDigest,
    assetId: source.manifest.id,
    version: source.manifest.version,
    styles: resources.styles,
    scripts: resources.scripts,
  })
  const templateDocument = resources.document.replace(/<\/body\s*>/i, `${bootstrap}</body>`)
  const templateDocumentUrl = `data:text/html;base64,${Buffer.from(templateDocument, 'utf8').toString('base64')}`
  const html = runtimeSupervisor({
    nonce,
    sessionId,
    sourceDigest,
    assetId: source.manifest.id,
    version: source.manifest.version,
    templateDocumentUrl,
  })
  return {
    html: Buffer.from(html, 'utf8'),
    contentSecurityPolicy: buildTemplateRuntimeCsp(nonce),
    sessionId,
    sourceDigest,
    assetId: source.manifest.id,
    version: source.manifest.version,
  }
}
