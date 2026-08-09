<script lang="ts">
  import { api } from '$lib/api'
  import { authMessage } from '$lib/auth'
  import { goto, invalidateAll } from '$app/navigation'
  import { onMount } from 'svelte'
  let currentPassword = $state('')
  let newPassword = $state('')
  let confirmPassword = $state('')
  let error = $state('')
  let busy = $state(false)
  let errorBox: HTMLElement | undefined = $state()
  let ready = $state(false)
  onMount(() => { ready = true })
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault(); error = ''
    if (newPassword !== confirmPassword) { error = '两次输入的密码不一致。'; requestAnimationFrame(() => errorBox?.focus()); return }
    busy = true
    try { await api.changePassword({ currentPassword, newPassword }); await invalidateAll(); await goto('/login') }
    catch (cause) { error = authMessage(cause instanceof Error ? cause.message : undefined); requestAnimationFrame(() => errorBox?.focus()) }
    finally { busy = false }
  }
</script>
<svelte:head><title>修改密码 · 模板资产库</title></svelte:head>
<main class="auth-page"><form onsubmit={submit} aria-busy={!ready || busy} data-auth-ready={ready ? 'true' : undefined}><h1>请修改临时密码</h1><p>修改后，所有旧会话都会立即失效。</p>{#if error}<p class="error" role="alert" tabindex="-1" bind:this={errorBox}>{error}</p>{/if}<label>当前密码<input type="password" autocomplete="current-password" bind:value={currentPassword} required /></label><label>新密码<input type="password" autocomplete="new-password" minlength="10" maxlength="128" bind:value={newPassword} required /></label><label>确认新密码<input type="password" autocomplete="new-password" minlength="10" maxlength="128" bind:value={confirmPassword} required /></label><button disabled={!ready || busy}>{busy ? '正在提交…' : '修改密码'}</button></form></main>
<style>.auth-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f8fafc}.auth-page form{display:grid;gap:16px;width:min(100%,420px);padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px}.auth-page p{color:#536178;line-height:1.6}.auth-page label{display:grid;gap:6px;font-weight:600}.auth-page input{padding:10px;border:1px solid #b8c3d2;border-radius:7px;font:inherit}.auth-page button{padding:11px;border:0;border-radius:7px;background:#1768e5;color:#fff;font:700 15px var(--font-body);cursor:pointer}.auth-page .error{padding:10px;border:1px solid #fecaca;border-radius:7px;background:#fef2f2;color:#b91c1c}.auth-page :focus-visible{outline:3px solid rgba(23,104,229,.32);outline-offset:2px}</style>
