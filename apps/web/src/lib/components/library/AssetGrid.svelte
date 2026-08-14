<script lang="ts">
  import type { CatalogItem } from '$lib/asset-library'
  import AssetCard from './AssetCard.svelte'

  let { items, selectedIds, view, onToggle, onPreview }: { items: CatalogItem[]; selectedIds: ReadonlySet<string>; view: 'grid' | 'list'; onToggle: (item: CatalogItem) => void; onPreview: (item: CatalogItem) => void } = $props()
</script>

<div class:list={view === 'list'} class="asset-grid" aria-label="模板资产列表">
  {#each items as item (item.id)}
    <AssetCard {item} selected={selectedIds.has(item.version.id)} {view} onToggle={() => onToggle(item)} onPreview={() => onPreview(item)} />
  {/each}
</div>

<style>
  .asset-grid { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 14px; }
  .asset-grid.list { grid-template-columns: 1fr; }
  @media (max-width: 1320px) { .asset-grid { grid-template-columns: 1fr; } }
  @media (max-width: 1100px) { .asset-grid { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
  @media (max-width: 720px) { .asset-grid { grid-template-columns: 1fr; } }
</style>
