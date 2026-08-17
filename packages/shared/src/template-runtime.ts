export const TEMPLATE_RUNTIME_PROTOCOL = 'html-template-runtime/v1' as const
export const TEMPLATE_RUNTIME_READY = 'ready' as const
export const TEMPLATE_RUNTIME_ERROR = 'error' as const
export const TEMPLATE_RUNTIME_REPLAY = 'replay' as const
export const TEMPLATE_RUNTIME_RESET = 'reset' as const

export const TEMPLATE_RUNTIME_PROTOCOL_HEADER = 'X-PPT-Template-Runtime-Protocol'
export const TEMPLATE_RUNTIME_SESSION_HEADER = 'X-PPT-Template-Runtime-Session'
export const TEMPLATE_RUNTIME_MODE_HEADER = 'X-PPT-Template-Runtime-Mode'
export const TEMPLATE_RUNTIME_REPLAY_EVENT = 'html-template:replay'
export const TEMPLATE_RUNTIME_RESET_EVENT = 'html-template:reset'

export const TEMPLATE_RUNTIME_PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'clipboard-read=()',
  'clipboard-write=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=()',
  'gamepad=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'speaker-selection=()',
  'storage-access=()',
  'usb=()',
  'web-share=()',
  'window-management=()',
  'xr-spatial-tracking=()',
].join(', ')

export const TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Disposition': 'inline',
  'Content-Type': 'text/html; charset=utf-8',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': TEMPLATE_RUNTIME_PERMISSIONS_POLICY,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
})

export const TEMPLATE_STATIC_RUNTIME_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "style-src-attr 'none'",
  'img-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
  "frame-ancestors 'self'",
  'sandbox',
].join('; ')

const RUNTIME_NONCE = /^[A-Za-z0-9_-]{43}$/
const RUNTIME_SESSION = /^[0-9a-f]{32}$/
const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[0-9a-f]{64}$/

export type TemplateRuntimeReadyMessage = Readonly<{
  protocol: typeof TEMPLATE_RUNTIME_PROTOCOL
  type: typeof TEMPLATE_RUNTIME_READY
  sessionId: string
  assetId: string
  version: number
  sourceDigest: string
}>

export type TemplateRuntimeErrorMessage = Readonly<{
  protocol: typeof TEMPLATE_RUNTIME_PROTOCOL
  type: typeof TEMPLATE_RUNTIME_ERROR
  sessionId: string
  assetId: string
  version: number
  code: 'runtime-error' | 'unhandled-rejection' | 'navigation-blocked'
}>

export type TemplateRuntimeEventMessage = TemplateRuntimeReadyMessage | TemplateRuntimeErrorMessage

export type TemplateRuntimeCommand = Readonly<{
  protocol: typeof TEMPLATE_RUNTIME_PROTOCOL
  type: typeof TEMPLATE_RUNTIME_REPLAY | typeof TEMPLATE_RUNTIME_RESET
  sessionId: string
  sequence: number
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

export function isTemplateRuntimeSessionId(value: unknown): value is string {
  return typeof value === 'string' && RUNTIME_SESSION.test(value)
}

export function isTemplateRuntimeCommand(value: unknown): value is TemplateRuntimeCommand {
  return isRecord(value)
    && hasExactKeys(value, ['protocol', 'type', 'sessionId', 'sequence'])
    && value.protocol === TEMPLATE_RUNTIME_PROTOCOL
    && (value.type === TEMPLATE_RUNTIME_REPLAY || value.type === TEMPLATE_RUNTIME_RESET)
    && isTemplateRuntimeSessionId(value.sessionId)
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) >= 1
}

export function isTemplateRuntimeEventMessage(value: unknown): value is TemplateRuntimeEventMessage {
  if (!isRecord(value)
    || value.protocol !== TEMPLATE_RUNTIME_PROTOCOL
    || !isTemplateRuntimeSessionId(value.sessionId)
    || typeof value.assetId !== 'string'
    || !ASSET_ID.test(value.assetId)
    || !Number.isSafeInteger(value.version)
    || Number(value.version) < 1) return false
  if (value.type === TEMPLATE_RUNTIME_READY) {
    return hasExactKeys(value, ['protocol', 'type', 'sessionId', 'assetId', 'version', 'sourceDigest'])
      && typeof value.sourceDigest === 'string'
      && SHA256.test(value.sourceDigest)
  }
  return value.type === TEMPLATE_RUNTIME_ERROR
    && hasExactKeys(value, ['protocol', 'type', 'sessionId', 'assetId', 'version', 'code'])
    && (value.code === 'runtime-error' || value.code === 'unhandled-rejection' || value.code === 'navigation-blocked')
}

export function buildTemplateRuntimeCsp(nonce: string): string {
  if (!RUNTIME_NONCE.test(nonce)) throw new Error('Template runtime CSP nonce is invalid')
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    `style-src 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    'img-src data:',
    "connect-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    'frame-src data:',
    'child-src data:',
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "navigate-to 'none'",
    "frame-ancestors 'self'",
    'sandbox allow-scripts',
  ].join('; ')
}

export function templateRuntimeNonceFromCsp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^default-src 'none'; script-src 'nonce-([A-Za-z0-9_-]{43})'/.exec(value)
  if (!match) return null
  return buildTemplateRuntimeCsp(match[1]) === value ? match[1] : null
}
