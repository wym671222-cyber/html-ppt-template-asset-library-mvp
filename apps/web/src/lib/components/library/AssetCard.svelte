<script lang="ts">
  import type { CatalogItem } from '$lib/asset-library'
  import { safeDerivativeUrl } from '$lib/asset-library'

  let { item, selected, onSelect, onKeydown }: { item: CatalogItem; selected: boolean; onSelect: () => void; onKeydown: (event: KeyboardEvent) => void } = $props()
  let imageFailed = $state(false)
</script>

<button
  type="button"
  class:selected
  class="asset-card"
  data-asset-card
  aria-pressed={selected}
  aria-label={`选择模板 ${item.title}`}
  onclick={onSelect}
  onkeydown={onKeydown}
>
  <span class="thumb-frame">
    {#if imageFailed}
      <span class="image-fallback">缩略图暂不可用</span>
    {:else}
      <img src={safeDerivativeUrl(item.derivative.thumbnailUrl)} alt={`${item.title} 的安全 PNG 缩略图`} onerror={() => { imageFailed = true }} />
    {/if}
    {#if selected}<span class="selected-mark" aria-hidden="true">✓</span>{/if}
  </span>
  <span class="card-copy">
    <strong>{item.title}</strong>
    <span class="summary">{item.summary}</span>
    <span class="metadata"><span>{item.category}</span><span>v{item.version.number}</span></span>
    <span class="tags" aria-label="标签">
      {#each item.tags as tag}<span>{tag}</span>{/each}
    </span>
  </span>
</button>

<style>
  .asset-card { appearance: none; width: 100%; min-width: 0; text-align: left; background: #fff; color: #0b1739; border: 1px solid #d6dde7; border-radius: 9px; padding: 13px; font: inherit; cursor: pointer; transition: border-color .16s, box-shadow .16s, transform .16s; }
  .asset-card:hover { border-color: #9ba9bb; transform: translateY(-1px); }
  .asset-card:focus-visible { outline: 3px solid rgba(23, 104, 229, .28); outline-offset: 2px; border-color: #1768e5; }
  .asset-card.selected { border-color: #f59e0b; box-shadow: 0 5px 18px rgba(11, 23, 57, .08); }
  .thumb-frame { position: relative; display: grid; place-items: center; overflow: hidden; width: 100%; aspect-ratio: 16/9; border: 1px solid #dce2ea; border-radius: 6px; background: #f1f4f8; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .image-fallback { color: #708096; font-size: 12px; }
  .selected-mark { position: absolute; right: 8px; top: 8px; display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; background: #f59e0b; color: #fff; font-weight: 800; box-shadow: 0 2px 6px rgba(11, 23, 57, .15); }
  .card-copy { display: grid; gap: 8px; padding-top: 13px; }
  strong { font: 700 16px/1.35 var(--font-display); }
  .summary { color: #536178; font-size: 13px; line-height: 1.55; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; min-height: 40px; }
  .metadata { display: flex; justify-content: space-between; gap: 12px; color: #5f6f85; font-size: 12px; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tags > span { color: #155fcf; background: #f1f6ff; border: 1px solid #b8d0f6; border-radius: 5px; padding: 3px 6px; font-size: 11px; line-height: 1; }
  @media (prefers-reduced-motion: reduce) { .asset-card { transition: none; } }
</style>
