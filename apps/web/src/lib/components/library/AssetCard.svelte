<script lang="ts">
  import type { CatalogItem } from '$lib/asset-library'
  import { safeDerivativeUrl } from '$lib/asset-library'

  let { item, selected, view, onToggle, onPreview }: { item: CatalogItem; selected: boolean; view: 'grid' | 'list'; onToggle: () => void; onPreview: () => void } = $props()
  let imageFailed = $state(false)
</script>

<article class:selected class:list={view === 'list'} class="asset-card">
  <button class="select-area" type="button" aria-pressed={selected} aria-label={`${selected ? '移出' : '加入'}汇报：${item.title}`} onclick={onToggle}>
    <span class="thumb-frame">
      {#if imageFailed}<span class="image-fallback">缩略图暂不可用</span>{:else}<img src={safeDerivativeUrl(item.derivative.thumbnailUrl)} alt="" onerror={() => { imageFailed = true }} />{/if}
    </span>
    <span class="card-copy">
      <strong>{item.title}</strong>
      <span class="summary">{item.summary}</span>
      <span class="metadata"><span>分类：{item.category}</span><span>版本：v{item.version.number}</span></span>
      <span class="tags" aria-label="标签">{#each item.tags as tag}<span>{tag}</span>{/each}</span>
    </span>
    <span class="selected-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
  </button>
  <button class="preview" type="button" aria-label={`预览 ${item.title}`} onclick={onPreview}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>
  </button>
</article>

<style>
  .asset-card { position: relative; min-width: 0; border: 1px solid var(--lib-border); border-radius: 8px; overflow: hidden; background: var(--lib-surface); color: var(--lib-text); transition: border-color .16s, box-shadow .16s, transform .16s; }
  .asset-card:hover { border-color: var(--lib-border-strong); transform: translateY(-1px); }
  .asset-card.selected { border-color: var(--lib-accent); box-shadow: 0 0 0 1px var(--lib-accent), var(--lib-shadow); }
  .select-area { width: 100%; display: block; border: 0; padding: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
  .select-area:focus-visible, .preview:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: -3px; }
  .thumb-frame { display: grid; place-items: center; width: 100%; aspect-ratio: 16/9; overflow: hidden; border-bottom: 1px solid var(--lib-border); background: var(--lib-surface-soft); }
  img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .image-fallback { color: var(--lib-muted); font-size: 12px; }
  .card-copy { min-height: 176px; display: grid; align-content: start; gap: 8px; padding: 14px 15px 13px; }
  strong { padding-right: 22px; color: var(--lib-text-strong); font: 700 16px/1.35 var(--font-display); }
  .summary { min-height: 40px; color: var(--lib-muted); font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .metadata { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--lib-muted); font-size: 11px; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tags > span { padding: 3px 7px; border: 1px solid color-mix(in srgb, var(--lib-accent) 42%, var(--lib-border)); border-radius: 4px; background: var(--lib-accent-soft); color: var(--lib-accent-strong); font-size: 11px; line-height: 1; }
  .selected-mark { position: absolute; right: 10px; top: 10px; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--lib-border-strong); border-radius: 5px; background: color-mix(in srgb, var(--lib-surface) 92%, transparent); color: transparent; font-size: 15px; font-weight: 800; }
  .selected .selected-mark { border-color: var(--lib-accent-fill); background: var(--lib-accent-fill); color: #fff; }
  .preview { position: absolute; z-index: 2; left: 10px; top: 10px; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--lib-border); border-radius: 50%; background: color-mix(in srgb, var(--lib-surface) 88%, transparent); color: var(--lib-text); cursor: pointer; }
  .preview svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; }
  .asset-card.list .select-area { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
  .asset-card.list .thumb-frame { border-bottom: 0; border-right: 1px solid var(--lib-border); }
  .asset-card.list .card-copy { min-height: auto; }
  @media (max-width: 640px) { .asset-card.list .select-area { grid-template-columns: 120px minmax(0,1fr); } .asset-card.list .summary { display: none; } }
  @media (prefers-reduced-motion: reduce) { .asset-card { transition: none; } }
</style>
