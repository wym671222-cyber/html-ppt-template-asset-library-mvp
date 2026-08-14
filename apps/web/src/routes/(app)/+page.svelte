<script lang="ts">
  import { goto } from '$app/navigation'
  import AssetDetail from '$lib/components/library/AssetDetail.svelte'
  import AssetGrid from '$lib/components/library/AssetGrid.svelte'
  import FilterRail from '$lib/components/library/FilterRail.svelte'
  import ThemeSwitcher from '$lib/components/library/ThemeSwitcher.svelte'
  import { loadCatalog, type CatalogItem, type CatalogResponse } from '$lib/asset-library'
  import { addTemplate, createPresentation, createPresentationExport, deleteItem, loadPresentationExports, loadPresentations, moveItem, renamePresentation, safeExportUrl, type Presentation, type PresentationExport } from '$lib/presentations'
  import { api } from '$lib/api'

  const PAGE_SIZE = 8
  let { data }: { data: { user: import('$lib/auth').SessionUser } } = $props()

  let search = $state('')
  let category = $state('')
  let selectedTags = $state<string[]>([])
  let status = $state<'' | 'verified' | 'available'>('')
  let sort = $state<'updated-desc' | 'title-asc'>('updated-desc')
  let page = $state(1)
  let view = $state<'grid' | 'list'>('grid')
  let filtersOpen = $state(false)
  let catalog = $state<CatalogResponse | null>(null)
  let loading = $state(true)
  let error = $state('')
  let retry = $state(0)
  let detailItem = $state<CatalogItem | null>(null)
  let detailOpen = $state(false)

  let presentations = $state<Presentation[]>([])
  let selectedPresentationId = $state<string | null>(null)
  let presentationLoading = $state(true)
  let presentationBusy = $state(false)
  let presentationError = $state('')
  let presentationNotice = $state('')
  let newPresentationName = $state('本机汇报')
  let renameValue = $state('')
  let draggedItemId = $state<string | null>(null)
  let exportRecords = $state<PresentationExport[]>([])
  let exportLoading = $state(false)
  let exportError = $state('')
  let exportNotice = $state('')
  let exportHistoryOpen = $state(false)
  let exportStatus: HTMLElement | undefined = $state()

  const offset = $derived((page - 1) * PAGE_SIZE)
  const requestKey = $derived(JSON.stringify({ search, category, tags: [...selectedTags].sort(), status, sort, offset, retry }))
  const selectedPresentation = $derived(presentations.find((presentation) => presentation.id === selectedPresentationId) ?? null)
  const selectedVersionIds = $derived(new Set(selectedPresentation?.items.map((item) => item.templateVersionId) ?? []))
  const hasFilters = $derived(Boolean(search.trim() || category || selectedTags.length || status))
  const pageCount = $derived(Math.max(1, Math.ceil((catalog?.total ?? 0) / PAGE_SIZE)))

  $effect(() => {
    requestKey
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      loading = true
      error = ''
      try {
        const next = await loadCatalog({ search, category, tags: selectedTags, status, sort, limit: PAGE_SIZE, offset }, controller.signal)
        catalog = next
        if (next.total > 0 && next.offset >= next.total) page = Math.max(1, Math.ceil(next.total / PAGE_SIZE))
      } catch (cause) {
        if (!controller.signal.aborted) { error = cause instanceof Error ? cause.message : '资产目录加载失败'; catalog = null }
      } finally { if (!controller.signal.aborted) loading = false }
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  })

  $effect(() => {
    let active = true
    void loadPresentations().then((next) => {
      if (!active) return
      presentations = next
      selectedPresentationId = next[0]?.id ?? null
      renameValue = next[0]?.name ?? ''
    }).catch((cause) => { if (active) presentationError = cause instanceof Error ? cause.message : '汇报加载失败' })
      .finally(() => { if (active) presentationLoading = false })
    return () => { active = false }
  })

  $effect(() => {
    const id = selectedPresentationId
    if (!id) { exportRecords = []; exportLoading = false; return }
    let active = true
    exportLoading = true
    void loadPresentationExports(id).then((next) => { if (active) exportRecords = next })
      .catch((cause) => { if (active) exportError = cause instanceof Error ? cause.message : '导出记录加载失败' })
      .finally(() => { if (active) exportLoading = false })
    return () => { active = false }
  })

  function resetFilters(): void { search = ''; category = ''; selectedTags = []; status = ''; page = 1 }
  function toggleTag(tag: string): void { selectedTags = selectedTags.includes(tag) ? selectedTags.filter((value) => value !== tag) : [...selectedTags, tag]; page = 1 }
  function applyPresentation(next: Presentation): void {
    presentations = [next, ...presentations.filter((presentation) => presentation.id !== next.id)]
    selectedPresentationId = next.id
    renameValue = next.name
    presentationError = ''
  }

  async function runPresentation(action: () => Promise<Presentation>, message: string): Promise<void> {
    if (presentationBusy) return
    presentationBusy = true
    presentationNotice = ''
    presentationError = ''
    try { applyPresentation(await action()); presentationNotice = message }
    catch (cause) {
      presentationError = cause instanceof Error ? cause.message : '汇报写入失败'
      if (/已变更|has changed|revision/i.test(presentationError)) {
        try {
          const latest = await loadPresentations()
          presentations = latest
          const current = latest.find((item) => item.id === selectedPresentationId) ?? latest[0] ?? null
          selectedPresentationId = current?.id ?? null
          renameValue = current?.name ?? ''
          presentationError = ''
          presentationNotice = '检测到较新版本，已重新加载；请确认后再试。'
        } catch { /* Keep the bounded conflict error. */ }
      }
    } finally { presentationBusy = false }
  }

  async function toggleTemplate(item: CatalogItem): Promise<void> {
    if (!selectedPresentation) return
    const existing = selectedPresentation.items.find((entry) => entry.templateVersionId === item.version.id)
    await runPresentation(
      () => existing
        ? deleteItem(selectedPresentation.id, existing.id, selectedPresentation.revision)
        : addTemplate(selectedPresentation.id, item.version.id, selectedPresentation.revision),
      existing ? '已移出汇报。' : '已加入汇报。',
    )
  }

  async function toggleCurrentPage(): Promise<void> {
    if (!selectedPresentation || !catalog || presentationBusy) return
    presentationBusy = true
    presentationError = ''
    try {
      let next = selectedPresentation
      const allSelected = catalog.items.length > 0 && catalog.items.every((item) => next.items.some((entry) => entry.templateVersionId === item.version.id))
      if (allSelected) {
        const pageVersionIds = new Set(catalog.items.map((item) => item.version.id))
        for (const entry of [...next.items].reverse()) if (pageVersionIds.has(entry.templateVersionId)) next = await deleteItem(next.id, entry.id, next.revision)
      } else {
        for (const item of catalog.items) if (!next.items.some((entry) => entry.templateVersionId === item.version.id)) next = await addTemplate(next.id, item.version.id, next.revision)
      }
      applyPresentation(next)
      presentationNotice = allSelected ? '已移出当前页模板。' : '当前页模板已加入汇报。'
    } catch (cause) { presentationError = cause instanceof Error ? cause.message : '批量更新失败' }
    finally { presentationBusy = false }
  }

  async function clearPresentation(): Promise<void> {
    if (!selectedPresentation || presentationBusy) return
    presentationBusy = true
    presentationError = ''
    try {
      let next = selectedPresentation
      for (const item of [...next.items].reverse()) next = await deleteItem(next.id, item.id, next.revision)
      applyPresentation(next)
      presentationNotice = '已清空当前汇报。'
    } catch (cause) { presentationError = cause instanceof Error ? cause.message : '清空汇报失败' }
    finally { presentationBusy = false }
  }

  async function exportPresentation(): Promise<void> {
    if (!selectedPresentation || selectedPresentation.items.length === 0 || exportLoading) return
    exportLoading = true; exportError = ''; exportNotice = ''
    try {
      const result = await createPresentationExport(selectedPresentation)
      exportRecords = [result, ...exportRecords.filter((record) => record.id !== result.id)]
      exportHistoryOpen = true
      exportNotice = `Revision ${result.presentationRevision} 已生成离线 HTML/ZIP。`
      requestAnimationFrame(() => exportStatus?.focus())
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : '本机导出失败'
      exportHistoryOpen = true
      if (/已变更|has changed|revision/i.test(exportError)) {
        try {
          const latest = await loadPresentations()
          presentations = latest
          const current = latest.find((item) => item.id === selectedPresentationId) ?? latest[0] ?? null
          selectedPresentationId = current?.id ?? null
          renameValue = current?.name ?? ''
          exportRecords = current ? await loadPresentationExports(current.id) : []
          exportError = ''
          exportNotice = '检测到较新 revision，已重新加载；请确认项目后再导出。'
          requestAnimationFrame(() => exportStatus?.focus())
        } catch { /* Keep the bounded export error when recovery is unavailable. */ }
      }
    }
    finally { exportLoading = false }
  }

  async function renameIfChanged(): Promise<void> {
    if (!selectedPresentation || renameValue === selectedPresentation.name || !renameValue.trim()) return
    await runPresentation(() => renamePresentation(selectedPresentation.id, renameValue, selectedPresentation.revision), '汇报名称已更新。')
  }

  async function logout(): Promise<void> { try { await api.p15Logout() } finally { await goto('/login') } }
  function closeDetail(): void { detailOpen = false; detailItem = null }
  function handleRetired(): void { closeDetail(); retry += 1 }

  function pageNumbers(): number[] {
    const total = pageCount
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
    const start = Math.max(1, Math.min(page - 2, total - 4))
    return Array.from({ length: 5 }, (_, index) => start + index)
  }
</script>

<svelte:head><title>HTML 汇报模板资产库</title><meta name="description" content="HTML 汇报模板资产库三栏工作台" /></svelte:head>

<div class="library-shell">
  <header class="app-header">
    <a class="brand" href="/" aria-label="HTML 汇报模板资产库首页"><span class="brand-mark">&lt;/&gt;</span><strong>HTML 汇报模板资产库</strong></a>
    <p class="metrics">模板 {catalog?.total ?? 0} · 汇报 {presentations.length}</p>
    <label class="global-search"><span class="sr-only">搜索模板名称、分类或标签</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.2 16.2 4 4"></path></svg><input type="search" value={search} maxlength="100" placeholder="搜索模板名称 / 分类 / 标签…" oninput={(event) => { search = event.currentTarget.value; page = 1 }} /></label>
    <span class="result-count">共 {catalog?.total ?? 0} 个结果</span>
    {#if data.user.role === 'admin'}<a class="import-link" href="/admin#template-import">⇧ 导入 HTML 模板</a>{/if}
    <button class="clear-filters" type="button" onclick={resetFilters}>清空筛选</button>
    <ThemeSwitcher />
    <div class="account"><span>{data.user.username}</span>{#if data.user.role === 'admin'}<a href="/admin">管理</a>{/if}<button type="button" onclick={() => void logout()}>退出</button></div>
  </header>

  <main class="workspace">
    <div class:open={filtersOpen} class="filter-drawer"><FilterRail {category} {selectedTags} {status} categories={catalog?.facets.categories ?? []} tags={catalog?.facets.tags ?? []} statuses={catalog?.facets.statuses ?? []} onCategory={(value) => { category = value; page = 1 }} onTag={toggleTag} onStatus={(value) => { status = value; page = 1 }} onClear={resetFilters} onClose={() => { filtersOpen = false }} /></div>
    {#if filtersOpen}<button class="drawer-backdrop" aria-label="关闭筛选" onclick={() => { filtersOpen = false }}></button>{/if}

    <section class="results-panel" aria-labelledby="results-heading" aria-busy={loading}>
      <header class="results-toolbar">
        <div><button class="mobile-filter" type="button" onclick={() => { filtersOpen = true }}>筛选</button><label class="select-page"><input type="checkbox" checked={Boolean(catalog?.items.length && catalog.items.every((item) => selectedVersionIds.has(item.version.id)))} onchange={() => { void toggleCurrentPage() }} /> 全选当前页</label><select bind:value={sort} aria-label="模板排序" onchange={() => { page = 1 }}><option value="updated-desc">最新更新</option><option value="title-asc">名称排序</option></select></div>
        <div class="view-toggle"><button class:active={view === 'grid'} type="button" aria-label="网格视图" onclick={() => { view = 'grid' }}>▦</button><button class:active={view === 'list'} type="button" aria-label="列表视图" onclick={() => { view = 'list' }}>☷</button></div>
      </header>
      <h1 id="results-heading" class="sr-only">模板结果</h1>
      {#if loading}
        <div class="loading-grid" role="status" aria-label="模板加载中">{#each [1,2,3,4] as value}<div class="skeleton" aria-hidden="true"><div></div><i></i><i></i></div>{/each}</div>
      {:else if error}
        <div class="state-panel error-state" role="alert"><h2>无法加载资产目录</h2><p>{error}</p><button type="button" onclick={() => { retry += 1 }}>重新加载</button></div>
      {:else if catalog && catalog.items.length > 0}
        <AssetGrid items={catalog.items} selectedIds={selectedVersionIds} {view} onToggle={(item) => { void toggleTemplate(item) }} onPreview={(item) => { detailItem = item; detailOpen = true }} />
      {:else}
        <div class="state-panel" role="status"><h2>{hasFilters ? '没有匹配的模板' : '资产库暂为空'}</h2><p>{hasFilters ? '减少筛选条件或更换搜索词。' : '通过安全预览验证的模板会显示在这里。'}</p>{#if hasFilters}<button type="button" onclick={resetFilters}>清除筛选</button>{/if}</div>
      {/if}
      <footer class="pagination"><span>共 {catalog?.total ?? 0} 项</span><nav aria-label="目录分页"><button type="button" disabled={page <= 1} onclick={() => { page -= 1 }}>‹</button>{#each pageNumbers() as value}<button class:current={page === value} type="button" aria-current={page === value ? 'page' : undefined} onclick={() => { page = value }}>{value}</button>{/each}<button type="button" disabled={page >= pageCount} onclick={() => { page += 1 }}>›</button></nav><span>每页 {PAGE_SIZE} 条</span></footer>
    </section>

    <aside class="cart-panel" aria-labelledby="cart-heading" aria-busy={presentationLoading || presentationBusy}>
      <header><h2 id="cart-heading">已选汇报 <span>{selectedPresentation?.items.length ?? 0}</span></h2><button type="button" disabled={!selectedPresentation?.items.length || presentationBusy} onclick={() => { void clearPresentation() }}>清空</button></header>
      <div class="cart-body">
        {#if presentationLoading}<p class="cart-state" role="status">正在读取汇报…</p>
        {:else if presentationError}<p class="cart-error" role="alert">{presentationError}</p>
        {:else if !selectedPresentation}
          <form class="create-form" onsubmit={(event) => { event.preventDefault(); void runPresentation(() => createPresentation(newPresentationName), '已创建汇报。') }}><label>汇报名称<input bind:value={newPresentationName} maxlength="120" /></label><button type="submit">创建汇报</button></form>
        {:else}
          <label class="presentation-select">当前汇报<select value={selectedPresentation.id} onchange={(event) => { const id = event.currentTarget.value; selectedPresentationId = id; renameValue = presentations.find((item) => item.id === id)?.name ?? '' }}>{#each presentations as presentation}<option value={presentation.id}>{presentation.name}</option>{/each}</select></label>
          <label class="report-name">汇报名称<input bind:value={renameValue} maxlength="120" onblur={() => { void renameIfChanged() }} /><small>{renameValue.length}/120</small></label>
          <p class="reorder-hint">在下方列表中拖拽可调整顺序</p>
          {#if selectedPresentation.items.length}
            <ol class="cart-list">
              {#each selectedPresentation.items as item (item.id)}
                <li draggable="true" ondragstart={() => { draggedItemId = item.id }} ondragend={() => { draggedItemId = null }} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); if (draggedItemId && draggedItemId !== item.id) void runPresentation(() => moveItem(selectedPresentation.id, draggedItemId!, item.position, selectedPresentation.revision), '排序已更新。') }}>
                  <span class="drag" aria-hidden="true">⠿</span><span class="position">{item.position + 1}</span><span class="mini-thumb"></span><strong>{item.template.title}<small>v{item.template.versionNumber}</small></strong>
                  <div><button type="button" aria-label={`上移 ${item.template.title}`} disabled={item.position === 0 || presentationBusy} onclick={() => { void runPresentation(() => moveItem(selectedPresentation.id, item.id, item.position - 1, selectedPresentation.revision), '排序已更新。') }}>↑</button><button type="button" aria-label={`下移 ${item.template.title}`} disabled={item.position === selectedPresentation.items.length - 1 || presentationBusy} onclick={() => { void runPresentation(() => moveItem(selectedPresentation.id, item.id, item.position + 1, selectedPresentation.revision), '排序已更新。') }}>↓</button><button type="button" aria-label={`移除 ${item.template.title}`} onclick={() => { void runPresentation(() => deleteItem(selectedPresentation.id, item.id, selectedPresentation.revision), '已移出汇报。') }}>×</button></div>
                </li>
              {/each}
            </ol>
          {:else}<p class="cart-state">从中栏选择模板加入当前汇报。</p>{/if}
          <button class="history-toggle" type="button" aria-expanded={exportHistoryOpen} onclick={() => { exportHistoryOpen = !exportHistoryOpen }}>导出历史 <span>{exportHistoryOpen ? '⌃' : '⌄'}</span></button>
          {#if exportHistoryOpen}
            {#if exportError}<p class="cart-error" role="alert">{exportError}</p>{:else if exportRecords.length}<ul class="export-list">{#each exportRecords as record}<li><span>Revision {record.presentationRevision} · {record.itemCount} 项</span><div><a href={safeExportUrl(record.htmlUrl)} download>HTML</a><a href={safeExportUrl(record.zipUrl)} download>ZIP</a></div></li>{/each}</ul>{:else}<p class="cart-state">暂无导出记录。</p>{/if}
          {/if}
          {#if presentationNotice}<p class="cart-notice" role="status">{presentationNotice}</p>{/if}
          {#if exportNotice}<p class="cart-notice" role="status" tabindex="-1" bind:this={exportStatus}>{exportNotice}</p>{/if}
        {/if}
      </div>
      <footer><button type="button" disabled={!selectedPresentation?.items.length || presentationBusy} onclick={() => { void clearPresentation() }}>清空</button><button class="export-button" type="button" disabled={!selectedPresentation?.items.length || exportLoading} onclick={() => { void exportPresentation() }}>{exportLoading ? '正在生成…' : '生成 HTML / ZIP ↓'}</button></footer>
    </aside>
  </main>
  <AssetDetail item={detailItem} open={detailOpen} isAdmin={data.user.role === 'admin'} onClose={closeDetail} onRetired={handleRetired} />
</div>

<style>
  :global(html) { background: var(--lib-bg, #fff); }
  :global(body) { min-width: 320px; min-height: 100vh; overflow: hidden; }
  .library-shell { height: 100vh; display: grid; grid-template-rows: 72px minmax(0,1fr); background: var(--lib-bg); color: var(--lib-text); }
  .app-header { min-width: 0; display: grid; grid-template-columns: auto auto minmax(260px,1fr) auto auto auto auto auto; align-items: center; gap: 13px; padding: 0 16px; border-bottom: 1px solid var(--lib-border); background: var(--lib-surface); }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--lib-text-strong); text-decoration: none; white-space: nowrap; }
  .brand strong { font-size: 19px; letter-spacing: -.02em; }
  .brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--lib-accent); border-radius: 5px; color: var(--lib-accent); font: 700 13px ui-monospace, monospace; }
  .metrics, .result-count { color: var(--lib-muted); font-size: 12px; white-space: nowrap; }
  .global-search { position: relative; min-width: 0; }
  .global-search svg { position: absolute; left: 13px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); fill: none; stroke: var(--lib-muted); stroke-width: 1.7; }
  .global-search input { width: 100%; height: 40px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface-soft); color: var(--lib-text); padding: 0 12px 0 40px; font: 500 13px/1 var(--font-body); }
  .global-search input:focus { outline: 3px solid var(--lib-focus); border-color: var(--lib-accent); }
  .import-link, .clear-filters { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface); color: var(--lib-text); padding: 0 11px; font: 700 12px/1 var(--font-body); text-decoration: none; white-space: nowrap; cursor: pointer; }
  .import-link { border-color: var(--lib-accent); color: var(--lib-accent-strong); }
  .account { display: flex; align-items: center; gap: 8px; color: var(--lib-muted); font-size: 12px; white-space: nowrap; }
  .account a, .account button { border: 0; background: transparent; color: var(--lib-text); font: 600 12px/1 var(--font-body); text-decoration: none; cursor: pointer; }
  .app-header a:focus-visible, .app-header button:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  .workspace { min-height: 0; display: grid; grid-template-columns: 280px minmax(500px,1fr) 390px; }
  .filter-drawer { min-height: 0; }
  .results-panel { min-width: 0; overflow-y: auto; padding: 16px 14px 0; background: var(--lib-bg); }
  .results-toolbar { min-height: 48px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .results-toolbar > div { display: flex; align-items: center; gap: 12px; }
  .select-page { display: inline-flex; align-items: center; gap: 7px; color: var(--lib-text); font-size: 12px; }
  .select-page input { width: 16px; height: 16px; accent-color: var(--lib-accent); }
  select { min-height: 34px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); padding: 0 30px 0 10px; font: 600 12px var(--font-body); }
  select:focus-visible { outline: 3px solid var(--lib-focus); }
  .view-toggle { padding: 2px; border: 1px solid var(--lib-border); border-radius: 6px; }
  .view-toggle button { width: 32px; height: 29px; border: 0; border-radius: 4px; background: transparent; color: var(--lib-muted); font-size: 19px; cursor: pointer; }
  .view-toggle button.active { background: var(--lib-accent-fill); color: #fff; }
  .mobile-filter { display: none; min-height: 34px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); padding: 0 10px; font-weight: 700; }
  .loading-grid { display: grid; grid-template-columns: repeat(2,minmax(260px,1fr)); gap: 14px; }
  .skeleton { overflow: hidden; border: 1px solid var(--lib-border); border-radius: 8px; padding: 12px; }
  .skeleton div, .skeleton i { display: block; border-radius: 5px; background: var(--lib-surface-soft); animation: pulse 1.3s infinite ease-in-out; }
  .skeleton div { aspect-ratio: 16/9; }.skeleton i { height: 12px; margin-top: 12px; }.skeleton i:last-child { width: 60%; }
  .state-panel { min-height: 62vh; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--lib-muted); }
  .state-panel h2 { color: var(--lib-text-strong); font-size: 19px; }.state-panel p { max-width: 360px; margin-top: 8px; font-size: 13px; }
  .state-panel button { margin-top: 16px; border: 1px solid var(--lib-accent-fill); border-radius: 6px; background: var(--lib-accent-fill); color: #fff; padding: 9px 13px; font-weight: 700; }
  .error-state { color: var(--lib-danger); }
  .pagination { min-height: 70px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; color: var(--lib-muted); font-size: 12px; }
  .pagination > span:last-child { justify-self: end; padding: 8px 11px; border: 1px solid var(--lib-border); border-radius: 5px; }
  .pagination nav { display: flex; gap: 5px; }
  .pagination button { min-width: 30px; height: 30px; border: 1px solid var(--lib-border); border-radius: 5px; background: var(--lib-surface); color: var(--lib-text); cursor: pointer; }
  .pagination button.current { border-color: var(--lib-accent); background: var(--lib-accent-soft); color: var(--lib-accent-strong); }.pagination button:disabled { opacity: .4; }
  .cart-panel { min-width: 0; min-height: 0; display: grid; grid-template-rows: 62px minmax(0,1fr) 68px; border-left: 1px solid var(--lib-border); background: var(--lib-rail); }
  .cart-panel > header { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--lib-border); }
  .cart-panel h2 { color: var(--lib-text-strong); font-size: 16px; }.cart-panel h2 span { display: inline-grid; place-items: center; min-width: 24px; height: 24px; margin-left: 5px; border-radius: 999px; background: var(--lib-accent-fill); color: #fff; font-size: 12px; }
  .cart-panel > header button, .history-toggle { border: 0; background: transparent; color: var(--lib-accent); font-weight: 700; cursor: pointer; }
  .cart-body { overflow-y: auto; padding: 15px 18px; }
  .presentation-select, .report-name { display: grid; gap: 6px; color: var(--lib-text); font-size: 12px; }
  .presentation-select { margin-bottom: 12px; }.presentation-select select { width: 100%; }
  .report-name { position: relative; }.report-name input, .create-form input { height: 38px; border: 1px solid var(--lib-border); border-radius: 5px; background: var(--lib-surface); color: var(--lib-text); padding: 0 48px 0 10px; font: 500 13px var(--font-body); }.report-name small { position: absolute; right: 9px; bottom: 12px; color: var(--lib-muted); font-size: 10px; }
  .report-name input:focus, .create-form input:focus { outline: 3px solid var(--lib-focus); border-color: var(--lib-accent); }
  .reorder-hint { margin: 17px 0 10px; color: var(--lib-muted); font-size: 11px; }
  .cart-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .cart-list li { min-height: 62px; display: grid; grid-template-columns: 14px 24px 78px minmax(0,1fr) auto; align-items: center; gap: 7px; padding: 7px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); }
  .drag { color: var(--lib-muted); cursor: grab; }.position { display: grid; place-items: center; color: var(--lib-text); font-size: 12px; }.mini-thumb { height: 44px; border: 1px solid var(--lib-border); border-radius: 4px; background: linear-gradient(135deg, var(--lib-surface-soft), var(--lib-accent-soft)); }
  .cart-list strong { min-width: 0; color: var(--lib-text); font-size: 12px; line-height: 1.4; }.cart-list strong small { display: block; margin-top: 3px; color: var(--lib-muted); font-weight: 400; }.cart-list li > div { display: flex; gap: 2px; }.cart-list button { width: 25px; height: 28px; border: 0; background: transparent; color: var(--lib-muted); cursor: pointer; }.cart-list button:hover { color: var(--lib-accent); }.cart-list button:disabled { opacity: .25; }
  .history-toggle { width: 100%; display: flex; justify-content: space-between; margin-top: 18px; padding: 12px 0; border-top: 1px solid var(--lib-border); border-bottom: 1px solid var(--lib-border); color: var(--lib-text); text-align: left; }
  .export-list { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }.export-list li { display: flex; justify-content: space-between; gap: 8px; color: var(--lib-muted); font-size: 11px; }.export-list li div { display: flex; gap: 6px; }.export-list a { color: var(--lib-accent); font-weight: 700; }
  .cart-state, .cart-error, .cart-notice { margin-top: 12px; color: var(--lib-muted); font-size: 12px; line-height: 1.6; }.cart-error { color: var(--lib-danger); }.cart-notice { color: var(--lib-accent-strong); }
  .create-form { display: grid; gap: 12px; }.create-form label { display: grid; gap: 6px; font-size: 12px; }.create-form button { height: 38px; border: 0; border-radius: 6px; background: var(--lib-accent-fill); color: #fff; font-weight: 700; }
  .cart-panel > footer { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; padding: 0 18px; border-top: 1px solid var(--lib-border); background: var(--lib-surface); }.cart-panel > footer button { height: 42px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); font: 700 13px var(--font-body); cursor: pointer; }.cart-panel > footer .export-button { border-color: var(--lib-accent-fill); background: var(--lib-accent-fill); color: #fff; }.cart-panel button:disabled { opacity: .45; cursor: not-allowed; }
  .drawer-backdrop { display: none; }
  @keyframes pulse { 50% { opacity: .48; } }
  @media (max-width: 1380px) { .workspace { grid-template-columns: 250px minmax(430px,1fr) 360px; }.metrics { display: none; }.app-header { grid-template-columns: auto minmax(240px,1fr) auto auto auto auto auto; }.loading-grid { grid-template-columns: 1fr; } }
  @media (max-width: 1100px) {
    .workspace { grid-template-columns: minmax(0,1fr) 360px; }.filter-drawer { position: fixed; z-index: 72; inset: 72px auto 0 0; transform: translateX(-105%); transition: transform .18s ease; }.filter-drawer.open { transform: translateX(0); }.drawer-backdrop { display: block; position: fixed; z-index: 70; inset: 72px 0 0; border: 0; background: rgba(3,8,15,.48); }.mobile-filter { display: inline-flex; align-items: center; }.result-count, .clear-filters { display: none; }
  }
  @media (max-width: 820px) {
    :global(body) { overflow: auto; }.library-shell { height: auto; min-height: 100vh; grid-template-rows: auto auto; }.app-header { grid-template-columns: auto 1fr auto auto; min-height: 116px; padding: 10px 14px; }.brand strong { font-size: 16px; }.global-search { grid-row: 2; grid-column: 1/-1; }.import-link { display: none; }.account span { display: none; }.workspace { display: block; }.results-panel { overflow: visible; min-height: 70vh; }.cart-panel { min-height: 560px; border-left: 0; border-top: 1px solid var(--lib-border); }.filter-drawer { inset: 0 auto 0 0; }.drawer-backdrop { inset: 0; }.pagination { grid-template-columns: 1fr; justify-items: center; padding: 14px 0; }.pagination > span:last-child { justify-self: center; }
  }
  @media (max-width: 520px) { .results-panel { padding-inline: 10px; }.select-page { display: none; }.cart-list li { grid-template-columns: 14px 20px 58px minmax(0,1fr); }.cart-list li > div { grid-column: 3/-1; justify-self: end; } }
  @media (prefers-reduced-motion: reduce) { .skeleton div, .skeleton i { animation: none; }.filter-drawer { transition: none; } }
</style>
