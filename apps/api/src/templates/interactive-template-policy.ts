import {
  assertValidTemplatePackage,
  INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
  type TemplatePackageSource,
} from '@slide-maker/shared'

const HTML_REFERENCE = /(?:^|[\s:])(src|href|poster)\s*=\s*(["'])(.*?)\2/gi
const UNQUOTED_HTML_REFERENCE = /(?:^|[\s:])(?:src|href|poster)\s*=\s*(?!["'])/i
const FORBIDDEN_HTML = /<(?:style|iframe|frame|object|embed|form|base)\b|<meta\b[^>]*\bhttp-equiv\s*=|\son[a-z][a-z0-9_-]*\s*=|\b(?:srcdoc|srcset|target|action|formaction|download|ping|style)\s*=/i
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const CSS_IMPORT = /@import\b/i
const CSS_URL = /url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/]+={0,2})$/i
const DATA_IMAGE_IN_TEXT = /data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}/gi
const EXTERNAL_URL = /(?:https?|wss?|ftp|file):\/\/|(?:^|["'(\s])\/\/(?:[a-z0-9.-]+\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})/i
const JS_MODULE_REFERENCE = /\b(?:import|export)\s+(?:[^'";\r\n]*?\sfrom\s*)?(["'])([^"']+)\1/g
const JS_DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
const MAX_DATA_IMAGE_BYTES = 2 * 1024 * 1024

export class InteractiveTemplatePolicyError extends Error {}

function assertDataImage(value: string): void {
  const match = DATA_IMAGE.exec(value)
  if (!match) throw new InteractiveTemplatePolicyError('Interactive template data URL must be a base64 PNG, JPEG, WebP or GIF image')
  const encoded = match[2]
  const content = Buffer.from(encoded, 'base64')
  if (content.byteLength === 0
    || content.byteLength > MAX_DATA_IMAGE_BYTES
    || content.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new InteractiveTemplatePolicyError('Interactive template data image is malformed or too large')
  }
  const kind = match[1].toLowerCase()
  const signature = content.subarray(0, 12).toString('hex')
  const valid = kind === 'png' ? signature.startsWith('89504e470d0a1a0a')
    : kind === 'jpeg' ? signature.startsWith('ffd8ff')
      : kind === 'gif' ? ['GIF87a', 'GIF89a'].includes(content.subarray(0, 6).toString('ascii'))
        : content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new InteractiveTemplatePolicyError('Interactive template data image MIME type does not match its byte signature')
}

function assertDeclaredReference(reference: string, declaredFiles: ReadonlySet<string>, allowDataImage: boolean): void {
  const value = reference.trim()
  if (!value || value.startsWith('#')) return
  if (value.toLowerCase().startsWith('data:')) {
    if (!allowDataImage) throw new InteractiveTemplatePolicyError('Interactive template data URLs are allowed only for images')
    assertDataImage(value)
    return
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0])
  } catch {
    throw new InteractiveTemplatePolicyError(`Interactive template reference is not valid URI text: ${value}`)
  }
  if (decoded.startsWith('/') || decoded.split('/').includes('..') || !declaredFiles.has(decoded)) {
    throw new InteractiveTemplatePolicyError(`Interactive template reference is not a declared package resource: ${value}`)
  }
}

function assertHtml(file: string, content: string, declaredFiles: ReadonlySet<string>): void {
  if (FORBIDDEN_HTML.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template HTML contains a forbidden active or navigational element: ${file}`)
  if (EXTERNAL_URL.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template HTML contains an external URL: ${file}`)
  if (UNQUOTED_HTML_REFERENCE.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template HTML references must be quoted: ${file}`)
  for (const match of content.matchAll(HTML_REFERENCE)) {
    assertDeclaredReference(match[3], declaredFiles, match[1].toLowerCase() !== 'href')
  }
  let scriptCount = 0
  for (const match of content.matchAll(SCRIPT_BLOCK)) {
    scriptCount += 1
    if (match[2].trim()) throw new InteractiveTemplatePolicyError(`Interactive template scripts must be declared external package files: ${file}`)
    const source = /(?:^|\s)src\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2]
    if (!source || !source.split(/[?#]/, 1)[0].endsWith('.js')) throw new InteractiveTemplatePolicyError(`Interactive template script src must reference a declared JavaScript file: ${file}`)
    assertDeclaredReference(source, declaredFiles, false)
  }
  const openingScripts = content.match(/<script\b/gi)?.length ?? 0
  if (openingScripts !== scriptCount) throw new InteractiveTemplatePolicyError(`Interactive template contains a malformed or unclosed script element: ${file}`)
}

function assertCss(file: string, content: string): void {
  if (CSS_IMPORT.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template CSS cannot import resources: ${file}`)
  if (EXTERNAL_URL.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template CSS contains an external URL: ${file}`)
  for (const match of content.matchAll(CSS_URL)) {
    const value = (match[2] ?? match[3] ?? '').trim()
    assertDataImage(value)
  }
}

function assertJavascript(file: string, content: string, declaredFiles: ReadonlySet<string>): void {
  if (EXTERNAL_URL.test(content)) throw new InteractiveTemplatePolicyError(`Interactive template JavaScript contains an external URL: ${file}`)
  for (const matcher of [JS_MODULE_REFERENCE, JS_DYNAMIC_IMPORT]) {
    for (const match of content.matchAll(matcher)) {
      const reference = match[2]
      if (!reference.split(/[?#]/, 1)[0].endsWith('.js')) throw new InteractiveTemplatePolicyError(`Interactive template JavaScript modules must reference declared JavaScript files: ${file}`)
      assertDeclaredReference(reference, declaredFiles, false)
    }
  }
  const withoutDataImages = content.replace(DATA_IMAGE_IN_TEXT, (value) => {
    assertDataImage(value)
    return ''
  })
  if (/\bdata:/i.test(withoutDataImages)) throw new InteractiveTemplatePolicyError(`Interactive template JavaScript contains an unsupported data URL: ${file}`)
}

export function assertSafeInteractiveTemplatePackage(source: TemplatePackageSource): void {
  try {
    assertValidTemplatePackage(source)
  } catch (error) {
    throw new InteractiveTemplatePolicyError(error instanceof Error ? error.message : 'Interactive template package is invalid')
  }
  if (source.manifest.contractVersion !== INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION) {
    throw new InteractiveTemplatePolicyError('Interactive template policy requires html-template/v2')
  }

  const declaredFiles = new Set(source.manifest.files)
  const actualFiles = Object.keys(source.files)
  if (actualFiles.length !== declaredFiles.size || actualFiles.some((file) => !declaredFiles.has(file))) {
    throw new InteractiveTemplatePolicyError('Interactive template package contains an undeclared resource')
  }

  for (const file of source.manifest.files) {
    if (!/\.(?:html|css|js)$/.test(file)) throw new InteractiveTemplatePolicyError(`Interactive templates accept only HTML, CSS and JavaScript resources: ${file}`)
    const content = source.files[file]
    if (typeof content !== 'string' || content.includes('\u0000')) throw new InteractiveTemplatePolicyError(`Interactive template resource is not valid UTF-8 text: ${file}`)
    if (file.endsWith('.html')) assertHtml(file, content, declaredFiles)
    else if (file.endsWith('.css')) assertCss(file, content)
    else assertJavascript(file, content, declaredFiles)
  }
}
