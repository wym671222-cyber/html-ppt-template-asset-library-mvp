import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASSET_LIBRARY_THEME_COOKIE, createLibraryTheme, parseThemeChoice } from '../apps/web/src/lib/library-theme'

function readStore<T>(store: { subscribe(run: (value: T) => void): () => void }): T {
  let current!: T
  const unsubscribe = store.subscribe((value) => { current = value })
  unsubscribe()
  return current
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = hex.slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16) / 255) ?? []
    const [red, green, blue] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const left = luminance(foreground)
  const right = luminance(background)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

class TestMediaQuery {
  matches: boolean
  readonly media = '(prefers-color-scheme: dark)'
  onchange = null
  private listeners = new Set<() => void>()

  constructor(matches: boolean) { this.matches = matches }
  addEventListener(_type: string, listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: string, listener: () => void): void { this.listeners.delete(listener) }
  emit(matches: boolean): void { this.matches = matches; for (const listener of this.listeners) listener() }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('asset library theme state', () => {
  it('defaults missing or malformed cookie values to system', () => {
    expect(parseThemeChoice(undefined)).toBe('system')
    expect(parseThemeChoice('contrast')).toBe('system')
    expect(parseThemeChoice('dark')).toBe('dark')
    expect(parseThemeChoice('light')).toBe('light')
  })

  it('follows live system changes, persists explicit choices, and locks manual themes', () => {
    const media = new TestMediaQuery(true)
    const dataset: Record<string, string> = {}
    const style = { colorScheme: '', backgroundColor: '' }
    const documentStub = { cookie: '', documentElement: { dataset, style } }
    vi.stubGlobal('document', documentStub)
    vi.stubGlobal('location', { protocol: 'https:' })
    vi.stubGlobal('window', { matchMedia: () => media })

    const controller = createLibraryTheme('system')
    const stop = controller.start()
    expect(readStore(controller.choice)).toBe('system')
    expect(readStore(controller.resolved)).toBe('dark')
    expect(dataset).toMatchObject({ assetThemeChoice: 'system', assetTheme: 'dark' })
    expect(style).toMatchObject({ colorScheme: 'dark', backgroundColor: '#09111b' })

    media.emit(false)
    expect(readStore(controller.resolved)).toBe('light')

    controller.select('dark')
    expect(documentStub.cookie).toContain(`${ASSET_LIBRARY_THEME_COOKIE}=dark`)
    expect(documentStub.cookie).toContain('Path=/; Max-Age=31536000; SameSite=Lax; Secure')
    media.emit(false)
    expect(readStore(controller.resolved)).toBe('dark')

    controller.select('light')
    media.emit(true)
    expect(readStore(controller.resolved)).toBe('light')
    stop()
    expect(dataset.assetThemeChoice).toBeUndefined()
    expect(dataset.assetTheme).toBeUndefined()
    expect(style).toEqual({ colorScheme: '', backgroundColor: '' })
  })

  it('installs the first-paint resolver before Svelte head content and exposes radio-menu keyboard support', () => {
    const appHtml = readFileSync(join(process.cwd(), 'apps/web/src/app.html'), 'utf8')
    const switcher = readFileSync(join(process.cwd(), 'apps/web/src/lib/components/library/ThemeSwitcher.svelte'), 'utf8')
    expect(appHtml.indexOf('asset-library-theme')).toBeLessThan(appHtml.indexOf('%sveltekit.head%'))
    expect(appHtml).toContain("choice = match?.[1] ?? 'system'")
    expect(switcher).toContain('role="menuitemradio"')
    expect(switcher).toMatch(/ArrowDown|ArrowUp/)
    expect(switcher).toMatch(/focus-visible/)
  })

  it('keeps normal text, links and filled actions at WCAG AA contrast in both themes', () => {
    const pairs = [
      ['#101827', '#ffffff'], ['#5f6b7c', '#ffffff'], ['#1768e5', '#ffffff'], ['#ffffff', '#1768e5'],
      ['#e8edf4', '#09111b'], ['#9ba8b9', '#09111b'], ['#4d86f7', '#09111b'], ['#ffffff', '#3b70d8'],
    ] as const
    for (const [foreground, background] of pairs) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
    const css = readFileSync(join(process.cwd(), 'apps/web/src/app.css'), 'utf8')
    expect(css).toContain('--lib-accent-fill: #1768e5')
    expect(css).toContain('--lib-accent-fill: #3b70d8')
  })
})
