<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '$lib/api'
  import { authMessage, type SessionUser } from '$lib/auth'
  import { goto } from '$app/navigation'
  import { loadTemplateImportJob, uploadTemplateZip, type TemplateImportJob, type TemplateImportResult } from '$lib/template-imports'
  let users = $state<SessionUser[]>([])
  let error = $state('')
  let temporaryPassword = $state('')
  let busy = $state<string | null>(null)
  let errorBox: HTMLElement | undefined = $state()
  let templateFile: File | null = $state(null)
  let templateBusy = $state(false)
  let templateError = $state('')
  let templateResult: TemplateImportResult | null = $state(null)
  let templateJob: TemplateImportJob | null = $state(null)
  async function load(): Promise<void> { try { users = (await api.p15ListUsers()).users } catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) } }
  async function action(id: string, kind: 'approve' | 'disable' | 'reset'): Promise<void> { busy = id; error = ''; temporaryPassword = ''; try { if (kind === 'approve') await api.p15ApproveUser(id); else if (kind === 'disable') await api.p15DisableUser(id); else temporaryPassword = (await api.p15ResetPassword(id)).temporaryPassword; await load() } catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) } finally { busy = null } }
  async function logout(): Promise<void> { try { await api.p15Logout() } finally { await goto('/login') } }
  async function importTemplate(): Promise<void> {
    if (!templateFile || templateBusy) return
    templateBusy = true
    templateError = ''
    templateResult = null
    templateJob = null
    try {
      templateResult = await uploadTemplateZip(templateFile)
      templateJob = templateResult.job
      for (let attempt = 0; attempt < 90 && templateJob.status !== 'succeeded' && templateJob.status !== 'failed'; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        templateJob = await loadTemplateImportJob(templateJob.id)
      }
      if (templateJob.status !== 'succeeded' && templateJob.status !== 'failed') throw new Error('预览仍在队列中；可稍后重新上传同一包查询同一任务。')
      if (templateJob.status === 'failed') throw new Error(templateJob.diagnostic || '安全预览生成失败。')
      if (!templateJob.available) throw new Error('预览任务完成，但模板尚未满足可用目录契约。')
      templateFile = null
    } catch (cause) {
      templateError = cause instanceof Error ? cause.message : '模板导入失败'
    } finally { templateBusy = false }
  }
  onMount(() => { void load() })
</script>

<svelte:head>
  <title>账号审批 · 模板资产库</title>
</svelte:head>

  <div class="admin-page">
    <header class="admin-header">
      <div class="header-left">
        <a href="/" class="back-link">&larr; 返回资产库</a>
        <h1>平台管理</h1>
      </div>
      <button class="logout" type="button" onclick={() => void logout()}>退出</button>
    </header>

    <main class="admin-main">
      {#if error}<p class="error" role="alert" tabindex="-1" bind:this={errorBox}>{error}</p>{/if}
      {#if temporaryPassword}<p class="temporary" role="status">临时密码（仅此显示）：<code>{temporaryPassword}</code></p>{/if}
      <section class="template-import" aria-labelledby="template-import-heading" aria-busy={templateBusy}>
        <div><h2 id="template-import-heading">导入 HTML 模板</h2><p>仅接受 html-template/v1 ZIP；最多 5 MiB、32 个 HTML/CSS 文件。导入后由隔离 Chromium 生成 PNG 预览。</p></div>
        <label>模板 ZIP <input type="file" accept=".zip,application/zip" onchange={(event) => { templateFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null }} /></label>
        <button type="button" disabled={!templateFile || templateBusy} onclick={() => { void importTemplate() }}>{templateBusy ? '校验与预览中…' : '上传并生成预览'}</button>
        {#if templateJob}<p class="job" role="status">任务：{templateJob.status} · 尝试 {templateJob.attempt}/{templateJob.maxAttempts}{templateJob.available ? ' · 已进入目录' : ''}</p>{/if}
        {#if templateError}<p class="error" role="alert">{templateError}</p>{/if}
        {#if templateResult && templateJob?.available}<p class="temporary" role="status">模板 {templateResult.assetId} / {templateResult.versionId} 已导入，可返回资产库查看。</p>{/if}
      </section>
      <h2 class="users-heading">账号审批</h2>
      <table><thead><tr><th>用户名</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{#each users as user (user.id)}<tr><td>{user.username}</td><td>{user.status}</td><td>{new Date(user.createdAt).toLocaleString('zh-CN')}</td><td>{#if user.status === 'pending'}<button onclick={() => void action(user.id, 'approve')} disabled={busy === user.id}>批准</button>{:else if user.status === 'active' && user.role === 'member'}<button onclick={() => void action(user.id, 'disable')} disabled={busy === user.id}>停用</button>{/if}{#if user.role === 'member'}<button onclick={() => void action(user.id, 'reset')} disabled={busy === user.id}>重置密码</button>{/if}</td></tr>{/each}</tbody></table>
    </main>
  </div>

<style>
  .admin-page {
    min-height: 100vh;
    background: var(--color-bg-secondary);
  }

  .admin-header {
    background: var(--color-bg);
    border-bottom: 1px solid var(--color-border);
    padding: 1rem 2rem;
    display:flex;align-items:center;justify-content:space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .back-link {
    font-size: 0.8125rem;
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 500;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  .admin-header h1 {
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--color-primary-dark);
  }

  .admin-main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    overflow-x: auto;
  }
  .logout{border:0;background:transparent;color:var(--color-primary);font:700 14px var(--font-body);cursor:pointer}
  .template-import{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,320px) auto;align-items:end;gap:12px;margin-bottom:28px;padding:18px;border:1px solid var(--color-border);border-radius:10px;background:#fff}.template-import h2,.users-heading{font-size:1.05rem;color:var(--color-primary-dark)}.template-import p{margin-top:5px;color:#536178;font-size:13px}.template-import label{display:grid;gap:6px;color:#45556d;font-size:13px;font-weight:700}.template-import input{min-width:0}.template-import .job,.template-import .error,.template-import .temporary{grid-column:1/-1;margin:0}.users-heading{margin:0 0 10px}
  table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--color-border)}button{margin-right:8px;padding:7px 10px;border:1px solid var(--color-primary);border-radius:6px;background:#fff;color:var(--color-primary);font-weight:700;cursor:pointer}.error,.temporary{padding:12px;margin-bottom:16px;border-radius:8px}.error{background:#fef2f2;color:#b91c1c}.temporary{background:#f0fdf4;color:#166534}.temporary code{font-size:1.05em}

  @media (max-width: 640px) {
    .admin-header { padding: 0.875rem 1rem; gap: 0.75rem; align-items: flex-start; }
    .header-left { gap: 0.75rem; flex-direction: column; align-items: flex-start; }
    .admin-header h1 { font-size: 1.125rem; }
    .admin-main { padding: 1rem; }
    table { min-width: 580px; font-size: 0.875rem; }
    th, td { padding: 0.625rem; }
    button { margin: 0 0.375rem 0.375rem 0; }
  }
</style>
