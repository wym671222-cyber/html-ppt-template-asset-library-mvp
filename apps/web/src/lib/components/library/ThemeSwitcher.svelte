<script lang="ts">
  import { getContext, onMount, tick } from 'svelte'
  import { LIBRARY_THEME_CONTEXT, type LibraryThemeController, type ThemeChoice } from '$lib/library-theme'

  const controller = getContext<LibraryThemeController>(LIBRARY_THEME_CONTEXT)
  const { choice } = controller
  let open = $state(false)
  let root: HTMLDivElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()

  const labels: Record<ThemeChoice, string> = { dark: '深色', light: '浅色', system: '跟随系统' }
  const options: ThemeChoice[] = ['dark', 'light', 'system']

  function select(next: ThemeChoice): void {
    controller.select(next)
    open = false
    void tick().then(() => trigger?.focus())
  }

  function optionButtons(): HTMLButtonElement[] {
    return root ? [...root.querySelectorAll<HTMLButtonElement>('.theme-menu button')] : []
  }

  async function openAndFocus(index: number): Promise<void> {
    open = true
    await tick()
    optionButtons()[index]?.focus()
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') { event.preventDefault(); void openAndFocus(0) }
    if (event.key === 'ArrowUp') { event.preventDefault(); void openAndFocus(options.length - 1) }
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    const buttons = optionButtons()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); return }
    if (event.key === 'End') { event.preventDefault(); buttons.at(-1)?.focus(); return }
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (direction !== 0) {
      event.preventDefault()
      buttons[(current + direction + buttons.length) % buttons.length]?.focus()
    }
  }

  onMount(() => {
    const close = (event: PointerEvent): void => {
      if (open && root && !root.contains(event.target as Node)) open = false
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && open) { open = false; void tick().then(() => trigger?.focus()) }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  })
</script>

<div class="theme-switcher" bind:this={root}>
  <button class="theme-trigger" bind:this={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onclick={() => { if (open) open = false; else void openAndFocus(0) }} onkeydown={onTriggerKeydown}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
    <span>{labels[$choice]}</span>
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"></path></svg>
  </button>
  {#if open}
    <div class="theme-menu" role="menu" aria-label="界面主题" tabindex="-1" onkeydown={onMenuKeydown}>
      {#each options as option}
        <button type="button" role="menuitemradio" aria-checked={$choice === option} onclick={() => select(option)}>
          <span>{labels[option]}</span>
          {#if $choice === option}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .theme-switcher { position: relative; }
  button { font: 600 13px/1 var(--font-body); }
  .theme-trigger { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface); color: var(--lib-text); cursor: pointer; }
  .theme-trigger:hover { border-color: var(--lib-border-strong); background: var(--lib-surface-hover); }
  .theme-trigger:focus-visible, .theme-menu button:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  .theme-trigger > svg:first-child { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
  .chevron { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .theme-menu { position: absolute; z-index: 80; top: calc(100% + 8px); right: 0; width: 152px; padding: 6px; border: 1px solid var(--lib-border); border-radius: 8px; background: var(--lib-elevated); box-shadow: var(--lib-shadow-lg); }
  .theme-menu button { width: 100%; min-height: 36px; display: flex; align-items: center; justify-content: space-between; border: 0; border-radius: 5px; padding: 0 9px; background: transparent; color: var(--lib-text); cursor: pointer; }
  .theme-menu button:hover { background: var(--lib-surface-hover); }
  .theme-menu button[aria-checked='true'] { color: var(--lib-accent); }
  .theme-menu button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  @media (max-width: 760px) { .theme-trigger span { display: none; } }
</style>
