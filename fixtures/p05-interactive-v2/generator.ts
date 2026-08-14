import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStoredZip } from '../../apps/api/src/presentation-exports/offline-archive.js'
import {
  INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
  TEMPLATE_PACKAGE_CONTRACT_VERSION,
  type TemplatePackageSource,
} from '../../packages/shared/src/template-package.js'
import { adaptTemplatePackageSource, serializeTemplatePackage, type SimulatedTemplateAdapterResult } from '../../apps/api/src/templates/simulated-adapter.js'

/**
 * P05 repository-local fixture catalogue. These IDs are deliberately synthetic;
 * the generator never reads the real HTML/PPT asset directories.
 */
export const P05_INTERACTIVE_FIXTURE_IDS = [
  'p05-interactive-01',
  'p05-interactive-02',
  'p05-interactive-03',
  'p05-interactive-04',
  'p05-interactive-05',
  'p05-interactive-06',
  'p05-interactive-07',
  'p05-interactive-08',
  'p05-interactive-09',
  'p05-interactive-10',
  'p05-interactive-11',
  'p05-interactive-12',
] as const

const FAMILY_NAMES = ['timeline', 'chart', 'network', 'map', 'particles', 'physics', 'board'] as const
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export type P05InteractiveFixtureDefinition = Readonly<{
  id: (typeof P05_INTERACTIVE_FIXTURE_IDS)[number]
  family: (typeof FAMILY_NAMES)[number]
  title: string
  accent: string
}>

export const P05_INTERACTIVE_FIXTURES: readonly P05InteractiveFixtureDefinition[] = P05_INTERACTIVE_FIXTURE_IDS.map((id, index) => ({
  id,
  family: FAMILY_NAMES[index % FAMILY_NAMES.length],
  title: `P05 ${FAMILY_NAMES[index % FAMILY_NAMES.length]} fixture ${String(index + 1).padStart(2, '0')}`,
  accent: `#${(0x1d4ed8 + index * 0x07111).toString(16).slice(-6)}`,
}))

function definition(assetId: string): P05InteractiveFixtureDefinition {
  const value = P05_INTERACTIVE_FIXTURES.find((fixture) => fixture.id === assetId)
  if (!value) throw new Error(`Unknown P05 fixture asset id: ${assetId}`)
  return value
}

function sourceFor(def: P05InteractiveFixtureDefinition, version: 1 | 2): TemplatePackageSource {
  const interactive = version === 2
  const files: Record<string, string> = {
    'index.html': `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><main data-template-slot="accent-color"><h1 data-template-slot="title">${def.title}</h1><p>${def.family} · offline fixture</p><img alt="fixture pixel" src="data:image/png;base64,${ONE_PIXEL_PNG}">${interactive ? '<button id="advance" type="button">Advance</button><output id="count" aria-live="polite">0</output><script src="runtime.js"></script>' : ''}</main></body></html>`,
    'styles.css': `:root{font-family:system-ui,sans-serif}html,body{margin:0;width:100%;height:100%;background:#f8fafc;color:#0f172a}main{box-sizing:border-box;width:100%;height:100%;padding:48px;border-top:14px solid ${def.accent};display:grid;align-content:start;gap:16px}h1{font-size:42px;margin:0}p{font-size:22px;color:#475569}img{width:1px;height:1px}button{width:max-content;padding:10px 18px}output{font-variant-numeric:tabular-nums}`,
  }
  if (interactive) files['runtime.js'] = `(() => { 'use strict'; const button = document.getElementById('advance'); const output = document.getElementById('count'); let count = 0; const render = () => { if (output) output.textContent = String(count); }; if (button) button.addEventListener('click', () => { count += 1; render(); }); render(); })()`
  const manifest = interactive
    ? {
        contractVersion: INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
        id: def.id,
        version,
        title: def.title,
        summary: `Repository-local ${def.family} fixture`,
        category: `p05/${def.family}`,
        tags: ['p05-fixture', def.family],
        entry: 'index.html',
        files: ['index.html', 'styles.css', 'runtime.js'],
        slots: [
          { id: 'accent-color', type: 'color' as const, required: false, default: def.accent },
          { id: 'title', type: 'text' as const, required: false, maxLength: 120, default: def.title },
        ],
        runtime: { mode: 'sandboxed-js' as const, viewport: { width: 1920 as const, height: 1080 as const } },
      }
    : {
        contractVersion: TEMPLATE_PACKAGE_CONTRACT_VERSION,
        id: def.id,
        version,
        title: def.title,
        summary: `Repository-local ${def.family} fixture`,
        category: `p05/${def.family}`,
        tags: ['p05-fixture', def.family],
        entry: 'index.html',
        files: ['index.html', 'styles.css'],
        slots: [
          { id: 'accent-color', type: 'color' as const, required: false, default: def.accent },
          { id: 'title', type: 'text' as const, required: false, maxLength: 120, default: def.title },
        ],
      }
  return { manifest, files }
}

export function createP05InteractiveSource(assetId: string): TemplatePackageSource {
  return sourceFor(definition(assetId), 2)
}

export function createP05V1BaselineSource(assetId: string): TemplatePackageSource {
  return sourceFor(definition(assetId), 1)
}

export function createP05InteractivePackage(assetId: string): SimulatedTemplateAdapterResult {
  return adaptTemplatePackageSource(createP05InteractiveSource(assetId), 'fixtures/p05-interactive-v2')
}

export function createP05V1BaselinePackage(assetId: string): SimulatedTemplateAdapterResult {
  return adaptTemplatePackageSource(createP05V1BaselineSource(assetId), 'fixtures/p05-interactive-v2')
}

/** Materialise all twelve packages under a caller-owned temporary/fixture root. */
export function writeP05InteractiveFixtureDirectory(outputRoot: string): void {
  for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) {
    const directory = join(outputRoot, assetId)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const source = createP05InteractiveSource(assetId)
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(source.manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'w', mode: 0o600 })
    for (const name of source.manifest.files) writeFileSync(join(directory, name), source.files[name], { encoding: 'utf8', flag: 'w', mode: 0o600 })
  }
}

/** Build a byte-stable stored ZIP: fixed entry order, fixed DOS timestamp, no compression. */
export function createP05PackageZip(assetId: string): Buffer {
  const source = createP05InteractiveSource(assetId)
  const manifest = Buffer.from(`${JSON.stringify(source.manifest, null, 2)}\n`, 'utf8')
  const files = source.manifest.files.map((name) => ({ relativePath: name, content: Buffer.from(source.files[name], 'utf8') }))
  return createStoredZip([{ relativePath: 'manifest.json', content: manifest }, ...files])
}

export function p05FixtureDigest(assetId: string): string {
  return createHash('sha256').update(serializeTemplatePackage(createP05InteractiveSource(assetId))).digest('hex')
}

export function p05FixtureDigests(): Readonly<Record<string, string>> {
  return Object.fromEntries(P05_INTERACTIVE_FIXTURE_IDS.map((id) => [id, p05FixtureDigest(id)]))
}
