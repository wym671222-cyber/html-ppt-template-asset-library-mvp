<script lang="ts">
  import AssetDetail from '$lib/components/library/AssetDetail.svelte'
  import AssetGrid from '$lib/components/library/AssetGrid.svelte'
  import FilterRail from '$lib/components/library/FilterRail.svelte'
  import { loadCatalog, type CatalogResponse } from '$lib/asset-library'
  import { addTemplate, copyItem, createPresentation, createPresentationExport, deleteItem, loadPresentationExports, loadPresentations, moveItem, renamePresentation, reviseOverrides, safeExportUrl, type Presentation, type PresentationExport } from '$lib/presentations'

  let search = $state('')
  let category = $state('')
  let selectedTags = $state<string[]>([])
  let catalog = $state<CatalogResponse | null>(null)
  let selectedId = $state<string | null>(null)
  let loading = $state(true)
  let error = $state('')
  let retry = $state(0)
  let presentations = $state<Presentation[]>([])
  let selectedPresentationId = $state<string | null>(null)
  let presentationLoading = $state(true)
  let presentationError = $state('')
  let presentationNotice = $state('')
  let newPresentationName = $state('本机汇报')
  let renameValue = $state('')
  let exportRecords = $state<PresentationExport[]>([])
  let exportLoading = $state(false)
  let exportError = $state('')
  let exportNotice = $state('')
  let exportStatus: HTMLElement | undefined = $state()

  const requestKey = $derived(JSON.stringify({ search, category, tags: [...selectedTags].sort(), retry }))
  const selectedItem = $derived(catalog?.items.find((item) => item.id === selectedId) ?? null)
  const hasFilters = $derived(Boolean(search.trim() || category || selectedTags.length))
  const selectedPresentation = $derived(presentations.find((presentation) => presentation.id === selectedPresentationId) ?? null)

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

  $effect(() => {
    const presentationId = selectedPresentationId
    if (!presentationId) {
      exportRecords = []
      exportLoading = false
      exportError = ''
      return
    }
    let active = true
    exportLoading = true
    exportError = ''
    void loadPresentationExports(presentationId).then((next) => {
      if (active) exportRecords = next
    }).catch((cause) => {
      if (active) exportError = cause instanceof Error ? cause.message : '导出记录加载失败'
    }).finally(() => { if (active) exportLoading = false })
    return () => { active = false }
  })

  $effect(() => {
    let active = true
    void loadPresentations().then((next) => {
      if (!active) return
      presentations = next
      selectedPresentationId = next[0]?.id ?? null
      renameValue = next[0]?.name ?? ''
    }).catch((cause) => {
      if (active) presentationError = cause instanceof Error ? cause.message : '汇报加载失败'
    }).finally(() => { if (active) presentationLoading = false })
    return () => { active = false }
  })

  function toggleTag(tag: string): void {
    selectedTags = selectedTags.includes(tag) ? selectedTags.filter((value) => value !== tag) : [...selectedTags, tag]
  }

  function resetFilters(): void {
    search = ''
    category = ''
    selectedTags = []
  }

  function applyPresentation(next: Presentation): void {
    presentations = [next, ...presentations.filter((presentation) => presentation.id !== next.id)]
    selectedPresentationId = next.id
    renameValue = next.name
    presentationError = ''
  }

  async function perform(action: () => Promise<Presentation>, message: string): Promise<void> {
    presentationNotice = ''
    try { applyPresentation(await action()); presentationNotice = message }
    catch (cause) {
      presentationError = cause instanceof Error ? cause.message : '汇报写入失败'
      if (/已变更|has changed/i.test(presentationError)) {
        try {
          const latest = await loadPresentations()
          presentations = latest
          const current = latest.find((item) => item.id === selectedPresentationId) ?? latest[0] ?? null
          selectedPresentationId = current?.id ?? null
          renameValue = current?.name ?? ''
          presentationNotice = '检测到较新版本，已重新加载；请确认后再试。'
        } catch { /* Preserve the conflict message when recovery is unavailable. */ }
      }
    }
  }

  async function exportPresentation(): Promise<void> {
    if (!selectedPresentation || selectedPresentation.items.length === 0 || exportLoading) return
    exportLoading = true
    exportError = ''
    exportNotice = ''
    try {
      const result = await createPresentationExport(selectedPresentation)
      exportRecords = [result, ...exportRecords.filter((item) => item.id !== result.id)]
      exportNotice = `Revision ${result.presentationRevision} 已生成离线 HTML/ZIP。`
      requestAnimationFrame(() => exportStatus?.focus())
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : '本机导出失败'
      if (/已变更|has changed|revision/i.test(exportError)) {
        try {
          const latest = await loadPresentations()
          presentations = latest
          const current = latest.find((item) => item.id === selectedPresentationId) ?? latest[0] ?? null
          selectedPresentationId = current?.id ?? null
          renameValue = current?.name ?? ''
          exportRecords = current ? await loadPresentationExports(current.id) : []
          exportNotice = '检测到较新 revision，已重新加载；请确认项目后再导出。'
          requestAnimationFrame(() => exportStatus?.focus())
        } catch { /* Preserve the bounded export error when recovery is unavailable. */ }
      }
    } finally { exportLoading = false }
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

      <section class="presentation-panel" aria-labelledby="presentation-heading" aria-busy={presentationLoading}>
        <header>
          <div><h2 id="presentation-heading">汇报购物车</h2><p>固定模板版本 · 本机持久化</p></div>
          {#if selectedItem && selectedPresentation}
            <button type="button" onclick={() => perform(() => addTemplate(selectedPresentation.id, selectedItem.version.id, selectedPresentation.revision), '已加入汇报。')}>加入所选模板</button>
          {/if}
        </header>
        {#if presentationLoading}
          <p role="status">正在读取本机汇报…</p>
        {:else if presentationError}
          <div class="presentation-error" role="alert"><p>{presentationError}</p><button type="button" onclick={() => { presentationLoading = true; loadPresentations().then((next) => { presentations = next; selectedPresentationId = next[0]?.id ?? null; renameValue = next[0]?.name ?? ''; presentationError = '' }).catch((cause) => { presentationError = cause instanceof Error ? cause.message : '汇报加载失败' }).finally(() => { presentationLoading = false }) }}>重新加载</button></div>
        {:else if !selectedPresentation}
          <form onsubmit={(event) => { event.preventDefault(); void perform(() => createPresentation(newPresentationName), '已创建本机汇报。') }}>
            <label>新汇报名称 <input bind:value={newPresentationName} maxlength="120" /></label><button type="submit">创建汇报</button>
          </form>
        {:else}
          <div class="presentation-controls">
            <label>当前汇报 <select value={selectedPresentation.id} onchange={(event) => { const id = (event.currentTarget as HTMLSelectElement).value; selectedPresentationId = id; renameValue = presentations.find((item) => item.id === id)?.name ?? '' }}>
              {#each presentations as presentation}<option value={presentation.id}>{presentation.name}</option>{/each}
            </select></label>
            <form onsubmit={(event) => { event.preventDefault(); void perform(() => renamePresentation(selectedPresentation.id, renameValue, selectedPresentation.revision), '名称已更新。') }}><label>名称 <input bind:value={renameValue} maxlength="120" /></label><button type="submit">重命名</button></form>
          </div>
          {#if selectedPresentation.items.length}
            <ol class="cart-list">
              {#each selectedPresentation.items as item}
                <li>
                  <strong>{item.position + 1}. {item.template.title} <small>v{item.template.versionNumber}</small></strong>
                  <div class="item-actions"><button type="button" aria-label={`上移 ${item.template.title}`} disabled={item.position === 0} onclick={() => perform(() => moveItem(selectedPresentation.id, item.id, item.position - 1, selectedPresentation.revision), '排序已更新。')}>↑</button><button type="button" aria-label={`下移 ${item.template.title}`} disabled={item.position === selectedPresentation.items.length - 1} onclick={() => perform(() => moveItem(selectedPresentation.id, item.id, item.position + 1, selectedPresentation.revision), '排序已更新。')}>↓</button><button type="button" onclick={() => perform(() => copyItem(selectedPresentation.id, item.id, selectedPresentation.revision), '已复制项目。')}>复制</button><button type="button" onclick={() => perform(() => deleteItem(selectedPresentation.id, item.id, selectedPresentation.revision), '已删除项目。')}>删除</button></div>
                  <label class="override">标题覆盖 <input value={item.slotOverrides.title ?? ''} maxlength="120" onblur={(event) => { const title = (event.currentTarget as HTMLInputElement).value; if (title !== (item.slotOverrides.title ?? '')) void perform(() => reviseOverrides(selectedPresentation.id, item.id, title ? { ...item.slotOverrides, title } : Object.fromEntries(Object.entries(item.slotOverrides).filter(([key]) => key !== 'title')), selectedPresentation.revision), '覆盖内容已更新。') }} /></label>
                </li>
              {/each}
            </ol>
          {:else}<p class="cart-empty">购物车为空。选择上方模板后加入此汇报。</p>{/if}
          <p class="revision">Revision {selectedPresentation.revision}</p>
          <section class="export-panel" aria-labelledby="export-heading" aria-busy={exportLoading}>
            <header><div><h3 id="export-heading">离线导出</h3><p>固定 revision · 可审计 manifest · 本机 CAS</p></div><button type="button" disabled={selectedPresentation.items.length === 0 || exportLoading} onclick={() => { void exportPresentation() }}>{exportLoading ? '正在生成…' : '生成 HTML/ZIP'}</button></header>
            {#if exportLoading && exportRecords.length === 0}
              <p role="status">正在读取或生成本机导出…</p>
            {:else if exportError}
              <div class="export-error" role="alert"><p>{exportError}</p><button type="button" onclick={() => { exportLoading = true; loadPresentationExports(selectedPresentation.id).then((next) => { exportRecords = next; exportError = '' }).catch((cause) => { exportError = cause instanceof Error ? cause.message : '导出记录加载失败' }).finally(() => { exportLoading = false }) }}>重新读取</button></div>
            {:else if exportRecords.length === 0}
              <p class="export-empty">暂无导出。加入至少一个模板后，可生成完全离线的 HTML/ZIP。</p>
            {:else}
              <ul class="export-list">
                {#each exportRecords as record}
                  <li><span>Revision {record.presentationRevision} · {record.itemCount} 项</span><div><a href={safeExportUrl(record.manifestUrl)}>Manifest</a><a href={safeExportUrl(record.htmlUrl)} download>HTML</a><a href={safeExportUrl(record.zipUrl)} download>ZIP</a></div></li>
                {/each}
              </ul>
            {/if}
            {#if exportNotice}<p class="export-notice" role="status" tabindex="-1" bind:this={exportStatus}>{exportNotice}</p>{/if}
          </section>
        {/if}
        {#if presentationNotice}<p class="presentation-notice" role="status">{presentationNotice}</p>{/if}
      </section>
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
  .presentation-panel { margin-top: 30px; border-top: 1px solid #dce2ea; padding-top: 24px; }
  .presentation-panel > header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .presentation-panel > header h2 { font-size: 18px; }
  .presentation-panel > header p, .revision, .cart-empty, .presentation-notice { color: #637289; font-size: 12px; margin-top: 4px; }
  .presentation-panel button { border: 1px solid #b8c7dc; border-radius: 6px; background: #fff; color: #0b356f; padding: 7px 9px; font: 700 12px/1 var(--font-body); cursor: pointer; }
  .presentation-panel button:hover:not(:disabled) { border-color: #1768e5; background: #f1f6ff; }
  .presentation-panel button:focus-visible, .presentation-panel input:focus-visible, .presentation-panel select:focus-visible { outline: 3px solid rgba(23, 104, 229, .24); outline-offset: 1px; }
  .presentation-panel button:disabled { opacity: .45; cursor: not-allowed; }
  .presentation-panel form, .presentation-controls { display: flex; align-items: end; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .presentation-panel label { display: grid; gap: 5px; color: #536178; font-size: 12px; }
  .presentation-panel input, .presentation-panel select { min-height: 32px; border: 1px solid #cbd3df; border-radius: 5px; background: #fff; color: #0b1739; padding: 0 8px; font: inherit; }
  .cart-list { display: grid; gap: 8px; list-style: none; margin: 16px 0 0; padding: 0; }
  .cart-list li { border: 1px solid #dce2ea; border-radius: 7px; padding: 10px; }
  .cart-list strong { display: block; color: #0b1739; font-size: 13px; }
  .cart-list small { color: #637289; font-weight: 400; }
  .item-actions { display: flex; gap: 5px; margin-top: 9px; }
  .override { margin-top: 10px; }
  .override input { width: 100%; }
  .presentation-error { display: flex; gap: 12px; align-items: center; color: #a33b3b; margin-top: 14px; }
  .presentation-notice { color: #1768e5; }
  .export-panel { margin-top: 18px; padding: 14px; border: 1px solid #d7e1ee; border-radius: 8px; background: #f8fafc; }
  .export-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .export-panel h3 { font-size: 14px; }
  .export-panel header p, .export-empty, .export-notice { margin-top: 4px; color: #637289; font-size: 12px; }
  .export-list { display: grid; gap: 7px; margin: 12px 0 0; padding: 0; list-style: none; }
  .export-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px; border: 1px solid #dce2ea; border-radius: 6px; background: #fff; color: #45556d; font-size: 12px; }
  .export-list li div { display: flex; gap: 8px; }
  .export-list a { color: #155fcf; font-weight: 700; }
  .export-list a:focus-visible, .export-notice:focus-visible { outline: 3px solid rgba(23, 104, 229, .24); outline-offset: 2px; }
  .export-error { display: flex; align-items: center; gap: 10px; margin-top: 10px; color: #a33b3b; font-size: 12px; }
  .export-notice { color: #1768e5; }
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
    .export-panel > header, .export-list li { align-items: flex-start; flex-direction: column; }
  }
  @media (prefers-reduced-motion: reduce) { .skeleton div, .skeleton i { animation: none; } }
</style>
