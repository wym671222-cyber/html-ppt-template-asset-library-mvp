<script lang="ts">
  import { page } from '$app/state'
  import { setContext } from 'svelte'
  import { createLibraryTheme, LIBRARY_THEME_CONTEXT, type ThemeChoice } from '$lib/library-theme'

  let { children, data }: { children: import('svelte').Snippet; data: { themeChoice: ThemeChoice } } = $props()
  // svelte-ignore state_referenced_locally
  const controller = createLibraryTheme(data.themeChoice)
  const { choice, resolved } = controller
  const isLibrarySurface = $derived(page.url.pathname === '/' || page.url.pathname === '/admin')
  setContext(LIBRARY_THEME_CONTEXT, controller)
  $effect(() => {
    if (!isLibrarySurface) return
    return controller.start()
  })
</script>

<div class:library-theme-root={isLibrarySurface} data-theme-choice={isLibrarySurface ? $choice : undefined} data-resolved-theme={isLibrarySurface ? $resolved : undefined}>
  {@render children()}
</div>

<style>
  .library-theme-root { min-height: 100vh; color-scheme: light; }
  .library-theme-root[data-theme-choice='dark'] { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { .library-theme-root[data-theme-choice='system'] { color-scheme: dark; } }
</style>
