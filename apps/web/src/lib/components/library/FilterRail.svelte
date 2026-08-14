<script lang="ts">
  type Facet = { value: string; count: number }
  type StatusFacet = { value: 'verified' | 'available'; count: number }

  let {
    category, selectedTags, status, categories, tags, statuses, onCategory, onTag, onStatus, onClear, onClose,
  }: {
    category: string
    selectedTags: string[]
    status: '' | 'verified' | 'available'
    categories: Facet[]
    tags: Facet[]
    statuses: StatusFacet[]
    onCategory: (value: string) => void
    onTag: (value: string) => void
    onStatus: (value: '' | 'verified' | 'available') => void
    onClear: () => void
    onClose?: () => void
  } = $props()
</script>

<aside class="filter-rail" aria-label="资产筛选">
  <header>
    <h2>筛选</h2>
    <div><button type="button" onclick={onClear}>清空</button>{#if onClose}<button class="close" type="button" aria-label="关闭筛选" onclick={onClose}>×</button>{/if}</div>
  </header>

  <fieldset>
    <legend><span>分类</span><button type="button" onclick={() => onCategory('')}>清空</button></legend>
    {#if categories.length === 0}<p class="filter-empty">暂无分类</p>{/if}
    {#each categories as facet}
      <label class="filter-option">
        <input type="radio" name="category" checked={category === facet.value} onchange={() => onCategory(category === facet.value ? '' : facet.value)} />
        <span>{facet.value}</span><small>{facet.count}</small>
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend><span>标签</span><button type="button" onclick={() => { for (const value of selectedTags) onTag(value) }}>清空</button></legend>
    {#if tags.length === 0}<p class="filter-empty">暂无可用标签</p>{/if}
    {#each tags as facet}
      <label class="filter-option">
        <input type="checkbox" checked={selectedTags.includes(facet.value)} onchange={() => onTag(facet.value)} />
        <span>{facet.value}</span><small>{facet.count}</small>
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend><span>状态</span><button type="button" onclick={() => onStatus('')}>清空</button></legend>
    {#each statuses as facet}
      <label class="filter-option">
        <input type="radio" name="status" checked={status === facet.value} onchange={() => onStatus(status === facet.value ? '' : facet.value)} />
        <span>{facet.value === 'available' ? '已发布' : '已验证'}</span><small>{facet.count}</small>
      </label>
    {/each}
  </fieldset>

  <footer>更多筛选 <span aria-hidden="true">⌄</span></footer>
</aside>

<style>
  .filter-rail { min-width: 0; height: 100%; background: var(--lib-rail); border-right: 1px solid var(--lib-border); overflow-y: auto; color: var(--lib-text); }
  header { min-height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--lib-border); }
  h2 { font-size: 16px; line-height: 1; }
  header div { display: flex; align-items: center; gap: 8px; }
  button { border: 0; background: transparent; color: var(--lib-muted); font: 600 12px/1 var(--font-body); cursor: pointer; }
  button:hover { color: var(--lib-accent); }
  button:focus-visible, .filter-option:focus-within { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  .close { display: none; width: 30px; height: 30px; font-size: 22px; }
  fieldset { border: 0; border-bottom: 1px solid var(--lib-border); padding: 16px 18px 14px; }
  legend { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0 0 8px; color: var(--lib-text-strong); font: 700 14px/1.3 var(--font-body); }
  .filter-option { min-height: 34px; display: grid; grid-template-columns: 17px minmax(0,1fr) auto; align-items: center; gap: 9px; border-radius: 5px; color: var(--lib-text); font-size: 13px; cursor: pointer; }
  .filter-option small { color: var(--lib-muted); font-size: 12px; }
  input { width: 16px; height: 16px; accent-color: var(--lib-accent); }
  .filter-empty { padding: 8px 0; color: var(--lib-muted); font-size: 12px; }
  footer { padding: 17px 18px; color: var(--lib-text); font-size: 13px; }
  footer span { margin-left: 5px; color: var(--lib-muted); }
  @media (max-width: 1100px) {
    .filter-rail { width: min(310px, 88vw); box-shadow: var(--lib-shadow-lg); }
    .close { display: inline-grid; place-items: center; }
  }
</style>
