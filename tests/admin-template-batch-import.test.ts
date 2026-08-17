import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin interactive template batch import', () => {
  it('accepts up to twelve ZIP packages and waits for every preview before completion', () => {
    const page = readFileSync(join(process.cwd(), 'apps/web/src/routes/(app)/admin/+page.svelte'), 'utf8')
    expect(page).toContain("multiple={importMode === 'zip'}")
    expect(page).toContain("if (importMode === 'zip' && files.length > 12)")
    expect(page).toContain('for (const [index, file] of files.entries())')
    expect(page).toContain('const result = await uploadTemplateZip(file)')
    expect(page).toContain('await waitForPreview(result)')
    expect(page.indexOf('const result = await uploadTemplateZip(file)')).toBeLessThan(page.indexOf('await waitForPreview(result)', page.indexOf('const result = await uploadTemplateZip(file)')))
    expect(page).toContain('支持 html-template/v1 / v2')
  })
})
