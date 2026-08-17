import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { validateTemplatePackage } from '../packages/shared/src/template-package.js'

const fixture = resolve('fixtures/p03-simulated-template')

describe('P03 simulated HTML template package adapter', () => {
  it('adapts the repository-local fixture into an immutable version-shaped record', () => {
    const result = adaptSimulatedTemplatePackage(fixture)
    expect(result.asset.id).toBe('simulated-quarterly-brief')
    expect(result.version).toMatchObject({
      id: 'simulated-quarterly-brief-v1',
      assetId: 'simulated-quarterly-brief',
      versionNumber: 1,
      contractVersion: 'html-template/v1',
      contentObjectDigest: null,
    })
    expect(result.version.sourceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(result.version.slotSchema.slots.map((slot) => slot.id)).toEqual(['title', 'subtitle', 'accent-color'])
    expect(result.package.files).toEqual(['index.html', 'styles.css'])
  })

  it('is deterministic and does not write a CAS object or database record', () => {
    const before = readFileSync(join(fixture, 'index.html'), 'utf8')
    const first = adaptSimulatedTemplatePackage(fixture)
    const second = adaptSimulatedTemplatePackage(fixture)
    expect(second.version.sourceDigest).toBe(first.version.sourceDigest)
    expect(readFileSync(join(fixture, 'index.html'), 'utf8')).toBe(before)
  })

  it('rejects undeclared bindings, scripts, external URLs, and unsafe package paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-library-p03-'))
    cpSync(fixture, root, { recursive: true })
    const manifestPath = join(root, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.files = ['index.html', '../outside.html']
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => adaptSimulatedTemplatePackage(root)).toThrow(/unsafe package path|escapes root/)

    const validManifest = { ...manifest, files: ['index.html', 'styles.css'] }
    writeFileSync(manifestPath, JSON.stringify(validManifest))
    writeFileSync(join(root, 'index.html'), '<script>alert(1)</script><div data-template-slot="missing"></div>')
    expect(() => adaptSimulatedTemplatePackage(root)).toThrow(/unknown slot binding|scripts/)
  })

  it('reports contract violations without needing a filesystem or preview runtime', () => {
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'))
    manifest.slots[0].type = 'html'
    const errors = validateTemplatePackage({ manifest, files: { 'index.html': '<h1></h1>', 'styles.css': '' } })
    expect(errors.map((error) => error.field)).toContain('slots[0].type')
  })

  it('accepts the exact v2 runtime contract and rejects viewport drift', () => {
    const source = {
      manifest: {
        contractVersion: 'html-template/v2', id: 'interactive-fixture', version: 1,
        title: 'Interactive fixture', summary: 'Repository-local v2 protocol fixture',
        category: 'fixture', tags: [], entry: 'index.html', files: ['index.html', 'runtime.js'], slots: [],
        runtime: { mode: 'sandboxed-js', viewport: { width: 1920, height: 1080 } },
      },
      files: { 'index.html': '<script src="runtime.js"></script>', 'runtime.js': 'document.body.dataset.ready = "true"' },
    }
    expect(validateTemplatePackage(source as never)).toEqual([])
    const drifted = structuredClone(source)
    drifted.manifest.runtime.viewport.width = 1280
    expect(validateTemplatePackage(drifted as never).map((error) => error.field)).toContain('runtime.viewport')
  })
})
