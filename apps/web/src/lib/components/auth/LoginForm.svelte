<script lang="ts">
  import { api } from '$lib/api';
  import { authMessage } from '$lib/auth';
  import { goto, invalidateAll } from '$app/navigation';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let errorBox: HTMLElement | undefined = $state()
  let loading = $state(false);
  let ready = $state(false);

  onMount(() => { ready = true });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const { user } = await api.loginAccount({ username, password });
      await invalidateAll();
      await goto(user.mustChangePassword ? `${base}/change-password` : `${base}/`);
    } catch (err: any) {
      error = authMessage(err?.message);
      requestAnimationFrame(() => errorBox?.focus());
    } finally {
      loading = false;
    }
  }
</script>

<form onsubmit={handleSubmit} class="auth-form" aria-busy={!ready || loading} data-auth-ready={ready ? 'true' : undefined}>
  <div class="form-header">
    <h1>模板资产库</h1>
    <p>登录后管理个人汇报与导出</p>
  </div>

  <div class="form-body">
    {#if error}
      <div class="error-message" role="alert" tabindex="-1" bind:this={errorBox}>{error}</div>
    {/if}

    <label class="field">
      <span>用户名</span>
      <input
        autocomplete="username"
        bind:value={username}
        placeholder="3–32 位：字母、数字、._-"
        required
      />
    </label>

    <label class="field">
      <span>密码</span>
      <input
        type="password"
        bind:value={password}
        autocomplete="current-password"
        placeholder="请输入密码"
        required
      />
    </label>

    <button type="submit" class="btn-primary" disabled={!ready || loading}>
      {loading ? '正在登录…' : '登录'}
    </button>

    <p class="form-footer">
      还没有账号？<a href="{base}/register">注册</a>
    </p>
  </div>
</form>

<style>
  .auth-form {
    width: 100%;
    max-width: 420px;
    background: var(--color-bg);
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .form-header {
    background: var(--color-primary-dark);
    color: white;
    padding: 2rem;
    text-align: center;
  }

  .form-header h1 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .form-header p {
    font-size: 1.125rem;
    opacity: 0.85;
  }


  .form-body {
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .error-message {
    background: #fef2f2;
    color: var(--color-error);
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    border: 1px solid #fecaca;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field span {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .field input {
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    font-family: var(--font-body);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .field input:focus {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(59, 115, 230, 0.15);
  }

  .btn-primary {
    padding: 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-full);
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: var(--font-body);
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-footer {
    text-align: center;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .form-footer a {
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 500;
  }

  .form-footer a:hover {
    text-decoration: underline;
  }
</style>
