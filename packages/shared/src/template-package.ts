export const TEMPLATE_PACKAGE_CONTRACT_VERSION = 'html-template/v1' as const

export type TemplateSlotType = 'text' | 'color'

export interface TemplateSlotDefinition {
  id: string
  type: TemplateSlotType
  required: boolean
  maxLength?: number
  default?: string
}

export interface TemplatePackageManifest {
  contractVersion: typeof TEMPLATE_PACKAGE_CONTRACT_VERSION
  id: string
  version: number
  title: string
  summary: string
  category: string
  tags: string[]
  entry: string
  files: string[]
  slots: TemplateSlotDefinition[]
}

export interface TemplatePackageSource {
  manifest: TemplatePackageManifest
  files: Readonly<Record<string, string>>
}

export interface TemplatePackageValidationError {
  field: string
  message: string
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const SAFE_CATEGORY = /^[a-z0-9][a-z0-9/_-]{0,63}$/
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]*$/
const SAFE_PACKAGE_FILE = /^(?:[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSafePackageFile(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PACKAGE_FILE.test(value) && !value.includes('..')
}

function validateSlot(slot: unknown, index: number): TemplatePackageValidationError[] {
  if (!isRecord(slot)) return [{ field: `slots[${index}]`, message: 'slot must be an object' }]
  const errors: TemplatePackageValidationError[] = []
  if (typeof slot.id !== 'string' || !SAFE_ID.test(slot.id)) {
    errors.push({ field: `slots[${index}].id`, message: 'slot id must be a lowercase kebab-case identifier' })
  }
  if (slot.type !== 'text' && slot.type !== 'color') {
    errors.push({ field: `slots[${index}].type`, message: 'slot type must be text or color' })
  }
  if (typeof slot.required !== 'boolean') {
    errors.push({ field: `slots[${index}].required`, message: 'required must be boolean' })
  }
  if (slot.maxLength !== undefined && (!Number.isInteger(slot.maxLength) || Number(slot.maxLength) < 1 || Number(slot.maxLength) > 2000)) {
    errors.push({ field: `slots[${index}].maxLength`, message: 'maxLength must be an integer from 1 to 2000' })
  }
  if (slot.default !== undefined && (typeof slot.default !== 'string' || !SAFE_TEXT.test(slot.default))) {
    errors.push({ field: `slots[${index}].default`, message: 'default must be plain text' })
  }
  return errors
}

export function validateTemplatePackage(source: TemplatePackageSource): TemplatePackageValidationError[] {
  const { manifest, files } = source
  const errors: TemplatePackageValidationError[] = []
  if (manifest.contractVersion !== TEMPLATE_PACKAGE_CONTRACT_VERSION) errors.push({ field: 'contractVersion', message: `must be ${TEMPLATE_PACKAGE_CONTRACT_VERSION}` })
  if (!SAFE_ID.test(manifest.id)) errors.push({ field: 'id', message: 'must be a lowercase kebab-case identifier' })
  if (!Number.isInteger(manifest.version) || manifest.version < 1) errors.push({ field: 'version', message: 'must be a positive integer' })
  for (const field of ['title', 'summary'] as const) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim() || !SAFE_TEXT.test(manifest[field])) errors.push({ field, message: 'must be non-empty plain text' })
  }
  if (typeof manifest.category !== 'string' || !SAFE_CATEGORY.test(manifest.category)) errors.push({ field: 'category', message: 'must be a safe category path' })
  if (!Array.isArray(manifest.tags) || manifest.tags.some((tag) => typeof tag !== 'string' || !SAFE_ID.test(tag))) errors.push({ field: 'tags', message: 'must contain only lowercase kebab-case identifiers' })
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || new Set(manifest.files).size !== manifest.files.length) errors.push({ field: 'files', message: 'must be a non-empty list of unique files' })
  for (const file of manifest.files ?? []) if (!isSafePackageFile(file)) errors.push({ field: 'files', message: `unsafe package path: ${String(file)}` })
  if (!isSafePackageFile(manifest.entry) || manifest.entry !== 'index.html') errors.push({ field: 'entry', message: 'must be the package-local index.html' })
  if (!manifest.files?.includes(manifest.entry)) errors.push({ field: 'entry', message: 'must be listed in files' })
  for (const slot of manifest.slots ?? []) errors.push(...validateSlot(slot, manifest.slots.indexOf(slot)))
  const slotIds = new Set((manifest.slots ?? []).map((slot) => slot.id))
  if (slotIds.size !== (manifest.slots ?? []).length) errors.push({ field: 'slots', message: 'slot ids must be unique' })
  for (const file of manifest.files ?? []) {
    if (!(file in files)) errors.push({ field: `files.${file}`, message: 'declared file is missing from package input' })
  }
  const entry = files[manifest.entry]
  if (typeof entry === 'string') {
    for (const match of entry.matchAll(/data-template-slot=["']([^"']+)["']/g)) {
      if (!slotIds.has(match[1])) errors.push({ field: 'entry', message: `unknown slot binding: ${match[1]}` })
    }
    if (/<script\b/i.test(entry) || /(?:src|href)=["'](?:https?:|\/\/|file:)/i.test(entry)) errors.push({ field: 'entry', message: 'simulated v1 packages cannot contain scripts or external URLs' })
  }
  return errors
}

export function assertValidTemplatePackage(source: TemplatePackageSource): void {
  const errors = validateTemplatePackage(source)
  if (errors.length > 0) throw new Error(`Invalid template package: ${errors.map((error) => `${error.field}: ${error.message}`).join('; ')}`)
}
