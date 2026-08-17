<script lang="ts">
  import { onMount } from 'svelte'
  import { TEMPLATE_RUNTIME_PROTOCOL, isTemplateRuntimeEventMessage } from '@slide-maker/shared'
  import type { CatalogItem } from '$lib/asset-library'
  import { runtimeViewportScale, safeDerivativeUrl, safeRuntimeUrl } from '$lib/asset-library'

  let { item, open, isAdmin, onClose, onRetired }: { item: CatalogItem | null; open: boolean; isAdmin: boolean; onClose: () => void; onRetired: () => void } = $props()
  let failedItemId = $state<string | null>(null)
  let closeButton: HTMLButtonElement | undefined = $state()
  let fullscreenHost: HTMLDivElement | undefined = $state()
  let runtimeFrame: HTMLIFrameElement | undefined = $state()
  let runtimeViewportHost: HTMLDivElement | undefined = $state()
  let runtimeScale = $state(1)
  let runtimeSessionId = $state<string | null>(null)
  let runtimeError = $state('')
  let runtimeReady = $state(false)
  let runtimeSequence = $state(0)
  let fitToWindow = $state(true)
  let fullscreenActive = $state(false)
  let retireBusy = $state(false)
  let retireError = $state('')
  let previousRuntimeKey = $state('')

  $effect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      fullscreenHost?.scrollTo({ top: 0, left: 0 })
      closeButton?.focus({ preventScroll: true })
    })
  })
  $effect(() => {
    const key = open && item?.runtime ? `${item.id}:${item.version.id}:${item.runtime.mode}` : ''
    if (key === previousRuntimeKey) return
    previousRuntimeKey = key
    runtimeSessionId = null
    runtimeError = ''
    runtimeReady = false
    runtimeSequence = 0
    fitToWindow = true
    retireError = ''
  })
  $effect(() => {
    const host = runtimeViewportHost
    const runtime = item?.runtime
    fitToWindow
    if (!open || !host || !runtime) return
    const resize = (): void => {
      if (!fitToWindow) { runtimeScale = 1; return }
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      runtimeScale = Math.min(
        runtimeViewportScale(host.clientWidth, runtime.viewport.width),
        runtimeViewportScale(host.clientHeight, runtime.viewport.height),
      )
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  })

  function runtimeMessage(event: MessageEvent): void {
    if (!open || item?.runtime?.mode !== 'sandboxed-js' || event.source !== runtimeFrame?.contentWindow || event.origin !== 'null' || !isTemplateRuntimeEventMessage(event.data)) return
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

  function runtimeLoaded(): void {
    if (item?.runtime?.mode === 'sandboxed-static') {
      runtimeReady = true
      runtimeError = ''
    }
  }

  function sendRuntimeCommand(type: 'replay' | 'reset'): void {
    if (item?.runtime?.mode !== 'sandboxed-js'
      || !item.runtime.commands.includes(type)
      || !runtimeReady
      || !runtimeSessionId
      || !runtimeFrame?.contentWindow) return
    runtimeSequence += 1
    runtimeFrame.contentWindow.postMessage({ protocol: TEMPLATE_RUNTIME_PROTOCOL, type, sessionId: runtimeSessionId, sequence: runtimeSequence }, '*')
  }

  async function toggleFullscreen(): Promise<void> {
    if (!fullscreenHost) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await fullscreenHost.requestFullscreen()
    } catch {
      runtimeError = 'fullscreen-unavailable'
    }
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
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !open) return
      event.preventDefault()
      event.stopPropagation()
      if (document.fullscreenElement) { void document.exitFullscreen(); return }
      onClose()
    }
    const fullscreenChange = (): void => { fullscreenActive = document.fullscreenElement !== null }
    document.addEventListener('keydown', escape, true)
    document.addEventListener('fullscreenchange', fullscreenChange)
    window.addEventListener('message', runtimeMessage)
    return () => {
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('fullscreenchange', fullscreenChange)
      window.removeEventListener('message', runtimeMessage)
    }
  })
</script>

{#if open && item}
  <div class="detail-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div bind:this={fullscreenHost} class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
      <header class="modal-header">
        <div>
          <p class="eyebrow">实时模板预览</p>
          <h2 id="detail-title">{item.title}</h2>
        </div>
        <div class="modal-actions">
          <button class:active={fitToWindow} type="button" aria-label="适应窗口" aria-pressed={fitToWindow} onclick={() => { fitToWindow = !fitToWindow }}>适应窗口</button>
          <button type="button" aria-label={fullscreenActive ? '退出全屏' : '全屏预览'} onclick={() => void toggleFullscreen()}>{fullscreenActive ? '退出全屏' : '全屏'}</button>
          <button bind:this={closeButton} class="close-button" type="button" aria-label="关闭模板预览" onclick={onClose}>×</button>
        </div>
      </header>

      {#if item.runtime}
        <section class="runtime-shell" aria-label={item.runtime.mode === 'sandboxed-js' ? '交互模板运行时' : '静态模板运行时'}>
          <header class="runtime-toolbar">
            <div>
              <strong>{item.runtime.mode === 'sandboxed-js' ? '可交互页面' : '真实 HTML / CSS 页面'}</strong>
              <span>{runtimeReady ? '页面已就绪' : '正在载入隔离页面…'}</span>
            </div>
            {#if item.runtime.mode === 'sandboxed-js'}
              <div class="runtime-actions">
                {#if item.runtime.commands.includes('replay')}<button type="button" disabled={!runtimeReady} onclick={() => sendRuntimeCommand('replay')}>重播</button>{/if}
                {#if item.runtime.commands.includes('reset')}<button type="button" disabled={!runtimeReady} onclick={() => sendRuntimeCommand('reset')}>重置</button>{/if}
              </div>
            {/if}
          </header>
          <div class="runtime-canvas">
            <div bind:this={runtimeViewportHost} class:fit={fitToWindow} class="runtime-viewport" style:aspect-ratio={`${item.runtime.viewport.width} / ${item.runtime.viewport.height}`}>
              <div
                class="runtime-stage"
                style:width={`${item.runtime.viewport.width}px`}
                style:height={`${item.runtime.viewport.height}px`}
                style:transform={`scale(${runtimeScale})`}
              >
                {#if item.runtime.mode === 'sandboxed-js'}
                  <iframe bind:this={runtimeFrame} title={`${item.title} 的隔离交互预览`} sandbox="allow-scripts" referrerpolicy="no-referrer" src={safeRuntimeUrl(item.runtime.url)} onload={runtimeLoaded}></iframe>
                {:else}
                  <iframe bind:this={runtimeFrame} title={`${item.title} 的隔离静态预览`} sandbox="" referrerpolicy="no-referrer" src={safeRuntimeUrl(item.runtime.url)} onload={runtimeLoaded}></iframe>
                {/if}
              </div>
            </div>
          </div>
          {#if runtimeError}<p class="runtime-error" role="alert">模板运行时报告错误：{runtimeError}</p>{/if}
        </section>
      {:else}
        <div class="preview-frame">
          {#if failedItemId === item.id}<div class="preview-error" role="status">安全 PNG 预览暂不可用</div>{:else}<img src={safeDerivativeUrl(item.derivative.previewUrl)} alt={`${item.title} 的安全 PNG 预览`} onerror={() => { failedItemId = item.id }} />{/if}
        </div>
      {/if}

      <details class="metadata-panel">
        <summary>模板信息</summary>
        <dl>
          <div><dt>摘要</dt><dd>{item.summary}</dd></div>
          <div><dt>分类</dt><dd>{item.category}</dd></div>
          <div><dt>标签</dt><dd class="tag-list">{#each item.tags as tag}<span>{tag}</span>{/each}</dd></div>
          <div><dt>渲染器身份</dt><dd class="renderer">{item.derivative.rendererVersion}</dd></div>
          <div><dt>包契约</dt><dd>{item.version.contractVersion} · v{item.version.number} · {item.version.status === 'available' ? '已发布' : '已验证'}</dd></div>
          {#if item.runtime}<div><dt>运行时</dt><dd>{item.runtime.mode} · {item.runtime.viewport.width}×{item.runtime.viewport.height}</dd></div>{/if}
        </dl>
        {#if isAdmin}
          <section class="retire-panel" aria-label="模板下架">
            <div><h3>下架模板</h3><p>仅从目录和新增候选中隐藏；既有汇报继续固定读取当前不可变版本。</p></div>
            <button type="button" disabled={retireBusy} onclick={() => void retire()}>{retireBusy ? '正在下架…' : '下架模板'}</button>
            {#if retireError}<p role="alert">{retireError}</p>{/if}
          </section>
        {/if}
        <p class="safety-note">列表卡片始终使用经过 CAS 重验的 PNG；实时页面仅在打开预览后按需建立，关闭即销毁。</p>
      </details>
    </div>
  </div>
{/if}

<style>
  .detail-backdrop { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(3, 8, 15, .72); }
  .detail-panel { box-sizing: border-box; width: min(1500px, calc(100vw - 36px)); max-height: calc(100dvh - 36px); overflow: auto; overflow-anchor: none; padding: 16px 18px 18px; border: 1px solid var(--lib-border); border-radius: 12px; background: var(--lib-elevated); color: var(--lib-text); box-shadow: var(--lib-shadow-lg); }
  .detail-panel:fullscreen { width: 100vw; height: 100vh; max-height: none; border: 0; border-radius: 0; padding: 14px 18px; }
  .modal-header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .eyebrow { margin: 0 0 3px; color: var(--lib-accent-strong); font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h2 { color: var(--lib-text-strong); font-size: 21px; line-height: 1.25; }
  .modal-actions { display: flex; align-items: center; gap: 7px; }
  .modal-actions button, .runtime-actions button, .retire-panel button { min-height: 34px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); padding: 0 11px; font: 700 11px var(--font-body); cursor: pointer; }
  .modal-actions button.active { border-color: var(--lib-accent); background: var(--lib-accent-soft); color: var(--lib-accent-strong); }
  .modal-actions .close-button { width: 36px; padding: 0; font-size: 22px; }
  button:focus-visible, summary:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  .runtime-shell { border: 1px solid var(--lib-border); border-radius: 9px; background: var(--lib-surface); overflow: hidden; }
  .runtime-toolbar { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 6px 10px 6px 13px; border-bottom: 1px solid var(--lib-border); }
  .runtime-toolbar > div:first-child { display: grid; gap: 2px; }
  .runtime-toolbar strong { color: var(--lib-text-strong); font-size: 12px; }
  .runtime-toolbar span { color: var(--lib-muted); font-size: 10px; }
  .runtime-actions { display: flex; gap: 6px; }
  .runtime-actions button:disabled, .retire-panel button:disabled { opacity: .48; cursor: not-allowed; }
  .runtime-canvas { display: grid; place-items: center; min-width: 0; background: #e5e7eb; }
  .runtime-viewport { width: min(100%, calc((100dvh - 180px) * 16 / 9)); overflow: auto; background: #fff; }
  .runtime-viewport.fit { overflow: hidden; }
  .runtime-stage { transform-origin: top left; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  .runtime-error { margin: 0; padding: 9px 13px; border-top: 1px solid var(--lib-border); color: var(--lib-danger); font-size: 11px; }
  .preview-frame { width: min(100%, calc((100dvh - 180px) * 16 / 9)); aspect-ratio: 16/9; display: grid; place-items: center; overflow: hidden; margin-inline: auto; border: 1px solid var(--lib-border); border-radius: 9px; background: var(--lib-surface-soft); }
  .preview-frame img { width: 100%; height: 100%; object-fit: contain; }
  .preview-error { color: var(--lib-danger); font-size: 13px; }
  .metadata-panel { margin-top: 10px; border: 1px solid var(--lib-border); border-radius: 8px; background: var(--lib-surface); }
  .metadata-panel summary { padding: 12px 14px; color: var(--lib-text-strong); font-size: 12px; font-weight: 800; cursor: pointer; }
  dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; padding: 0 14px 12px; gap: 0 18px; }
  dl > div { min-width: 0; padding: 11px 0; border-top: 1px solid var(--lib-border); }
  dt { margin-bottom: 5px; color: var(--lib-text-strong); font-size: 11px; font-weight: 700; }
  dd { margin: 0; color: var(--lib-muted); font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag-list span { padding: 3px 6px; border: 1px solid var(--lib-border); border-radius: 4px; background: var(--lib-accent-soft); color: var(--lib-accent-strong); }
  .renderer { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
  .retire-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; margin: 0 14px 12px; padding: 12px; border: 1px solid var(--lib-border); border-radius: 7px; }
  .retire-panel h3 { color: var(--lib-text-strong); font-size: 12px; }
  .retire-panel p { margin-top: 3px; color: var(--lib-muted); font-size: 10px; line-height: 1.5; }
  .retire-panel button { border-color: var(--lib-danger); color: var(--lib-danger); }
  .retire-panel > p { grid-column: 1 / -1; margin: 0; color: var(--lib-danger); }
  .safety-note { margin: 0; padding: 0 14px 13px; color: var(--lib-muted); font-size: 10px; }
  @media (max-width: 720px) {
    .detail-backdrop { padding: 0; }
    .detail-panel { width: 100vw; max-height: 100dvh; border-radius: 0; padding: 10px; }
    .modal-header { align-items: flex-start; }
    .modal-actions { flex-wrap: wrap; justify-content: flex-end; }
    .modal-actions button { min-height: 32px; padding-inline: 8px; }
    .runtime-viewport, .preview-frame { width: 100%; }
    dl { grid-template-columns: 1fr; }
  }
</style>
