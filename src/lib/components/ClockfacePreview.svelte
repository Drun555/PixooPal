<script lang="ts">
  import { onDestroy } from 'svelte';

  export let previewSrc: string;
  export let fallbackSrc = '';
  export let mode: 'mjpeg' | 'polling' = 'mjpeg';

  const POLLING_INTERVAL_MS = 500;

  let usePolling = false;
  let pollingSrc = '';
  let activePreviewKey = '';
  let pollingTimer: ReturnType<typeof setInterval> | undefined;

  $: {
    const nextPreviewKey = `${mode}:${previewSrc}:${fallbackSrc}`;

    if (nextPreviewKey !== activePreviewKey) {
      activePreviewKey = nextPreviewKey;
      resetPreview();
    }
  }

  function resetPreview() {
    usePolling = false;
    pollingSrc = '';
    clearInterval(pollingTimer);
    pollingTimer = undefined;

    if (mode === 'polling') {
      startPollingPreview();
      return;
    }
  }

  function startPollingPreview() {
    usePolling = true;
    updatePollingSrc();
    pollingTimer ??= setInterval(updatePollingSrc, POLLING_INTERVAL_MS);
  }

  function updatePollingSrc() {
    const source = fallbackSrc || previewSrc;

    if (!source) {
      pollingSrc = '';
      return;
    }

    pollingSrc = `${source}${source.includes('?') ? '&' : '?'}t=${Date.now()}`;
  }

  onDestroy(() => {
    clearInterval(pollingTimer);
  });
</script>

<section class="preview-stage">
  <div class="preview-aura"></div>
  <div class="preview-shell">
    <div class="pixoo-frame">
      <div class="pixel-screen">
        {#if usePolling && pollingSrc}
          <img
            aria-label="Pixoo Buffer"
            alt=""
            src={pollingSrc}
          />
        {:else if previewSrc}
          <img
            aria-label="Pixoo Buffer"
            alt=""
            onerror={startPollingPreview}
            src={previewSrc}
          />
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .preview-stage {
    position: relative;
    display: grid;
    gap: 14px;
    place-items: center;
    isolation: isolate;
  }

  .preview-aura {
    position: absolute;
    z-index: -1;
    width: min(78vw, 520px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: rgba(47, 138, 122, 0.45);
    filter: blur(58px);
    opacity: 0.82;
    transform: scale(0.92);
  }

  .preview-shell {
    width: min(calc(42vw + 44px), 474px);
    max-width: 100%;
    padding: clamp(14px, 3vw, 22px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.02)),
      rgba(10, 13, 18, 0.72);
    box-shadow:
      0 0 80px rgba(47, 138, 122, 0.45),
      0 26px 82px rgba(0, 0, 0, 0.58),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .pixoo-frame {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 26px;
    background:
      linear-gradient(145deg, #2a303b, #11151d 62%),
      #151a23;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      inset 0 -16px 28px rgba(0, 0, 0, 0.26);
  }

  .pixel-screen {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    overflow: hidden;
    border-radius: 13px;
    background: #030405;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.05),
      inset 0 0 44px rgba(0, 0, 0, 0.84);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
  }

  @media (max-width: 860px) {
    .preview-stage {
      min-height: 0;
      padding: 8px 0;
    }

    .preview-shell {
      width: 100%;
    }

    .preview-aura {
      width: min(110vw, 520px);
    }

    .pixoo-frame {
      width: 100%;
    }
  }
</style>
