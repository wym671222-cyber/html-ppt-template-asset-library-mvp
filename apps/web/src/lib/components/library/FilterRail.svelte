<script lang="ts">
  let {
    search,
    category,
    selectedTags,
    categories,
    tags,
    onSearch,
    onCategory,
    onTag,
  }: {
    search: string
    category: string
    selectedTags: string[]
    categories: string[]
    tags: string[]
    onSearch: (value: string) => void
    onCategory: (value: string) => void
    onTag: (value: string) => void
  } = $props()
</script>

<aside class="filter-rail" aria-label="资产筛选">
  <div class="search-wrap">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.2 16.2 4 4"></path></svg>
    <label class="sr-only" for="asset-search">搜索模板</label>
    <input
      id="asset-search"
      type="search"
      placeholder="搜索模板"
      value={search}
      maxlength="100"
      oninput={(event) => onSearch(event.currentTarget.value)}
      onkeydown={(event) => { if (event.key === 'Escape') onSearch('') }}
    />
  </div>

  <fieldset>
    <legend>分类</legend>
    <label class="filter-option">
      <input type="radio" name="category" checked={category === ''} onchange={() => onCategory('')} />
      <span>全部</span>
    </label>
    {#each categories as value}
      <label class="filter-option">
        <input type="radio" name="category" checked={category === value} onchange={() => onCategory(value)} />
        <span>{value}</span>
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>标签</legend>
    {#if tags.length === 0}
      <p class="filter-empty">暂无可用标签</p>
    {:else}
      {#each tags as value}
        <label class="filter-option">
          <input type="checkbox" checked={selectedTags.includes(value)} onchange={() => onTag(value)} />
          <span>{value}</span>
        </label>
      {/each}
    {/if}
  </fieldset>
</aside>

<style>
  .filter-rail { min-width: 0; background: #f7f8fa; border-right: 1px solid #dce2ea; padding: 28px 24px; overflow-y: auto; }
  .search-wrap { position: relative; }
  .search-wrap svg { position: absolute; width: 19px; height: 19px; left: 14px; top: 50%; transform: translateY(-50%); fill: none; stroke: #59677c; stroke-width: 1.7; stroke-linecap: round; pointer-events: none; }
  input[type='search'] { width: 100%; height: 46px; border: 1px solid #aeb9c8; border-radius: 8px; background: #fff; color: #0b1739; padding: 0 14px 0 42px; font: 500 14px/1 var(--font-body); outline: none; transition: border-color .16s, box-shadow .16s; }
  input[type='search']:focus { border-color: #1768e5; box-shadow: 0 0 0 3px rgba(23, 104, 229, .16); }
  fieldset { border: 0; border-top: 1px solid #dce2ea; margin-top: 22px; padding-top: 20px; }
  legend { color: #0b1739; font: 700 15px/1.3 var(--font-body); padding: 0; margin-bottom: 10px; }
  .filter-option { display: flex; align-items: center; gap: 10px; min-height: 38px; color: #27364f; font-size: 14px; cursor: pointer; border-radius: 6px; }
  .filter-option:focus-within { outline: 2px solid #1768e5; outline-offset: 2px; }
  input[type='radio'], input[type='checkbox'] { width: 17px; height: 17px; accent-color: #1768e5; cursor: pointer; }
  .filter-empty { color: #708096; font-size: 13px; line-height: 1.6; }
  @media (max-width: 1080px) {
    .filter-rail { border-right: 0; border-bottom: 1px solid #dce2ea; display: grid; grid-template-columns: minmax(220px, 1fr) 1fr 1fr; gap: 24px; padding: 20px 24px; }
    fieldset { border-top: 0; margin: 0; padding: 0; }
  }
  @media (max-width: 700px) {
    .filter-rail { display: block; padding: 16px; }
    fieldset { border-top: 1px solid #dce2ea; margin-top: 16px; padding-top: 14px; }
  }
</style>
