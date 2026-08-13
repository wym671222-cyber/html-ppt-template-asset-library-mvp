import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  assertValidTemplatePackage,
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

export function serializeTemplatePackage(source: TemplatePackageSource): Buffer {
  const canonical = JSON.stringify({ manifest: source.manifest, files: Object.fromEntries(Object.entries(source.files).sort(([a], [b]) => a.localeCompare(b))) })
  return Buffer.from(canonical, 'utf8')
}

function digestPackage(source: TemplatePackageSource): string {
  return createHash('sha256').update(serializeTemplatePackage(source)).digest('hex')
}

export function adaptTemplatePackageSource(source: TemplatePackageSource, packageRoot = '[uploaded]'): SimulatedTemplateAdapterResult {
  assertValidTemplatePackage(source)
  const sourceDigest = digestPackage(source)
  return {
    asset: { id: source.manifest.id, title: source.manifest.title, summary: source.manifest.summary, category: source.manifest.category, tags: source.manifest.tags },
    version: {
      id: `${source.manifest.id}-v${source.manifest.version}`,
      assetId: source.manifest.id,
      versionNumber: source.manifest.version,
      contractVersion: source.manifest.contractVersion,
      sourceDigest,
      contentObjectDigest: null,
      slotSchema: { slots: source.manifest.slots },
    },
    package: { root: packageRoot, entry: source.manifest.entry, files: [...source.manifest.files] },
    source,
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
