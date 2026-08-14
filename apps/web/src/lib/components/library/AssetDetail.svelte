<script lang="ts">
  import { onMount } from 'svelte'
  import { TEMPLATE_RUNTIME_PROTOCOL, isTemplateRuntimeEventMessage } from '@slide-maker/shared'
  import type { CatalogItem } from '$lib/asset-library'
  import { safeDerivativeUrl, safeRuntimeUrl } from '$lib/asset-library'

  let { item, open, isAdmin, onClose, onRetired }: { item: CatalogItem | null; open: boolean; isAdmin: boolean; onClose: () => void; onRetired: () => void } = $props()
  let failedItemId = $state<string | null>(null)
  let closeButton: HTMLButtonElement | undefined = $state()
  let runtimeFrame: HTMLIFrameElement | undefined = $state()
  let runtimeSessionId = $state<string | null>(null)
  let runtimeError = $state('')
  let runtimeReady = $state(false)
  let runtimeSequence = $state(0)
  let retireBusy = $state(false)
  let retireError = $state('')
  let previousRuntimeKey = $state('')

  $effect(() => { if (open) requestAnimationFrame(() => closeButton?.focus()) })
  $effect(() => {
    const key = open && item?.runtime ? `${item.id}:${item.version.id}` : ''
    if (key === previousRuntimeKey) return
    previousRuntimeKey = key
    runtimeSessionId = null
    runtimeError = ''
    runtimeReady = false
    runtimeSequence = 0
    retireError = ''
  })

  function runtimeMessage(event: MessageEvent): void {
    if (!open || !item?.runtime || event.source !== runtimeFrame?.contentWindow || event.origin !== 'null' || !isTemplateRuntimeEventMessage(event.data)) return
    const message = event.data
    if (message.assetId !== item.id || message.version !== item.version.number) return
    if (message.type === 'ready') {
      runtimeSessionId = message.sessionId
      runtimeReady = true
      runtimeError = ''
      return
    }
    if (message.sessionId !== runtimeSessionId) return
    runtimeError = message.code
  }

  function sendRuntimeCommand(type: 'replay' | 'reset'): void {
    if (!runtimeReady || !runtimeSessionId || !runtimeFrame?.contentWindow) return
    runtimeSequence += 1
    runtimeFrame.contentWindow.postMessage({ protocol: TEMPLATE_RUNTIME_PROTOCOL, type, sessionId: runtimeSessionId, sequence: runtimeSequence }, '*')
  }

  async function retire(): Promise<void> {
    if (!item || retireBusy) return
    retireBusy = true
    retireError = ''
    try {
      const response = await fetch(`/api/admin/templates/${encodeURIComponent(item.id)}/retire`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin',
      })
      const body = await response.json().catch(() => ({ error: '模板管理服务返回了无效响应' })) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? `模板下架失败（${response.status}）`)
      onRetired()
    } catch (cause) { retireError = cause instanceof Error ? cause.message : '模板下架失败' }
    finally { retireBusy = false }
  }

  onMount(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', escape)
    window.addEventListener('message', runtimeMessage)
    return () => { document.removeEventListener('keydown', escape); window.removeEventListener('message', runtimeMessage) }
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
        <div><dt>包契约</dt><dd>{item.version.contractVersion} · 当前版本 · {item.version.status === 'available' ? '已发布' : '已验证'}</dd></div>
        {#if item.runtime}<div><dt>交互运行时</dt><dd>{item.runtime.mode} · {item.runtime.viewport.width}×{item.runtime.viewport.height}</dd></div>{/if}
      </dl>
      {#if item.runtime}
        <section class="interactive-runtime" aria-label="交互模板运行时">
          <header><div><h3>交互预览</h3><p>{runtimeReady ? '运行时已就绪' : '正在建立隔离运行时…'}</p></div><div><button type="button" disabled={!runtimeReady} onclick={() => sendRuntimeCommand('replay')}>重播</button><button type="button" disabled={!runtimeReady} onclick={() => sendRuntimeCommand('reset')}>重置</button></div></header>
          <iframe bind:this={runtimeFrame} title={`${item.title} 的隔离交互预览`} sandbox="allow-scripts" src={safeRuntimeUrl(item.runtime.url)}></iframe>
          {#if runtimeError}<p class="runtime-error" role="alert">交互运行时报告错误：{runtimeError}</p>{/if}
        </section>
      {/if}
      {#if isAdmin}
        <section class="retire-panel" aria-label="模板下架">
          <div><h3>下架模板</h3><p>仅从目录和新增候选中隐藏；既有汇报继续固定读取当前不可变版本。</p></div>
          <button type="button" disabled={retireBusy} onclick={() => void retire()}>{retireBusy ? '正在下架…' : '下架模板'}</button>
          {#if retireError}<p role="alert">{retireError}</p>{/if}
        </section>
      {/if}
      <p class="safety-note">目录卡片始终使用经过 CAS 重验的 PNG；仅此详情按需建立隔离运行时。</p>
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
  .interactive-runtime, .retire-panel { margin-top: 18px; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface); overflow: hidden; }
  .interactive-runtime > header, .retire-panel { padding: 13px; }
  .interactive-runtime > header { align-items: center; }
  h3 { color: var(--lib-text-strong); font-size: 13px; }
  .interactive-runtime header p, .retire-panel p { margin-top: 4px; color: var(--lib-muted); font-size: 11px; line-height: 1.5; }
  .interactive-runtime header > div:last-child { display: flex; gap: 6px; }
  .interactive-runtime button, .retire-panel button { min-height: 31px; border: 1px solid var(--lib-border); border-radius: 5px; background: var(--lib-elevated); color: var(--lib-text); padding: 0 9px; font: 700 11px var(--font-body); cursor: pointer; }
  .interactive-runtime button:disabled, .retire-panel button:disabled { opacity: .48; cursor: not-allowed; }
  iframe { display: block; width: 100%; aspect-ratio: 16/9; border: 0; border-top: 1px solid var(--lib-border); background: #fff; }
  .runtime-error { margin: 0; padding: 10px 13px; color: var(--lib-danger); font-size: 12px; }
  .retire-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
  .retire-panel button { border-color: var(--lib-danger); color: var(--lib-danger); }
  .retire-panel > p { grid-column: 1 / -1; margin: -4px 0 0; color: var(--lib-danger); }
  .safety-note { margin-top: 16px; color: var(--lib-muted); font-size: 12px; }
</style>
