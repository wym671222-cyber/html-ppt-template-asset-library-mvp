import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  assertValidTemplatePackage,
  isInteractiveTemplatePackageManifest,
  type TemplatePackageManifest,
  type TemplatePackageSource,
} from '@slide-maker/shared'

export type SimulatedTemplateVersion = {
  id: string
  assetId: string
  versionNumber: number
  contractVersion: string
  sourceDigest: string
  contentObjectDigest: null
  slotSchema: { slots: TemplatePackageManifest['slots'] }
}

export type SimulatedTemplateAdapterResult = {
  asset: { id: string; title: string; summary: string; category: string; tags: string[] }
  version: SimulatedTemplateVersion
  package: { root: string; entry: string; files: string[] }
  source: TemplatePackageSource
}

function readJson(path: string): TemplatePackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as TemplatePackageManifest
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

export function normalizeTemplatePackageSource(source: TemplatePackageSource): TemplatePackageSource {
  if (!isInteractiveTemplatePackageManifest(source.manifest)) return source
  const manifest: TemplatePackageManifest = {
    contractVersion: source.manifest.contractVersion,
    id: source.manifest.id,
    version: source.manifest.version,
    title: source.manifest.title,
    summary: source.manifest.summary,
    category: source.manifest.category,
    tags: [...source.manifest.tags].sort(compareText),
    entry: source.manifest.entry,
    files: [...source.manifest.files].sort(compareText),
    slots: [...source.manifest.slots]
      .sort((left, right) => compareText(left.id, right.id))
      .map((slot) => ({
        id: slot.id,
        type: slot.type,
        required: slot.required,
        ...(slot.maxLength === undefined ? {} : { maxLength: slot.maxLength }),
        ...(slot.default === undefined ? {} : { default: slot.default }),
      })),
    runtime: {
      mode: 'sandboxed-js',
      viewport: { width: 1920, height: 1080 },
    },
  }
  return {
    manifest,
    files: Object.fromEntries(manifest.files.map((file) => [file, source.files[file]])),
  }
}

export function serializeTemplatePackage(source: TemplatePackageSource): Buffer {
  const normalized = normalizeTemplatePackageSource(source)
  const files = Object.entries(normalized.files).sort(([left], [right]) => isInteractiveTemplatePackageManifest(normalized.manifest)
    ? compareText(left, right)
    : left.localeCompare(right))
  const canonical = JSON.stringify({ manifest: normalized.manifest, files: Object.fromEntries(files) })
  return Buffer.from(canonical, 'utf8')
}

function digestPackage(source: TemplatePackageSource): string {
  return createHash('sha256').update(serializeTemplatePackage(source)).digest('hex')
}

export function adaptTemplatePackageSource(source: TemplatePackageSource, packageRoot = '[uploaded]'): SimulatedTemplateAdapterResult {
  assertValidTemplatePackage(source)
  const normalized = normalizeTemplatePackageSource(source)
  const sourceDigest = digestPackage(normalized)
  return {
    asset: { id: normalized.manifest.id, title: normalized.manifest.title, summary: normalized.manifest.summary, category: normalized.manifest.category, tags: normalized.manifest.tags },
    version: {
      id: `${normalized.manifest.id}-v${normalized.manifest.version}`,
      assetId: normalized.manifest.id,
      versionNumber: normalized.manifest.version,
      contractVersion: normalized.manifest.contractVersion,
      sourceDigest,
      contentObjectDigest: null,
      slotSchema: { slots: normalized.manifest.slots },
    },
    package: { root: packageRoot, entry: normalized.manifest.entry, files: [...normalized.manifest.files] },
    source: normalized,
  }
}

export function adaptSimulatedTemplatePackage(rootDir: string): SimulatedTemplateAdapterResult {
  const root = resolve(rootDir)
  const manifest = readJson(join(root, 'manifest.json'))
  const files = Object.fromEntries((manifest.files ?? []).map((file) => {
    const filePath = resolve(root, file)
    if (relative(root, filePath).startsWith('..') || filePath === root) throw new Error(`Package path escapes root: ${file}`)
    return [file, readFileSync(filePath, 'utf8')]
  }))
  const source: TemplatePackageSource = { manifest, files }
  return adaptTemplatePackageSource(source, root)
}
