<script lang="ts">
  import { onMount } from 'svelte'
  import type { CatalogItem } from '$lib/asset-library'
  import { safeDerivativeUrl } from '$lib/asset-library'

  let { item, open, onClose }: { item: CatalogItem | null; open: boolean; onClose: () => void } = $props()
  let failedItemId = $state<string | null>(null)
  let closeButton: HTMLButtonElement | undefined = $state()

  $effect(() => { if (open) requestAnimationFrame(() => closeButton?.focus()) })
  onMount(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  })
</script>

{#if open && item}
  <div class="detail-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
      <header><div><h2 id="detail-title">{item.title}</h2><p>版本 v{item.version.number} · {item.version.status === 'available' ? '已发布' : '已验证'}</p></div><button bind:this={closeButton} type="button" aria-label="关闭模板详情" onclick={onClose}>×</button></header>
      <div class="preview-frame">
        {#if failedItemId === item.id}<div class="preview-error" role="status">安全 PNG 预览暂不可用</div>{:else}<img src={safeDerivativeUrl(item.derivative.previewUrl)} alt={`${item.title} 的安全 PNG 预览`} onerror={() => { failedItemId = item.id }} />{/if}
      </div>
      <dl>
        <div><dt>摘要</dt><dd>{item.summary}</dd></div>
        <div><dt>分类</dt><dd>{item.category}</dd></div>
        <div><dt>标签</dt><dd class="tag-list">{#each item.tags as tag}<span>{tag}</span>{/each}</dd></div>
        <div><dt>渲染器身份</dt><dd class="renderer">{item.derivative.rendererVersion}</dd></div>
      </dl>
      <p class="safety-note">这里只显示经过 CAS 重验的 PNG，不执行模板 HTML。</p>
    </div>
  </div>
{/if}

<style>
  .detail-backdrop { position: fixed; z-index: 90; inset: 0; display: flex; justify-content: flex-end; background: rgba(3, 8, 15, .62); }
  .detail-panel { width: min(560px, 92vw); height: 100%; padding: 24px; overflow-y: auto; border-left: 1px solid var(--lib-border); background: var(--lib-elevated); color: var(--lib-text); box-shadow: var(--lib-shadow-lg); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
  h2 { color: var(--lib-text-strong); font-size: 23px; line-height: 1.25; }
  header p { margin-top: 7px; color: var(--lib-muted); font-size: 12px; }
  header button { width: 36px; height: 36px; flex: none; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface); color: var(--lib-text); font-size: 24px; cursor: pointer; }
  header button:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  .preview-frame { aspect-ratio: 16/9; display: grid; place-items: center; overflow: hidden; margin-top: 22px; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface-soft); }
  img { width: 100%; height: 100%; object-fit: contain; }
  .preview-error { color: var(--lib-danger); font-size: 13px; }
  dl > div { padding: 17px 0; border-bottom: 1px solid var(--lib-border); }
  dt { margin-bottom: 7px; color: var(--lib-text-strong); font-size: 13px; font-weight: 700; }
  dd { margin: 0; color: var(--lib-muted); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-list span { padding: 4px 7px; border: 1px solid var(--lib-border); border-radius: 4px; background: var(--lib-accent-soft); color: var(--lib-accent-strong); }
  .renderer { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .safety-note { margin-top: 16px; color: var(--lib-muted); font-size: 12px; }
</style>
