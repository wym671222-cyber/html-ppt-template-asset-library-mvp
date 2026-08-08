<script lang="ts">
  import type { CatalogItem } from '$lib/asset-library'
  import AssetCard from './AssetCard.svelte'

  let { items, selectedId, onSelect }: { items: CatalogItem[]; selectedId: string | null; onSelect: (id: string) => void } = $props()

  function navigate(event: KeyboardEvent, index: number): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const next = Math.min(items.length - 1, Math.max(0, index + delta))
    onSelect(items[next].id)
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLButtonElement>('[data-asset-card]')[next]?.focus()
    })
  }
</script>

<div class="asset-grid" aria-label="模板资产列表">
  {#each items as item, index (item.id)}
    <AssetCard item={item} selected={selectedId === item.id} onSelect={() => onSelect(item.id)} onKeydown={(event) => navigate(event, index)} />
  {/each}
</div>

<style>
  .asset-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 18px; }
  @media (max-width: 1320px) { .asset-grid { grid-template-columns: 1fr; } }
  @media (max-width: 1080px) { .asset-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); } }
  @media (max-width: 700px) { .asset-grid { grid-template-columns: 1fr; } }
</style>
