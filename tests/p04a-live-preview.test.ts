import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEMPLATE_STATIC_RUNTIME_CSP, type TemplatePackageSource } from '../packages/shared/src/index.js'
import { compileStaticTemplateRuntime } from '../apps/api/src/templates/static-template-runtime.js'
import { adaptSimulatedTemplatePackage, serializeTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { createHash } from 'node:crypto'

const fixtureRoot = join(process.cwd(), 'fixtures/p03-simulated-template')

function digest(source: TemplatePackageSource): string {
  return createHash('sha256').update(serializeTemplatePackage(source)).digest('hex')
}

describe('P04A static live runtime', () => {
  it('serves the real v1 DOM and CSS without active or navigational capability', () => {
    const fixture = adaptSimulatedTemplatePackage(fixtureRoot)
    const compiled = compileStaticTemplateRuntime(fixture.source, {
      sourceDigest: fixture.version.sourceDigest,
      assetId: fixture.asset.id,
      version: fixture.version.versionNumber,
    })
    const html = compiled.html.toString('utf8')
    expect(compiled.mode).toBe('sandboxed-static')
    expect(compiled.contentSecurityPolicy).toBe(TEMPLATE_STATIC_RUNTIME_CSP)
    expect(TEMPLATE_STATIC_RUNTIME_CSP).toContain("script-src 'none'")
    expect(TEMPLATE_STATIC_RUNTIME_CSP).toContain("connect-src 'none'")
    expect(TEMPLATE_STATIC_RUNTIME_CSP).toContain("navigate-to 'none'")
    expect(TEMPLATE_STATIC_RUNTIME_CSP).toContain('sandbox')
    expect(TEMPLATE_STATIC_RUNTIME_CSP).not.toContain('allow-scripts')
    expect(html).toContain('<h1 data-template-slot="title">Quarterly brief title</h1>')
    expect(html).toContain('<style data-template-stylesheet="styles.css">')
    expect(html).not.toMatch(/<script\b|<link\b|https?:|file:/i)
  })

  it('rejects scripts, external requests, navigation, downloads and CSS fetches before compilation', () => {
    const fixture = adaptSimulatedTemplatePackage(fixtureRoot)
    const variants = [
      '<script>document.body.dataset.ran="true"</script>',
      '<img src="https://example.test/pixel.png">',
      '<a href="next.html">navigate</a>',
      '<a download href="data:text/plain,x">download</a>',
    ]
    for (const active of variants) {
      const source = structuredClone(fixture.source)
      source.files = { ...source.files, 'index.html': `<!doctype html><html><body>${active}</body></html>` }
      expect(() => compileStaticTemplateRuntime(source, { sourceDigest: digest(source), assetId: fixture.asset.id, version: fixture.version.versionNumber })).toThrow()
    }
    const cssFetch = structuredClone(fixture.source)
    cssFetch.files = { ...cssFetch.files, 'styles.css': 'body{background:url(https://example.test/x.png)}' }
    expect(() => compileStaticTemplateRuntime(cssFetch, { sourceDigest: digest(cssFetch), assetId: fixture.asset.id, version: fixture.version.versionNumber })).toThrow(/fetch resources/)
  })

  it('keeps cards on PNG thumbnails and creates the runtime iframe only inside the modal', () => {
    const card = readFileSync(join(process.cwd(), 'apps/web/src/lib/components/library/AssetCard.svelte'), 'utf8')
    const detail = readFileSync(join(process.cwd(), 'apps/web/src/lib/components/library/AssetDetail.svelte'), 'utf8')
    const page = readFileSync(join(process.cwd(), 'apps/web/src/routes/(app)/+page.svelte'), 'utf8')
    expect(card).toContain('item.derivative.thumbnailUrl')
    expect(card).not.toContain('<iframe')
    expect(detail).toContain('{#if open && item}')
    expect(detail).toContain('<details class="metadata-panel">')
    expect(detail).toContain('sandbox=""')
    expect(detail).toContain('sandbox="allow-scripts"')
    expect(detail).toContain('document.fullscreenElement')
    expect(detail).toContain('closeButton?.focus({ preventScroll: true })')
    expect(page).toContain('requestAnimationFrame(() => trigger?.focus())')
  })
})
