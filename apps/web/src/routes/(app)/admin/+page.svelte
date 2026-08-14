<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '$lib/api'
  import { authMessage, type SessionUser } from '$lib/auth'
  import ThemeSwitcher from '$lib/components/library/ThemeSwitcher.svelte'
  import { loadTemplateImportJob, uploadTemplateHtml, uploadTemplateZip, validateTemplateHtml, type HtmlTemplateValidation, type TemplateImportJob, type TemplateImportResult } from '$lib/template-imports'
  import { createLocalBackup, loadRecoveryOverview, runIsolatedRestore, safeBackupManifestUrl, stageRecoveryActivation, type RecoveryBackup, type RecoveryOverview } from '$lib/recovery'
  import { downloadEncryptedRecoveryBackup, importEncryptedRecoveryBackup } from '$lib/recovery-encryption'

  let users = $state<SessionUser[]>([])
  let error = $state('')
  let temporaryPassword = $state('')
  let busy = $state<string | null>(null)
  let errorBox: HTMLElement | undefined = $state()

  let importOpen = $state(false)
  let importMode = $state<'html' | 'zip'>('html')
  let templateFile: File | null = $state(null)
  let templateBusy = $state(false)
  let templateError = $state('')
  let templateResult: TemplateImportResult | null = $state(null)
  let templateJob: TemplateImportJob | null = $state(null)
  let htmlValidation: HtmlTemplateValidation | null = $state(null)
  let htmlTitle = $state('')
  let htmlSummary = $state('')
  let htmlCategory = $state('通用汇报')
  let htmlTags = $state('')
  let importStage = $state<'idle' | 'validating' | 'registering' | 'previewing' | 'ready'>('idle')
  let fileInput: HTMLInputElement | undefined = $state()

  let recovery = $state<RecoveryOverview | null>(null)
  let recoveryLoading = $state(true)
  let recoveryError = $state('')
  let recoveryNotice = $state('')
  let recoveryPassphrase = $state('')
  let recoveryImportFile: File | null = $state(null)

  async function load(): Promise<void> {
    try { users = (await api.p15ListUsers()).users }
    catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) }
  }

  async function action(id: string, kind: 'approve' | 'disable' | 'reset'): Promise<void> {
    busy = id; error = ''; temporaryPassword = ''
    try {
      if (kind === 'approve') await api.p15ApproveUser(id)
      else if (kind === 'disable') await api.p15DisableUser(id)
      else temporaryPassword = (await api.p15ResetPassword(id)).temporaryPassword
      await load()
    } catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) }
    finally { busy = null }
  }

  function tags(): string[] { return htmlTags.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) }
  function accept(): string { return importMode === 'html' ? '.html,.htm,text/html' : '.zip,application/zip' }

  function chooseFile(file: File | null): void {
    templateError = ''; templateResult = null; templateJob = null; htmlValidation = null; importStage = 'idle'
    if (!file) { templateFile = null; return }
    const valid = importMode === 'html' ? /\.html?$/i.test(file.name) : /\.zip$/i.test(file.name)
    if (!valid) { templateError = importMode === 'html' ? '请选择 .html 或 .htm 文件。' : '请选择 .zip 模板包。'; templateFile = null; return }
    templateFile = file
    if (importMode === 'html' && !htmlTitle) htmlTitle = file.name.replace(/\.html?$/i, '')
  }

  async function waitForPreview(result: TemplateImportResult): Promise<void> {
    templateJob = result.job
    importStage = 'previewing'
    for (let attempt = 0; attempt < 90 && templateJob.status !== 'succeeded' && templateJob.status !== 'failed'; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000))
      templateJob = await loadTemplateImportJob(templateJob.id)
    }
    if (templateJob.status !== 'succeeded' && templateJob.status !== 'failed') throw new Error('预览仍在队列中；稍后重新提交同一文件可继续查询。')
    if (templateJob.status === 'failed') throw new Error(templateJob.diagnostic || '安全预览生成失败。')
    if (!templateJob.available) throw new Error('预览任务完成，但模板尚未满足目录契约。')
    importStage = 'ready'
  }

  async function importTemplate(): Promise<void> {
    if (!templateFile || templateBusy) return
    templateBusy = true; templateError = ''; templateResult = null; templateJob = null; htmlValidation = null
    try {
      if (importMode === 'html') {
        if (!htmlTitle.trim() || !htmlSummary.trim() || !htmlCategory.trim()) throw new Error('请填写标题、摘要和分类。')
        const metadata = { title: htmlTitle, summary: htmlSummary, category: htmlCategory, tags: tags() }
        importStage = 'validating'
        htmlValidation = await validateTemplateHtml(templateFile, metadata)
        importStage = 'registering'
        templateResult = await uploadTemplateHtml(templateFile, metadata)
      } else {
        importStage = 'validating'
        templateResult = await uploadTemplateZip(templateFile)
        importStage = 'registering'
      }
      await waitForPreview(templateResult)
      templateFile = null
      if (fileInput) fileInput.value = ''
    } catch (cause) { templateError = cause instanceof Error ? cause.message : '模板导入失败'; importStage = 'idle' }
    finally { templateBusy = false }
  }

  async function refreshRecovery(): Promise<void> {
    recoveryLoading = true; recoveryError = ''
    try { recovery = await loadRecoveryOverview() }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '恢复状态加载失败' }
    finally { recoveryLoading = false }
  }
  async function backupCurrentState(): Promise<void> {
    if (!recovery || recoveryLoading) return
    recoveryLoading = true; recoveryError = ''; recoveryNotice = ''
    try { const backup = await createLocalBackup(recovery.stateSha256); recovery = { ...recovery, backups: [backup, ...recovery.backups.filter((item) => item.id !== backup.id)] }; recoveryNotice = `备份清单已生成：${backup.objectCount} 个对象。` }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '本机备份失败' }
    finally { recoveryLoading = false }
  }
  async function restoreBackup(backup: RecoveryBackup): Promise<void> {
    if (recoveryLoading || backup.restored) return
    recoveryLoading = true; recoveryError = ''; recoveryNotice = ''
    try { const result = await runIsolatedRestore(backup); if (recovery) recovery = { ...recovery, backups: recovery.backups.map((item) => item.id === backup.id ? { ...item, restored: true } : item) }; recoveryNotice = `隔离恢复通过：${result.objectCount} 个对象、${result.presentationCount} 个汇报。` }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '隔离恢复失败' }
    finally { recoveryLoading = false }
  }
  async function downloadEncryptedBackup(backup: RecoveryBackup): Promise<void> {
    recoveryLoading = true; recoveryError = ''
    try { await downloadEncryptedRecoveryBackup(backup, recoveryPassphrase); recoveryPassphrase = ''; recoveryNotice = '加密备份已下载。' }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '加密备份下载失败' }
    finally { recoveryLoading = false }
  }
  async function importEncryptedBackup(): Promise<void> {
    if (!recoveryImportFile) return
    recoveryLoading = true; recoveryError = ''
    try { await importEncryptedRecoveryBackup(recoveryImportFile, recoveryPassphrase); recovery = await loadRecoveryOverview(); recoveryImportFile = null; recoveryPassphrase = ''; recoveryNotice = '加密备份已导入，请继续隔离恢复演练。' }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '加密备份导入失败' }
    finally { recoveryLoading = false }
  }
  async function prepareRecoveryActivation(backup: RecoveryBackup): Promise<void> {
    const expected = `ACTIVATE ${backup.id}`
    const confirmation = window.prompt(`请输入：${expected}`)
    if (confirmation === null) return
    recoveryLoading = true; recoveryError = ''
    try { await stageRecoveryActivation(backup, confirmation); recoveryNotice = '恢复激活已暂存；将在下次容器重启前再次校验。' }
    catch (cause) { recoveryError = cause instanceof Error ? cause.message : '恢复激活准备失败' }
    finally { recoveryLoading = false }
  }

  async function logout(): Promise<void> { try { await api.p15Logout() } finally { await goto('/login') } }

  onMount(() => {
    void load(); void refreshRecovery()
    if (location.hash === '#template-import') importOpen = true
  })
</script>

<svelte:head><title>平台管理 · 模板资产库</title></svelte:head>

<div class="admin-page">
  <header class="admin-header"><div><a href="/">← 返回资产库</a><h1>平台管理</h1></div><nav><button class="primary" type="button" onclick={() => { importOpen = true }}>导入 HTML 模板</button><ThemeSwitcher /><button type="button" onclick={() => void logout()}>退出</button></nav></header>
  <main class="admin-main">
    {#if error}<p class="message error" role="alert" tabindex="-1" bind:this={errorBox}>{error}</p>{/if}
    {#if temporaryPassword}<p class="message success" role="status">临时密码（仅此显示）：<code>{temporaryPassword}</code></p>{/if}

    <section class="admin-section" aria-labelledby="users-heading"><header><div><h2 id="users-heading">账号审批</h2><p>审批、停用成员并生成一次性临时密码。</p></div></header><div class="table-wrap"><table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{#each users as user (user.id)}<tr><td>{user.username}</td><td>{user.role}</td><td>{user.status}</td><td>{new Date(user.createdAt).toLocaleString('zh-CN')}</td><td>{#if user.status === 'pending'}<button onclick={() => void action(user.id, 'approve')} disabled={busy === user.id}>批准</button>{:else if user.status === 'active' && user.role === 'member'}<button onclick={() => void action(user.id, 'disable')} disabled={busy === user.id}>停用</button>{/if}{#if user.role === 'member'}<button onclick={() => void action(user.id, 'reset')} disabled={busy === user.id}>重置密码</button>{/if}</td></tr>{/each}</tbody></table></div></section>

    <section class="admin-section recovery" aria-labelledby="recovery-heading" aria-busy={recoveryLoading}><header><div><h2 id="recovery-heading">加密备份与恢复</h2><p>先生成加密异地备份，再在隔离目录验证，最后显式准备重启激活。</p></div><button type="button" disabled={!recovery || recoveryLoading} onclick={() => void backupCurrentState()}>生成备份清单</button></header>
      {#if recoveryError}<p class="message error" role="alert">{recoveryError}</p>{/if}
      {#if recovery}<p class="recovery-summary">{recovery.migrationCount} 条 migration · {recovery.objectCount} 个对象 · {recovery.derivativeCount} 个派生物 · <code>{recovery.stateSha256.slice(0,12)}…</code></p>{/if}
      <div class="recovery-controls"><label>备份口令<input type="password" bind:value={recoveryPassphrase} minlength="14" maxlength="200" placeholder="至少 14 个字符" /></label><label>导入 .pba<input type="file" accept=".pba,application/x-pocketbay-backup" onchange={(event) => { recoveryImportFile = event.currentTarget.files?.[0] ?? null }} /></label><button type="button" disabled={!recoveryImportFile || recoveryPassphrase.length < 14 || recoveryLoading} onclick={() => void importEncryptedBackup()}>解密并导入</button></div>
      {#if recovery?.backups.length}<ul class="backup-list">{#each recovery.backups as backup}<li><span>{backup.objectCount} 对象 · {backup.presentationCount} 汇报 · {backup.exportCount} 导出</span><div><a href={safeBackupManifestUrl(backup.manifestUrl)}>Manifest</a><button type="button" disabled={recoveryPassphrase.length < 14 || recoveryLoading} onclick={() => void downloadEncryptedBackup(backup)}>加密下载</button><button type="button" disabled={backup.restored || recoveryLoading} onclick={() => void restoreBackup(backup)}>{backup.restored ? '恢复已验证' : '隔离恢复'}</button><button type="button" disabled={!backup.restored || recoveryLoading} onclick={() => void prepareRecoveryActivation(backup)}>准备激活</button></div></li>{/each}</ul>{/if}
      {#if recoveryNotice}<p class="message success" role="status">{recoveryNotice}</p>{/if}
    </section>
  </main>
</div>

{#if importOpen}
  <div class="modal-backdrop">
    <button class="backdrop-close" type="button" aria-label="关闭导入弹窗" disabled={templateBusy} onclick={() => { importOpen = false }}></button>
    <div id="template-import" class="import-modal" role="dialog" aria-modal="true" aria-labelledby="template-import-heading" aria-busy={templateBusy} tabindex="-1">
      <header><div><h2 id="template-import-heading">导入 HTML 模板</h2><p>单文件 HTML 或标准 html-template/v1 ZIP</p></div><button type="button" aria-label="关闭导入弹窗" disabled={templateBusy} onclick={() => { importOpen = false }}>×</button></header>
      <div class="mode-tabs" role="tablist"><button class:active={importMode === 'html'} type="button" role="tab" aria-selected={importMode === 'html'} onclick={() => { importMode = 'html'; chooseFile(null); if (fileInput) fileInput.value = '' }}>HTML 文件</button><button class:active={importMode === 'zip'} type="button" role="tab" aria-selected={importMode === 'zip'} onclick={() => { importMode = 'zip'; chooseFile(null); if (fileInput) fileInput.value = '' }}>ZIP 包</button></div>
      <label class="drop-zone" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer?.files?.[0] ?? null) }}>
        <input class="sr-only" bind:this={fileInput} type="file" accept={accept()} onchange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} />
        <span class="upload-icon">⇧</span><strong>{templateFile ? templateFile.name : `拖入或点击选择 ${importMode === 'html' ? '.html / .htm' : '.zip'} 文件`}</strong><small>{importMode === 'html' ? 'UTF-8、自包含、最大 5 MiB；拒绝脚本与外链' : 'html-template/v1、最大 5 MiB、最多 32 个 HTML/CSS 文件'}</small>
      </label>
      {#if importMode === 'html'}<div class="metadata-grid"><label>模板标题<input bind:value={htmlTitle} maxlength="120" placeholder="例如：季度经营分析汇报" /></label><label>分类<input bind:value={htmlCategory} maxlength="80" placeholder="通用汇报" /></label><label class="wide">摘要<textarea bind:value={htmlSummary} maxlength="500" rows="3" placeholder="说明模板用途与适用场景"></textarea></label><label class="wide">标签<input bind:value={htmlTags} placeholder="使用逗号分隔，例如：季度汇报，管理层" /></label></div>{/if}
      <ol class="stage-list" aria-label="导入进度"><li class:active={importStage === 'validating'} class:done={['registering','previewing','ready'].includes(importStage)}>1 校验</li><li class:active={importStage === 'registering'} class:done={['previewing','ready'].includes(importStage)}>2 入库</li><li class:active={importStage === 'previewing'} class:done={importStage === 'ready'}>3 生成预览</li><li class:active={importStage === 'ready'}>4 目录可用</li></ol>
      {#if htmlValidation}<p class="validation">已规范化：{htmlValidation.normalizedFiles.join('、')} · {htmlValidation.sourceBytes} 字节</p>{/if}
      {#if templateJob}<p class="validation" role="status">任务 {templateJob.status} · 尝试 {templateJob.attempt}/{templateJob.maxAttempts}</p>{/if}
      {#if templateError}<p class="message error" role="alert">{templateError}</p>{/if}
      {#if templateResult && templateJob?.available}<p class="message success" role="status">模板 {templateResult.assetId} 已进入目录。<a href="/">返回资产库查看</a></p>{/if}
      <footer><button type="button" disabled={templateBusy} onclick={() => { importOpen = false }}>取消</button><button class="primary" type="button" disabled={!templateFile || templateBusy} onclick={() => void importTemplate()}>{templateBusy ? '正在处理…' : '校验并导入'}</button></footer>
    </div>
  </div>
{/if}

<style>
  .admin-page { min-height: 100vh; background: var(--lib-bg); color: var(--lib-text); }
  .admin-header { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 28px; border-bottom: 1px solid var(--lib-border); background: var(--lib-surface); }
  .admin-header > div, .admin-header nav { display: flex; align-items: center; gap: 18px; }.admin-header h1 { color: var(--lib-text-strong); font-size: 20px; }.admin-header a { color: var(--lib-accent); font-size: 12px; font-weight: 700; text-decoration: none; }
  button, input, textarea { font-family: var(--font-body); }.admin-header nav > button, .admin-section button, .import-modal button { min-height: 36px; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); padding: 0 11px; font-weight: 700; cursor: pointer; }.primary { border-color: var(--lib-accent-fill) !important; background: var(--lib-accent-fill) !important; color: #fff !important; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--lib-focus); outline-offset: 2px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .admin-main { max-width: 1180px; margin: 0 auto; padding: 28px; }
  .admin-section { margin-bottom: 24px; overflow: hidden; border: 1px solid var(--lib-border); border-radius: 9px; background: var(--lib-surface); }.admin-section > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px; border-bottom: 1px solid var(--lib-border); }.admin-section h2 { color: var(--lib-text-strong); font-size: 16px; }.admin-section header p { margin-top: 5px; color: var(--lib-muted); font-size: 12px; }
  .table-wrap { overflow-x: auto; }table { width: 100%; border-collapse: collapse; }th,td { padding: 12px 15px; border-bottom: 1px solid var(--lib-border); color: var(--lib-text); text-align: left; font-size: 12px; }th { background: var(--lib-surface-soft); color: var(--lib-muted); }td button { margin-right: 6px; }
  .message { margin: 14px 18px; padding: 11px 12px; border-radius: 6px; font-size: 12px; line-height: 1.55; }.error { border: 1px solid color-mix(in srgb,var(--lib-danger) 35%,var(--lib-border)); background: color-mix(in srgb,var(--lib-danger) 9%,var(--lib-surface)); color: var(--lib-danger); }.success { border: 1px solid color-mix(in srgb,var(--lib-success) 35%,var(--lib-border)); background: color-mix(in srgb,var(--lib-success) 9%,var(--lib-surface)); color: var(--lib-success); }.message a { margin-left: 7px; color: inherit; font-weight: 800; }
  .recovery { padding-bottom: 16px; }.recovery-summary { padding: 16px 18px 0; color: var(--lib-muted); font-size: 12px; }.recovery-controls { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: 10px; padding: 16px 18px; }.recovery-controls label { display: grid; gap: 6px; color: var(--lib-muted); font-size: 12px; }.recovery-controls input { min-width: 0; height: 36px; border: 1px solid var(--lib-border); border-radius: 5px; background: var(--lib-surface); color: var(--lib-text); padding: 0 8px; }.backup-list { display: grid; gap: 7px; margin: 0; padding: 0 18px; list-style: none; }.backup-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px; border: 1px solid var(--lib-border); border-radius: 6px; color: var(--lib-muted); font-size: 11px; }.backup-list li div { display: flex; flex-wrap: wrap; gap: 6px; }.backup-list a { color: var(--lib-accent); font-weight: 700; }
  .modal-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(2,7,14,.72); }.import-modal { width: min(720px,96vw); max-height: 94vh; overflow-y: auto; border: 1px solid var(--lib-border); border-radius: 10px; background: var(--lib-elevated); color: var(--lib-text); box-shadow: var(--lib-shadow-lg); }.import-modal > header { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 22px 16px; border-bottom: 1px solid var(--lib-border); }.import-modal h2 { color: var(--lib-text-strong); font-size: 19px; }.import-modal header p { margin-top: 5px; color: var(--lib-muted); font-size: 12px; }.import-modal header button { width: 34px; padding: 0; font-size: 22px; }
  .backdrop-close { position: absolute; inset: 0; width: 100%; height: 100%; border: 0 !important; border-radius: 0 !important; background: transparent !important; }
  .import-modal { position: relative; z-index: 1; }
  .mode-tabs { display: grid; grid-template-columns: 1fr 1fr; margin: 18px 22px 0; padding: 3px; border: 1px solid var(--lib-border); border-radius: 7px; background: var(--lib-surface-soft); }.mode-tabs button { border: 0; background: transparent; }.mode-tabs button.active { background: var(--lib-surface); color: var(--lib-accent); box-shadow: var(--lib-shadow); }
  .drop-zone { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; margin: 16px 22px; border: 1px dashed var(--lib-border-strong); border-radius: 8px; background: var(--lib-surface-soft); color: var(--lib-text); text-align: center; cursor: pointer; }.drop-zone:hover { border-color: var(--lib-accent); background: var(--lib-accent-soft); }.drop-zone small { color: var(--lib-muted); font-size: 11px; }.upload-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--lib-accent-soft); color: var(--lib-accent); font-size: 22px; }
  .metadata-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 22px 4px; }.metadata-grid label { display: grid; gap: 6px; color: var(--lib-muted); font-size: 12px; font-weight: 700; }.metadata-grid .wide { grid-column: 1/-1; }.metadata-grid input, .metadata-grid textarea { width: 100%; border: 1px solid var(--lib-border); border-radius: 6px; background: var(--lib-surface); color: var(--lib-text); padding: 9px 10px; resize: vertical; }
  .stage-list { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; margin: 16px 22px 0; padding: 0; list-style: none; overflow: hidden; border: 1px solid var(--lib-border); border-radius: 6px; }.stage-list li { padding: 9px 4px; background: var(--lib-surface-soft); color: var(--lib-muted); font-size: 11px; text-align: center; }.stage-list li.active { background: var(--lib-accent-fill); color: #fff; }.stage-list li.done { background: var(--lib-accent-soft); color: var(--lib-accent-strong); }.validation { margin: 10px 22px 0; color: var(--lib-muted); font-size: 11px; }
  .import-modal > footer { display: flex; justify-content: flex-end; gap: 9px; padding: 16px 22px 20px; }.import-modal > footer button { min-width: 90px; }
  @media (max-width: 700px) { .admin-header { align-items: flex-start; padding: 12px 14px; }.admin-header > div, .admin-header nav { align-items: flex-start; flex-direction: column; gap: 8px; }.admin-main { padding: 14px; }.recovery-controls { grid-template-columns: 1fr; }.backup-list li { align-items: flex-start; flex-direction: column; }.metadata-grid { grid-template-columns: 1fr; }.metadata-grid .wide { grid-column: auto; }.stage-list { grid-template-columns: 1fr 1fr; } }
</style>
