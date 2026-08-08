<script lang="ts">
  import AssetDetail from '$lib/components/library/AssetDetail.svelte'
  import AssetGrid from '$lib/components/library/AssetGrid.svelte'
  import FilterRail from '$lib/components/library/FilterRail.svelte'
  import { loadCatalog, type CatalogResponse } from '$lib/asset-library'

  let search = $state('')
  let category = $state('')
  let selectedTags = $state<string[]>([])
  let catalog = $state<CatalogResponse | null>(null)
  let selectedId = $state<string | null>(null)
  let loading = $state(true)
  let error = $state('')
  let retry = $state(0)

  const requestKey = $derived(JSON.stringify({ search, category, tags: [...selectedTags].sort(), retry }))
  const selectedItem = $derived(catalog?.items.find((item) => item.id === selectedId) ?? null)
  const hasFilters = $derived(Boolean(search.trim() || category || selectedTags.length))

  $effect(() => {
    requestKey
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      loading = true
      error = ''
      try {
        const next = await loadCatalog({ search, category, tags: selectedTags }, controller.signal)
        catalog = next
        if (!next.items.some((item) => item.id === selectedId)) selectedId = next.items[0]?.id ?? null
      } catch (cause) {
        if (!controller.signal.aborted) {
          error = cause instanceof Error ? cause.message : '资产目录加载失败'
          catalog = null
          selectedId = null
        }
      } finally {
        if (!controller.signal.aborted) loading = false
      }
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  })

  function toggleTag(tag: string): void {
    selectedTags = selectedTags.includes(tag) ? selectedTags.filter((value) => value !== tag) : [...selectedTags, tag]
  }

  function resetFilters(): void {
    search = ''
    category = ''
    selectedTags = []
  }
</script>

<svelte:head>
  <title>模板资产库</title>
  <meta name="description" content="本机单 Owner HTML 汇报模板资产库" />
</svelte:head>

<div class="library-shell">
  <header class="app-header">
    <h1>模板资产库</h1>
    <p>本机 <span aria-hidden="true">·</span> 单 Owner</p>
  </header>

  <main class="workspace">
    <FilterRail
      {search}
      {category}
      {selectedTags}
      categories={catalog?.facets.categories ?? []}
      tags={catalog?.facets.tags ?? []}
      onSearch={(value) => { search = value }}
      onCategory={(value) => { category = value }}
      onTag={toggleTag}
    />

    <section class="results-panel" aria-labelledby="results-heading" aria-busy={loading}>
      <header class="results-header">
        <div>
          <h2 id="results-heading">模板</h2>
          <p>{loading ? '正在读取本机目录…' : `共 ${catalog?.total ?? 0} 个结果`}</p>
        </div>
        {#if hasFilters}
          <button class="reset-button" type="button" onclick={resetFilters}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>
            重置筛选
          </button>
        {/if}
      </header>

      {#if loading}
        <div class="loading-grid" role="status" aria-label="模板加载中">
          {#each [1, 2, 3, 4] as placeholder}
            <div class="skeleton" aria-hidden="true"><div></div><i></i><i></i><i></i></div>
          {/each}
        </div>
      {:else if error}
        <div class="state-panel error-state" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 17h.01"></path></svg>
          <h3>无法加载资产目录</h3>
          <p>{error}</p>
          <button type="button" onclick={() => { retry += 1 }}>重新加载</button>
        </div>
      {:else if catalog && catalog.items.length > 0}
        <AssetGrid items={catalog.items} {selectedId} onSelect={(id) => { selectedId = id }} />
      {:else}
        <div class="state-panel" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.2 16.2 4 4"></path></svg>
          <h3>{hasFilters ? '没有匹配的模板' : '资产库暂为空'}</h3>
          <p>{hasFilters ? '试试减少筛选条件，或换一个搜索词。' : '通过 P04/P05 验证的模板及 PNG 派生物会显示在这里。'}</p>
          {#if hasFilters}<button type="button" onclick={resetFilters}>清除筛选</button>{/if}
        </div>
      {/if}
    </section>

    <AssetDetail item={selectedItem} />
  </main>
</div>

<style>
  :global(html) { background: #fff; }
  :global(body) { min-width: 320px; min-height: 100vh; overflow: hidden; }
  .library-shell { min-height: 100vh; display: grid; grid-template-rows: 72px minmax(0, 1fr); background: #fff; color: #0b1739; }
  .app-header { display: flex; align-items: center; gap: 44px; padding: 0 30px; border-bottom: 1px solid #dce2ea; background: #fff; }
  .app-header h1 { font-size: 25px; line-height: 1; letter-spacing: -.02em; }
  .app-header p { color: #536178; font-size: 14px; }
  .app-header p span { margin: 0 8px; color: #9aa7b8; }
  .workspace { min-height: 0; display: grid; grid-template-columns: 280px minmax(420px, 1fr) minmax(380px, 470px); }
  .results-panel { min-width: 0; padding: 28px; overflow-y: auto; }
  .results-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; min-height: 76px; }
  .results-header h2 { font-size: 24px; line-height: 1.2; }
  .results-header p { color: #637289; font-size: 13px; margin-top: 8px; }
  .reset-button { display: inline-flex; align-items: center; gap: 7px; border: 0; background: transparent; color: #1768e5; border-radius: 6px; padding: 8px; font: 700 13px/1 var(--font-body); cursor: pointer; }
  .reset-button:hover { background: #f0f5fd; }
  .reset-button:focus-visible { outline: 3px solid rgba(23, 104, 229, .24); outline-offset: 2px; }
  .reset-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .loading-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 18px; }
  .skeleton { border: 1px solid #e1e6ed; border-radius: 9px; padding: 13px; overflow: hidden; }
  .skeleton div, .skeleton i { display: block; background: #eef1f5; animation: pulse 1.3s infinite ease-in-out; }
  .skeleton div { aspect-ratio: 16/9; border-radius: 6px; }
  .skeleton i { height: 12px; margin-top: 12px; border-radius: 4px; }
  .skeleton i:nth-child(3) { width: 84%; }
  .skeleton i:nth-child(4) { width: 54%; }
  .state-panel { min-height: 56vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #738197; }
  .state-panel svg { width: 34px; height: 34px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; margin-bottom: 15px; }
  .state-panel h3 { color: #27364f; font-size: 18px; }
  .state-panel p { max-width: 360px; margin-top: 8px; font-size: 13px; line-height: 1.65; }
  .state-panel button { margin-top: 18px; border: 1px solid #1768e5; border-radius: 7px; background: #1768e5; color: #fff; padding: 10px 15px; font: 700 13px/1 var(--font-body); cursor: pointer; }
  .state-panel button:focus-visible { outline: 3px solid rgba(23, 104, 229, .24); outline-offset: 2px; }
  .error-state { color: #a33b3b; }
  @keyframes pulse { 50% { opacity: .5; } }
  @media (max-width: 1320px) {
    .workspace { grid-template-columns: 250px minmax(360px, 1fr) minmax(330px, 400px); }
    .loading-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 1080px) {
    :global(body) { overflow: auto; }
    .library-shell { display: block; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr); }
    .results-panel { overflow: visible; }
  }
  @media (max-width: 700px) {
    .app-header { height: 64px; gap: 18px; padding: 0 16px; }
    .app-header h1 { font-size: 21px; }
    .app-header p { font-size: 12px; }
    .results-panel { padding: 20px 16px; }
  }
  @media (prefers-reduced-motion: reduce) { .skeleton div, .skeleton i { animation: none; } }
</style>
