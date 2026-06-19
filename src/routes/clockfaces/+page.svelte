<script lang="ts">
  import { AlertTriangle, Download, RefreshCw, Trash2, X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { apiUrl } from '$lib/client/urls';

  type CommunityClockface = {
    id: string;
    name: string;
    description?: string;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    pictureUrl?: string;
    sourceFiles?: string[];
    tags: string[];
    installed: boolean;
    outdated: boolean;
  };

  type CommunityClockfaceSourceFile = {
    path: string;
    name: string;
    kind: 'code' | 'image' | 'asset';
    url: string;
    language?: string;
    sourceCode?: string;
    highlightedSource?: string;
  };

  type CommunityClockfaceDetail = CommunityClockface & {
    files: CommunityClockfaceSourceFile[];
    sourceCode: string;
    highlightedSource: string;
  };

  type CommunityClockfacesPayload = {
    ok: boolean;
    clockfaces: CommunityClockface[];
    message?: string;
  };

  type CommunityClockfaceDetailPayload = {
    ok: boolean;
    clockface: CommunityClockfaceDetail;
    message?: string;
  };

  type ActionState = 'busy' | 'done' | 'error';

  let clockfaces: CommunityClockface[] = [];
  let actionState: Record<string, ActionState> = {};
  let detailState: Record<string, ActionState> = {};
  let selectedClockface: CommunityClockfaceDetail | undefined;
  let selectedSourcePath = '';
  let loading = true;
  let message = '';

  $: selectedSourceFile =
    selectedClockface?.files.find((file) => file.path === selectedSourcePath) ??
    selectedClockface?.files[0];

  async function refreshCatalog() {
    loading = true;
    message = '';

    try {
      const response = await fetch(apiUrl('/api/v1/community-clockfaces'), {
        cache: 'no-store'
      });
      const body = (await response.json()) as CommunityClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Community clockfaces were not loaded.');
      }

      clockfaces = body.clockfaces ?? [];
    } catch (error) {
      message = error instanceof Error ? error.message : 'Community clockfaces were not loaded.';
    } finally {
      loading = false;
    }
  }

  async function openReview(clockface: CommunityClockface) {
    detailState = { ...detailState, [clockface.id]: 'busy' };
    message = '';

    try {
      const response = await fetch(apiUrl(`/api/v1/community-clockfaces/${encodeURIComponent(clockface.id)}`), {
        cache: 'no-store'
      });
      const body = (await response.json()) as CommunityClockfaceDetailPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface details were not loaded.');
      }

      selectedClockface = body.clockface;
      selectedSourcePath = getInitialSourcePath(body.clockface);
      detailState = { ...detailState, [clockface.id]: 'done' };
    } catch (error) {
      message = error instanceof Error ? error.message : 'Clockface details were not loaded.';
      detailState = { ...detailState, [clockface.id]: 'error' };
    }
  }

  async function installClockface(clockface: CommunityClockface) {
    actionState = { ...actionState, [clockface.id]: 'busy' };
    message = '';

    try {
      const response = await fetch(apiUrl('/api/v1/community-clockfaces'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id: clockface.id })
      });
      const body = (await response.json()) as CommunityClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface was not installed.');
      }

      clockfaces = body.clockfaces ?? clockfaces;
      selectedClockface = undefined;
      actionState = { ...actionState, [clockface.id]: 'done' };
    } catch (error) {
      message = error instanceof Error ? error.message : 'Clockface was not installed.';
      actionState = { ...actionState, [clockface.id]: 'error' };
    }
  }

  async function installSelectedClockface() {
    if (!selectedClockface) {
      return;
    }

    await installClockface(selectedClockface);
  }

  async function deleteClockface(clockface: CommunityClockface) {
    actionState = { ...actionState, [clockface.id]: 'busy' };
    message = '';

    try {
      const response = await fetch(apiUrl(`/api/v1/community-clockfaces/${encodeURIComponent(clockface.id)}`), {
        method: 'DELETE'
      });
      const body = (await response.json()) as CommunityClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface was not deleted.');
      }

      clockfaces = body.clockfaces ?? clockfaces;
      selectedClockface = undefined;
      actionState = { ...actionState, [clockface.id]: 'done' };
    } catch (error) {
      message = error instanceof Error ? error.message : 'Clockface was not deleted.';
      actionState = { ...actionState, [clockface.id]: 'error' };
    }
  }

  async function deleteSelectedClockface() {
    if (!selectedClockface) {
      return;
    }

    await deleteClockface(selectedClockface);
  }

  function reviewLabel(clockface: CommunityClockface) {
    const detail = detailState[clockface.id];

    if (detail === 'busy') {
      return 'Loading';
    }

    if (detail === 'error') {
      return 'Retry';
    }

    return 'Open';
  }

  function installLabel(clockface: CommunityClockface) {
    if (actionState[clockface.id] === 'busy') {
      return 'Working';
    }

    return clockface.installed ? 'Update' : 'Add';
  }

  function formatDate(value: string | undefined) {
    if (!value) {
      return 'Unknown';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function closeReview() {
    selectedClockface = undefined;
    selectedSourcePath = '';
  }

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      closeReview();
    }
  }

  function stopReviewEvent(event: Event) {
    event.stopPropagation();
  }

  function getInitialSourcePath(clockface: CommunityClockfaceDetail) {
    return (
      clockface.files.find((file) => file.path.endsWith('.ts'))?.path ??
      clockface.files.find((file) => file.kind === 'code')?.path ??
      clockface.files[0]?.path ??
      ''
    );
  }

  function selectSourceFile(file: CommunityClockfaceSourceFile) {
    selectedSourcePath = file.path;
  }

  function fileLabel(file: CommunityClockfaceSourceFile) {
    return file.path.replace(/^\.?\/*src\/[^/]+\//, '');
  }

  function tagClass(tag: string) {
    return tag.toLowerCase() === 'home assistant' ? 'tag-home-assistant' : 'tag-default';
  }

  onMount(() => {
    refreshCatalog();
  });
</script>

<svelte:head>
  <title>Clockfaces - PixooPal</title>
  <meta name="description" content="Browse PixooPal Community clockfaces" />
</svelte:head>

<main class="catalog-shell">
  <header class="catalog-head">
    <div>
      <h1>Clockfaces</h1>
      <p>Third-party clockfaces from <a href="https://github.com/Drun555/PixooPal-Community">PixooPal Community repository.</a></p>
    </div>
  </header>

  {#if message}
    <p class="message">{message}</p>
  {/if}

  {#if loading}
    <div class="empty-state">Loading community clockfaces.</div>
  {:else if clockfaces.length === 0}
    <div class="empty-state">No community clockfaces found.</div>
  {:else}
    <div class="clockface-grid">
      {#each clockfaces as clockface}
        <article class="clockface-card">
          <div class="picture">
            {#if clockface.pictureUrl}
              <img src={clockface.pictureUrl} alt={clockface.name} loading="lazy" />
            {:else}
              <span>{clockface.name.slice(0, 1)}</span>
            {/if}
          </div>

          <div class="card-body">
            <div class="title-row">
              <h2>{clockface.name}</h2>
              <div class="status-pills">
                {#if clockface.installed}
                  <span class="status-pill installed">Installed</span>
                {/if}
                {#if clockface.outdated}
                  <span class="status-pill">Update</span>
                {/if}
                {#each clockface.tags ?? [] as tag}
                  <span class={`status-pill tag ${tagClass(tag)}`}>{tag}</span>
                {/each}
              </div>
            </div>
            <p>{clockface.description || 'No description.'}</p>
            <div class="author">by {clockface.author || 'Unknown author'}</div>
          </div>

          <button
            class:error={detailState[clockface.id] === 'error'}
            type="button"
            disabled={detailState[clockface.id] === 'busy'}
            onclick={() => openReview(clockface)}
          >
            {#if detailState[clockface.id] === 'busy'}
              <RefreshCw class="spinner" size={16} />
            {:else}
              <Download size={16} />
            {/if}
            <span>{reviewLabel(clockface)}</span>
          </button>
        </article>
      {/each}
    </div>
  {/if}
</main>

{#if selectedClockface}
  <div
    class="modal-backdrop"
    transition:fade={{ duration: 180 }}
    role="button"
    tabindex="0"
    aria-label="Close clockface source review"
    onclick={closeReview}
    onkeydown={handleBackdropKeydown}
  >
    <div
      class="review-modal"
      transition:scale={{ duration: 190, start: 0.97 }}
      aria-label="Clockface source review"
      role="dialog"
      tabindex="-1"
      onclick={stopReviewEvent}
      onkeydown={stopReviewEvent}
    >
      <div class="review-main">
        <div class="warning-row">
          <div class="warning">
            <AlertTriangle size={18} />
            <span>Review this code before installing. Community clockfaces have no restrictions, so they can be potentially dangerous.</span>
          </div>
          <button class="icon-button" type="button" aria-label="Close" onclick={closeReview}>
            <X size={20} />
          </button>
        </div>

        <div class="file-tabs" aria-label="Clockface source files">
          {#each selectedClockface.files as file}
            <button
              class:active={selectedSourceFile?.path === file.path}
              type="button"
              title={file.path}
              onclick={() => selectSourceFile(file)}
            >
              {fileLabel(file)}
            </button>
          {/each}
        </div>

        <div class="source-frame" class:asset-frame={selectedSourceFile?.kind !== 'code'}>
          {#if selectedSourceFile?.kind === 'code' && selectedSourceFile.highlightedSource}
            {@html selectedSourceFile.highlightedSource}
          {:else if selectedSourceFile?.kind === 'image'}
            <div class="asset-preview">
              <img src={selectedSourceFile.url} alt={selectedSourceFile.name} />
              <a href={selectedSourceFile.url} target="_blank" rel="noreferrer">Open raw file</a>
            </div>
          {:else if selectedSourceFile}
            <div class="asset-preview">
              <strong>{selectedSourceFile.name}</strong>
              <span>This file is not previewed as source code.</span>
              <a href={selectedSourceFile.url} target="_blank" rel="noreferrer">Open raw file</a>
            </div>
          {:else}
            <div class="asset-preview">
              <span>No source files were provided.</span>
            </div>
          {/if}
        </div>
      </div>

      <aside class="review-side">
        <div class="side-picture">
          {#if selectedClockface.pictureUrl}
            <img src={selectedClockface.pictureUrl} alt={selectedClockface.name} />
          {:else}
            <span>{selectedClockface.name.slice(0, 1)}</span>
          {/if}
        </div>

        <div class="info-card">
          <dl>
            <div>
              <dt>Author</dt>
              <dd>{selectedClockface.author}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{selectedClockface.name}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{selectedClockface.description}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(selectedClockface.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(selectedClockface.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        <div class="modal-actions">
          {#if !selectedClockface.installed || selectedClockface.outdated}
            <button
              class="install-button"
              class:error={actionState[selectedClockface.id] === 'error'}
              type="button"
              disabled={actionState[selectedClockface.id] === 'busy'}
              onclick={installSelectedClockface}
            >
              <Download size={16} />
              <span>{installLabel(selectedClockface)}</span>
            </button>
          {/if}

          {#if selectedClockface.installed}
            <button
              class="install-button danger"
              class:error={actionState[selectedClockface.id] === 'error'}
              type="button"
              disabled={actionState[selectedClockface.id] === 'busy'}
              onclick={deleteSelectedClockface}
            >
              <Trash2 size={16} />
              <span>{actionState[selectedClockface.id] === 'busy' ? 'Working' : 'Delete'}</span>
            </button>
          {/if}
        </div>
      </aside>
    </div>
  </div>
{/if}

<style>
  button {
    min-width: 0;
    border: 0;
    font: inherit;
  }

  .catalog-shell {
    display: grid;
    width: min(1180px, calc(100% - 28px));
    margin: 0 auto;
    padding: clamp(22px, 4vh, 42px) 0 42px;
    gap: 18px;
  }

  .catalog-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }

  .catalog-head h1 {
    margin: 0;
    color: #f8fbff;
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    line-height: 1;
    letter-spacing: 0;
  }

  .catalog-head p {
    margin: 8px 0 0;
    color: #91a1b5;
    font-size: 0.95rem;
    font-weight: 750;
  }

  .catalog-head a {
    color: #76dcca;
  }

  .clockface-card button,
  .install-button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;
    color: #07110f;
    background: #76dcca;
    cursor: pointer;
    font-weight: 850;
  }

  .clockface-card button:disabled,
  .install-button:disabled {
    cursor: progress;
    opacity: 0.68;
  }

  .message,
  .empty-state {
    margin: 0;
    padding: 14px 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: #d9e2ec;
    background: rgba(12, 16, 23, 0.78);
    font-weight: 800;
  }

  .message {
    color: #ffb8a8;
  }

  .clockface-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 14px;
  }

  .clockface-card {
    display: grid;
    min-height: 100%;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: rgba(12, 16, 23, 0.78);
    box-shadow:
      0 18px 48px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .picture,
  .side-picture {
    display: grid;
    aspect-ratio: 1;
    place-items: center;
    background: #05070c;
  }

  .picture img,
  .side-picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
  }

  .picture span,
  .side-picture span {
    color: #76dcca;
    font-size: 4rem;
    font-weight: 950;
  }

  .card-body {
    display: grid;
    gap: 8px;
    padding: 14px 14px 4px;
  }

  .title-row {
    display: grid;
    min-width: 0;
    gap: 7px;
  }

  .card-body h2 {
    min-width: 0;
    margin: 0;
    color: #f8fbff;
    font-size: 1.02rem;
    line-height: 1.2;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }

  .status-pill {
    display: inline-flex;
    flex: 0 0 auto;
    min-height: 25px;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border-radius: 999px;
    color: #07110f;
    background: #ffd36e;
    font-size: 0.72rem;
    font-weight: 900;
    line-height: 1;
    white-space: nowrap;
  }

  .status-pill.installed {
    color: #dce7f2;
    background: rgba(255, 255, 255, 0.1);
  }

  .status-pill.tag {
    color: #dce7f2;
    background: rgba(255, 255, 255, 0.1);
  }

  .status-pill.tag-home-assistant {
    color: #072033;
    background: #75c9ff;
  }

  .status-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: start;
    gap: 5px;
  }

  .card-body p {
    margin: 0;
    color: #91a1b5;
    font-size: 0.86rem;
    line-height: 1.45;
    font-weight: 750;
  }

  .author {
    color: #d7e2ee;
    font-size: 0.78rem;
    font-weight: 850;
  }

  .clockface-card button {
    margin: 14px;
  }

  .spinner {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .install-button.danger {
    color: #ffffff;
    background: #b84b45;
  }

  .clockface-card button.error,
  .install-button.error {
    color: #ffffff;
    background: #b84b45;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(2, 5, 10, 0.76);
  }

  .review-modal {
    display: grid;
    width: min(1180px, 100%);
    height: min(820px, calc(100vh - 48px));
    grid-template-columns: minmax(0, 1fr) minmax(190px, 20%);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    background: #0a0f17;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  }

  .review-main {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 12px;
    padding: 18px;
  }

  .warning-row {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 12px;
  }

  .icon-button {
    display: grid;
    width: 52px;
    min-height: 52px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #e8eef7;
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
  }

  .warning {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    gap: 10px;
    padding: 11px 12px;
    border: 1px solid rgba(255, 211, 110, 0.34);
    border-radius: 8px;
    color: #ffe6a9;
    background: rgba(255, 181, 53, 0.1);
    font-size: 0.9rem;
    font-weight: 850;
  }

  .warning :global(svg) {
    flex: 0 0 auto;
  }

  .source-frame {
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: #0d1117;
  }

  .file-tabs {
    display: flex;
    min-width: 0;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-color: #6f7b8a #151b24;
    scrollbar-width: thin;
  }

  .file-tabs button {
    display: inline-flex;
    min-height: 34px;
    max-width: 220px;
    flex: 0 0 auto;
    align-items: center;
    padding: 0 10px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: #aeb9c8;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-tabs button.active {
    color: #07110f;
    border-color: transparent;
    background: #76dcca;
  }

  .file-tabs::-webkit-scrollbar {
    height: 8px;
  }

  .file-tabs::-webkit-scrollbar-track {
    background: #151b24;
    border-radius: 999px;
  }

  .file-tabs::-webkit-scrollbar-thumb {
    border: 2px solid #151b24;
    border-radius: 999px;
    background: #6f7b8a;
  }

  .source-frame :global(pre) {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: 100%;
    margin: 0;
    padding: 16px;
    overflow: auto !important;
    font-size: 0.82rem;
    line-height: 1.55;
    scrollbar-color: #6f7b8a #151b24;
    scrollbar-width: thin;
  }

  .source-frame :global(pre::-webkit-scrollbar),
  .review-modal::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  .source-frame :global(pre::-webkit-scrollbar-track),
  .review-modal::-webkit-scrollbar-track {
    background: #151b24;
    border-radius: 999px;
  }

  .source-frame :global(pre::-webkit-scrollbar-thumb),
  .review-modal::-webkit-scrollbar-thumb {
    border: 2px solid #151b24;
    border-radius: 999px;
    background: #6f7b8a;
  }

  .source-frame :global(pre::-webkit-scrollbar-thumb:hover),
  .review-modal::-webkit-scrollbar-thumb:hover {
    background: #93a0af;
  }

  .source-frame.asset-frame {
    display: grid;
    place-items: center;
    padding: 18px;
  }

  .asset-preview {
    display: grid;
    max-width: min(460px, 100%);
    justify-items: center;
    gap: 12px;
    color: #d7e2ee;
    text-align: center;
    font-weight: 850;
  }

  .asset-preview img {
    display: block;
    max-width: 100%;
    max-height: min(420px, 56vh);
    object-fit: contain;
    image-rendering: pixelated;
  }

  .asset-preview span {
    color: #91a1b5;
    font-size: 0.9rem;
  }

  .asset-preview a {
    color: #76dcca;
  }

  .review-side {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 18px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
  }

  .info-card {
    display: grid;
    gap: 22px;
  }

  .review-side dl {
    display: grid;
    gap: 20px;
    margin: 0;
  }

  .review-side dt {
    color: #91a1b5;
    font-size: 0.76rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .review-side dd {
    margin: 3px 0 0;
    color: #f8fbff;
    font-size: 0.88rem;
    font-weight: 850;
    overflow-wrap: anywhere;
  }

  .install-button {
    width: 100%;
  }

  .modal-actions {
    display: grid;
    gap: 10px;
  }

  @media (max-width: 760px) {
    .catalog-head {
      display: grid;
      align-items: start;
    }

    .modal-backdrop {
      padding: 12px;
    }

    .review-modal {
      height: calc(100vh - 24px);
      grid-template-columns: 1fr;
      overflow: auto;
    }

    .review-main {
      min-height: min(620px, calc(100vh - 24px));
    }

    .review-side {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 0;
    }

    .side-picture {
      max-width: 180px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
