<script lang="ts">
  import { page } from '$app/state';

  const tabs = [
    { href: '/', label: 'Home' },
    { href: '/clockfaces', label: 'Clockfaces' }
  ];

  function isActive(href: string) {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }
</script>

<div class="app-shell">
  <nav class="tabs" aria-label="PixooPal navigation">
    {#each tabs as tab}
      <a class:active={isActive(tab.href)} href={tab.href}>{tab.label}</a>
    {/each}
  </nav>

  <slot />
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background:
      radial-gradient(circle at 50% 17%, rgba(56, 72, 96, 0.34), transparent 24rem),
      linear-gradient(180deg, #10141d 0%, #07090d 100%);
    color: #edf2f7;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .app-shell {
    min-height: 100vh;
  }

  .tabs {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    width: min(1180px, calc(100% - 28px));
    margin: 0 auto;
    padding: 12px 0 0;
    gap: 8px;
  }

  .tabs a {
    display: inline-flex;
    min-height: 38px;
    align-items: center;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: #aeb9c8;
    background: rgba(12, 16, 23, 0.78);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 850;
    backdrop-filter: blur(14px);
  }

  .tabs a.active {
    color: #07110f;
    border-color: transparent;
    background: #76dcca;
  }
</style>
