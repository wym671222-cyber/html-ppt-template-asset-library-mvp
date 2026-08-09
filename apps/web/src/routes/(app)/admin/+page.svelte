<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '$lib/api'
  import { authMessage, type SessionUser } from '$lib/auth'
  import { goto } from '$app/navigation'
  let users = $state<SessionUser[]>([])
  let error = $state('')
  let temporaryPassword = $state('')
  let busy = $state<string | null>(null)
  let errorBox: HTMLElement | undefined = $state()
  async function load(): Promise<void> { try { users = (await api.p15ListUsers()).users } catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) } }
  async function action(id: string, kind: 'approve' | 'disable' | 'reset'): Promise<void> { busy = id; error = ''; temporaryPassword = ''; try { if (kind === 'approve') await api.p15ApproveUser(id); else if (kind === 'disable') await api.p15DisableUser(id); else temporaryPassword = (await api.p15ResetPassword(id)).temporaryPassword; await load() } catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) } finally { busy = null } }
  async function logout(): Promise<void> { try { await api.p15Logout() } finally { await goto('/login') } }
  onMount(() => { void load() })
</script>

<svelte:head>
  <title>账号审批 · 模板资产库</title>
</svelte:head>

  <div class="admin-page">
    <header class="admin-header">
      <div class="header-left">
        <a href="/" class="back-link">&larr; 返回资产库</a>
        <h1>账号审批</h1>
      </div>
      <button class="logout" type="button" onclick={() => void logout()}>退出</button>
    </header>

    <main class="admin-main">
      {#if error}<p class="error" role="alert" tabindex="-1" bind:this={errorBox}>{error}</p>{/if}
      {#if temporaryPassword}<p class="temporary" role="status">临时密码（仅此显示）：<code>{temporaryPassword}</code></p>{/if}
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
