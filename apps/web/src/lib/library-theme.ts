import { writable, type Readable } from 'svelte/store'

export const ASSET_LIBRARY_THEME_COOKIE = 'asset-library-theme'
export const LIBRARY_THEME_CONTEXT = Symbol('library-theme')

export type ThemeChoice = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export type LibraryThemeController = Readonly<{
  choice: Readable<ThemeChoice>
  resolved: Readable<ResolvedTheme>
  select(choice: ThemeChoice): void
  start(): () => void
}>

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system'
}

function resolvedTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
}

export function createLibraryTheme(initialChoice: ThemeChoice): LibraryThemeController {
  const choice = writable<ThemeChoice>(parseThemeChoice(initialChoice))
  const resolved = writable<ResolvedTheme>('light')
  let currentChoice = parseThemeChoice(initialChoice)
  let media: MediaQueryList | null = null

  const apply = (): void => {
    if (typeof document === 'undefined') return
    const effective = resolvedTheme(currentChoice, Boolean(media?.matches))
    resolved.set(effective)
    document.documentElement.dataset.assetThemeChoice = currentChoice
    document.documentElement.dataset.assetTheme = effective
    document.documentElement.style.colorScheme = effective
    document.documentElement.style.backgroundColor = effective === 'dark' ? '#09111b' : '#ffffff'
  }

  return {
    choice,
    resolved,
    select(next) {
      currentChoice = parseThemeChoice(next)
      choice.set(currentChoice)
      if (typeof document !== 'undefined') {
        const secure = location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `${ASSET_LIBRARY_THEME_COOKIE}=${currentChoice}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
      }
      apply()
    },
    start() {
      if (typeof window === 'undefined') return () => undefined
      media = window.matchMedia('(prefers-color-scheme: dark)')
      const unsubscribe = choice.subscribe((next) => {
        currentChoice = next
        apply()
      })
      const onSystemChange = (): void => { if (currentChoice === 'system') apply() }
      media.addEventListener('change', onSystemChange)
      apply()
      return () => {
        unsubscribe()
        media?.removeEventListener('change', onSystemChange)
        media = null
        delete document.documentElement.dataset.assetThemeChoice
        delete document.documentElement.dataset.assetTheme
        document.documentElement.style.colorScheme = ''
        document.documentElement.style.backgroundColor = ''
      }
    },
  }
}
