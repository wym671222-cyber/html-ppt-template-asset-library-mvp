<script lang="ts">
  import LoginForm from '$lib/components/auth/LoginForm.svelte';
</script>

<svelte:head>
  <title>登录 · 模板资产库</title>
</svelte:head>

<div class="auth-page">
  <LoginForm />
</div>

<style>
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-secondary);
    padding: 1rem;
  }
</style>
