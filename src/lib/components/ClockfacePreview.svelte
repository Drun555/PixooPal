<script lang="ts">
  import { onDestroy } from 'svelte';

  export let previewSrc: string;
  export let fallbackSrc = '';
  export let resolution = 64;

  const WEBSOCKET_RECONNECT_MAX_MS = 5000;
  const PREVIEW_RESOLUTIONS = [16, 32, 64] as const;

  let websocketSrc = '';
  let useMjpegFallback = false;
  let activePreviewKey = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelayMs = 500;
  let previewSocket: WebSocket | undefined;
  let objectUrl = '';

  $: normalizedResolution = normalizePreviewResolution(resolution);
  $: displayedPreviewSrc = useMjpegFallback && fallbackSrc ? fallbackSrc : websocketSrc;

  $: {
    const nextPreviewKey = `${previewSrc}:${fallbackSrc}`;

    if (nextPreviewKey !== activePreviewKey) {
      activePreviewKey = nextPreviewKey;
      resetPreview();
    }
  }

  function resetPreview() {
    websocketSrc = '';
    useMjpegFallback = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    closePreviewSocket();
    revokeObjectUrl();
    connectPreviewWebSocket();
  }

  function connectPreviewWebSocket() {
    if (typeof WebSocket === 'undefined' || !previewSrc) {
      useMjpegFallback = true;
      return;
    }

    closePreviewSocket();

    const socket = new WebSocket(previewSrc);
    previewSocket = socket;
    socket.binaryType = 'blob';

    socket.onopen = () => {
      reconnectDelayMs = 500;
    };

    socket.onmessage = (event) => {
      const blob = event.data instanceof Blob ? event.data : new Blob([event.data], { type: 'image/jpeg' });
      const nextObjectUrl = URL.createObjectURL(blob);
      const previousObjectUrl = objectUrl;
      objectUrl = nextObjectUrl;
      websocketSrc = nextObjectUrl;
      useMjpegFallback = false;

      if (previousObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
      }
    };

    socket.onclose = () => {
      if (previewSocket === socket) {
        previewSocket = undefined;
        useMjpegFallback = true;
        schedulePreviewReconnect();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  function schedulePreviewReconnect() {
    if (!previewSrc) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectPreviewWebSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 1.8, WEBSOCKET_RECONNECT_MAX_MS);
  }

  function closePreviewSocket() {
    previewSocket?.close();
    previewSocket = undefined;
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
  }

  onDestroy(() => {
    clearTimeout(reconnectTimer);
    closePreviewSocket();
    revokeObjectUrl();
  });

  function normalizePreviewResolution(value: number) {
    const rounded = Math.round(Number(value));
    return PREVIEW_RESOLUTIONS.find((item) => item === rounded) ?? 64;
  }
</script>

<section class="preview-stage">
  <div class="preview-shell">
    {#if displayedPreviewSrc}
      <img
        class="ambient-light"
        aria-hidden="true"
        alt=""
        src={displayedPreviewSrc}
      />
    {/if}
    <div class="pixoo-frame">
      <div class="pixel-screen" style:--preview-resolution={normalizedResolution}>
        {#if displayedPreviewSrc}
          <img
            aria-label="Pixoo Buffer"
            alt=""
            src={displayedPreviewSrc}
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
    width: 100%;
    height: 100%;
    container-type: size;
    gap: 14px;
    place-items: end center;
    isolation: isolate;
  }

  .preview-shell {
    position: relative;
    width: min(100cqw, 100cqh);
    height: min(100cqw, 100cqh);
    max-width: 100%;
    max-height: 100%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.02)),
      rgba(10, 13, 18, 0.72);
    box-shadow:
      0 26px 82px rgba(0, 0, 0, 0.58),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .ambient-light {
    position: absolute;
    inset: 4%;
    z-index: -1;
    width: 92%;
    height: 92%;
    border-radius: 24px;
    filter: blur(34px) saturate(1.85) brightness(1.18);
    image-rendering: auto;
    object-fit: cover;
    opacity: 0.62;
    pointer-events: none;
    transform: scale(1.1);
  }

  .pixoo-frame {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
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
    position: relative;
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

  .pixel-screen::before,
  .pixel-screen::after {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    content: '';
  }

  .pixel-screen::before {
    box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.72);
    opacity: 1;
  }

  .pixel-screen::after {
    background-image:
      radial-gradient(
        circle at 42% 36%,
        rgba(255, 255, 255, 0.2) 0 8%,
        rgba(255, 255, 255, 0.07) 18%,
        transparent 34%,
        rgba(0, 0, 0, 0.12) 62%,
        rgba(0, 0, 0, 0.5) 100%
      ),
      linear-gradient(to right, rgba(0, 0, 0, 0.42), transparent 20% 76%, rgba(0, 0, 0, 0.44)),
      linear-gradient(to bottom, rgba(0, 0, 0, 0.42), transparent 18% 74%, rgba(0, 0, 0, 0.48));
    background-size: calc(100% / var(--preview-resolution)) calc(100% / var(--preview-resolution));
    mix-blend-mode: multiply;
    opacity: 0.62;
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
      width: min(100%, 500px);
    }

    .pixoo-frame {
      width: 100%;
    }
  }

</style>
