<script lang="ts">
  import type { CatalogItem } from '$lib/asset-library'
  import { safeDerivativeUrl } from '$lib/asset-library'

  let { item }: { item: CatalogItem | null } = $props()
  let failedItemId = $state<string | null>(null)
</script>

<aside class="detail-panel" aria-label="所选模板详情" aria-live="polite">
  {#if item}
    <header>
      <h2>{item.title}</h2>
      <div class="version-line">
        <span>版本 v{item.version.number}</span>
        <span class="divider" aria-hidden="true"></span>
        <span class="verified">{item.version.status === 'available' ? '可用' : '已验证'}</span>
      </div>
    </header>

    <div class="preview-frame">
      {#if failedItemId === item.id}
        <div class="preview-error" role="status">安全 PNG 预览暂不可用</div>
      {:else}
        <img src={safeDerivativeUrl(item.derivative.previewUrl)} alt={`${item.title} 的安全 PNG 预览`} onerror={() => { failedItemId = item.id }} />
      {/if}
    </div>

    <dl>
      <div><dt>摘要</dt><dd>{item.summary}</dd></div>
      <div><dt>分类</dt><dd>{item.category}</dd></div>
      <div><dt>标签</dt><dd class="tag-list">{#each item.tags as tag}<span>{tag}</span>{/each}</dd></div>
      <div><dt>渲染器身份</dt><dd class="renderer">{item.derivative.rendererVersion}</dd></div>
    </dl>

    <p class="safety-note">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m6 16 4-4 3 3 2-2 3 3"></path></svg>
      此处只显示经 CAS 重验的 PNG 派生物，不包含可执行模板内容。
    </p>
  {:else}
    <div class="detail-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m6 16 4-4 3 3 2-2 3 3"></path></svg>
      <h2>选择一个模板</h2>
      <p>从中栏选择资产后，可在此查看详情与安全 PNG 预览。</p>
    </div>
  {/if}
</aside>

<style>
  .detail-panel { min-width: 0; border-left: 1px solid #dce2ea; background: #fff; padding: 28px 30px; overflow-y: auto; }
  h2 { color: #0b1739; font-size: clamp(21px, 2vw, 26px); line-height: 1.25; }
  .version-line { display: flex; align-items: center; gap: 12px; margin-top: 10px; color: #5c6b82; font-size: 13px; }
  .divider { height: 15px; width: 1px; background: #cbd3df; }
  .verified { color: #1768e5; font-weight: 700; }
  .preview-frame { display: grid; place-items: center; aspect-ratio: 16/9; overflow: hidden; margin-top: 24px; border: 1px solid #c8d1de; border-radius: 7px; background: #f1f4f8; }
  img { width: 100%; height: 100%; display: block; object-fit: contain; }
  .preview-error { color: #9f2f2f; font-size: 13px; }
  dl { margin-top: 8px; }
  dl > div { border-bottom: 1px solid #e1e6ed; padding: 18px 0; }
  dt { color: #0b1739; font-weight: 700; font-size: 14px; margin-bottom: 8px; }
  dd { margin: 0; color: #45556d; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
  .tag-list { display: flex; gap: 7px; flex-wrap: wrap; }
  .tag-list span { color: #155fcf; background: #f1f6ff; border: 1px solid #b8d0f6; border-radius: 5px; padding: 4px 7px; line-height: 1; }
  .renderer { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .safety-note { display: flex; gap: 10px; align-items: flex-start; color: #68778d; font-size: 12px; line-height: 1.6; margin-top: 18px; }
  .safety-note svg, .detail-empty svg { flex: none; width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .detail-empty { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #77859a; }
  .detail-empty svg { width: 32px; height: 32px; margin-bottom: 14px; }
  .detail-empty h2 { font-size: 19px; }
  .detail-empty p { max-width: 280px; margin-top: 8px; font-size: 13px; line-height: 1.65; }
  @media (max-width: 1080px) { .detail-panel { border-left: 0; border-top: 1px solid #dce2ea; } }
  @media (max-width: 700px) { .detail-panel { padding: 22px 16px; } }
</style>
