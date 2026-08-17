import { createHash } from 'node:crypto'
import {
  TEMPLATE_PACKAGE_CONTRACT_VERSION,
  TEMPLATE_STATIC_RUNTIME_CSP,
  type TemplatePackageSource,
} from '@slide-maker/shared'
import { assertSafePreviewPackage, PreviewPolicyError } from '../previews/secure-preview.js'
import { serializeTemplatePackage } from './simulated-adapter.js'

const LINK = /<link\b[^>]*>/gi
const HREF = /\bhref\s*=\s*(["'])([^"']+)\1/i
const REL = /\brel\s*=\s*(["'])stylesheet\1/i

export type CompiledStaticTemplateRuntime = Readonly<{
  mode: 'sandboxed-static'
  html: Buffer
  contentSecurityPolicy: typeof TEMPLATE_STATIC_RUNTIME_CSP
}>

export class StaticTemplateRuntimeError extends Error {}

function injectPolicy(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${TEMPLATE_STATIC_RUNTIME_CSP}">`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`)
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${policy}</head>`)
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`
}

export function compileStaticTemplateRuntime(
  source: TemplatePackageSource,
  expected: { sourceDigest: string; assetId: string; version: number },
): CompiledStaticTemplateRuntime {
  try { assertSafePreviewPackage(source) }
  catch (error) {
    if (error instanceof PreviewPolicyError) throw new StaticTemplateRuntimeError(error.message)
    throw error
  }
  if (source.manifest.contractVersion !== TEMPLATE_PACKAGE_CONTRACT_VERSION
    || source.manifest.id !== expected.assetId
    || source.manifest.version !== expected.version) throw new StaticTemplateRuntimeError('Static runtime package identity is invalid')
  const digest = createHash('sha256').update(serializeTemplatePackage(source)).digest('hex')
  if (digest !== expected.sourceDigest) throw new StaticTemplateRuntimeError('Static runtime package digest is invalid')

  let html = source.files[source.manifest.entry]
  html = html.replace(LINK, (link) => {
    const href = HREF.exec(link)?.[2]
    if (!href || !REL.test(link) || !href.endsWith('.css') || typeof source.files[href] !== 'string') {
      throw new StaticTemplateRuntimeError('Static runtime accepts only declared stylesheet links')
    }
    const css = source.files[href]
    if (/<\/style/i.test(css)) throw new StaticTemplateRuntimeError('Static runtime stylesheet contains an unsafe terminator')
    return `<style data-template-stylesheet="${href}">${css}</style>`
  })
  if (/<link\b/i.test(html)) throw new StaticTemplateRuntimeError('Static runtime contains an unresolved link')
  return { mode: 'sandboxed-static', html: Buffer.from(injectPolicy(html), 'utf8'), contentSecurityPolicy: TEMPLATE_STATIC_RUNTIME_CSP }
}
