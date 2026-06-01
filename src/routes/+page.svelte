<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Bell, Layers, Monitor, Power, Save, Send, Sun, Volume2, Wifi } from '@lucide/svelte';
  import ClockfaceInputs from '$lib/components/ClockfaceInputs.svelte';

  type PixooSettings = {
    Brightness?: number;
    LightSwitch?: number;
    CurClockId?: number;
    Time24Flag?: number;
    TemperatureMode?: number;
    MirrorFlag?: number;
    [key: string]: unknown;
  };

  type PreviewPayload = {
    size: number;
    buffer: number[];
  };

  type StatusPayload = {
    ok: boolean;
    reachable: boolean;
    config: {
      pixooAddress: string;
      pixooHost: string;
      pixooPostUrl: string;
      webuiPort: string;
    };
    settings: PixooSettings | null;
    recovery?: {
      reachable: boolean;
      drawCooldownRemainingMs: number;
      drawReadyAt: string | null;
    };
    activeClockface: ClockfaceView | null;
    message?: string;
  };

  type ActionState = 'busy' | 'sent' | 'error';

  type ClockfaceInputView = {
    type: 'button' | 'colorpicker' | 'input-text' | 'input-num' | 'input-file' | 'select';
    id: string;
    friendlyName: string;
    options?: { value: string; label: string }[];
    accept?: string;
    min?: number;
    max?: number;
    step?: number;
    isSetting?: boolean;
  };
  type ClockfaceInputRowView = ClockfaceInputView[];

  type ClockfaceView = {
    id: string;
    name: string;
    description?: string;
    picture?: string;
    resolution: number;
    updateIntervalMs: number;
    data: Record<string, string>;
    inputs: ClockfaceInputRowView[];
  };

  type ClockfacesPayload = {
    ok: boolean;
    activeId: string;
    clockfaces: ClockfaceView[];
    active: ClockfaceView | null;
    message?: string;
  };

  type PixooPalEvent =
    | {
        type: 'preview';
        activeId: string;
        updateIntervalMs: number;
        preview: PreviewPayload;
      }
    | {
        type: 'clockface_changed';
        activeId: string;
        clockface: ClockfaceView | null;
      }
    | {
        type: 'clockface_data_changed';
        activeId: string;
        data: Record<string, string>;
      }
    | {
        type: 'device_status';
        reachable: boolean;
        status: StatusPayload;
      }
    | {
        type: 'notification';
        message: string;
        beep: boolean;
      };

  const PREVIEW_SIZE = 64;

  let status: StatusPayload | null = null;
  let clockfaces: ClockfaceView[] = [];
  let activeClockface: ClockfaceView | null = null;
  let activeClockfaceId = '';
  let buttonState: Record<string, ActionState> = {};
  let buttonTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let previewSocket: WebSocket | undefined;
  let previewReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let previewReconnectDelayMs = 500;
  let pixooAddress = '';
  let brightness = 50;
  let powered = true;
  let notificationText = '';
  let notificationBeep = true;
  let previewCanvas: HTMLCanvasElement;
  let preview = createEmptyPreview();
  let glowColor = 'rgba(47, 138, 122, 0.45)';

  $: activeClockfaceHasSettings =
    activeClockface?.inputs.some((row) => row.some((input) => input.isSetting === true)) === true;

  $: pixooConnectionLabel = getPixooConnectionLabel(status);
  $: paintPreview(previewCanvas, preview);
  $: previewStyle = `--preview-glow: ${glowColor}`;

  function createEmptyPreview(): PreviewPayload {
    return {
      size: PREVIEW_SIZE,
      buffer: new Array(PREVIEW_SIZE * PREVIEW_SIZE * 3).fill(0)
    };
  }

  function syncFromSettings(settings: PixooSettings | null) {
    if (!settings) {
      return;
    }

    if (typeof settings.Brightness === 'number') {
      brightness = settings.Brightness;
    }

    if (typeof settings.LightSwitch === 'number') {
      powered = settings.LightSwitch === 1;
    }
  }

  function syncConfig(config: StatusPayload['config'] | undefined) {
    if (!config) {
      return;
    }

    pixooAddress = config.pixooAddress || config.pixooHost || pixooAddress;
  }

  function syncPreview(nextPreview?: PreviewPayload) {
    if (!nextPreview || !Array.isArray(nextPreview.buffer)) {
      return;
    }

    preview = nextPreview;
  }

  function syncClockfaces(body: ClockfacesPayload) {
    clockfaces = body.clockfaces ?? [];
    activeClockface = body.active ?? null;
    activeClockfaceId = body.activeId ?? body.active?.id ?? '';
  }

  function syncActiveClockfaceData(activeId: string, data: Record<string, string>) {
    if (activeClockface?.id === activeId) {
      activeClockface = {
        ...activeClockface,
        data: {
          ...activeClockface.data,
          ...data
        }
      };
    }

    clockfaces = clockfaces.map((clockface) =>
      clockface.id === activeId
        ? {
            ...clockface,
            data: {
              ...clockface.data,
              ...data
            }
          }
        : clockface
    );
  }

  function paintPreview(canvas: HTMLCanvasElement | undefined, nextPreview: PreviewPayload) {
    if (!canvas) {
      return;
    }

    const size = nextPreview.size || PREVIEW_SIZE;
    const buffer = nextPreview.buffer;
    const context = canvas.getContext('2d');

    if (!context || buffer.length < size * size * 3) {
      return;
    }

    if (canvas.width !== size) {
      canvas.width = size;
    }

    if (canvas.height !== size) {
      canvas.height = size;
    }

    const imageData = context.createImageData(size, size);

    for (let index = 0, pixel = 0; index < buffer.length; index += 3, pixel += 4) {
      imageData.data[pixel] = buffer[index] ?? 0;
      imageData.data[pixel + 1] = buffer[index + 1] ?? 0;
      imageData.data[pixel + 2] = buffer[index + 2] ?? 0;
      imageData.data[pixel + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    glowColor = getGlowColor(buffer);
  }

  function getGlowColor(buffer: number[]) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;

    for (let index = 0; index < buffer.length; index += 3) {
      const pixelRed = buffer[index] ?? 0;
      const pixelGreen = buffer[index + 1] ?? 0;
      const pixelBlue = buffer[index + 2] ?? 0;
      const brightness = Math.max(pixelRed, pixelGreen, pixelBlue);

      if (brightness > 12) {
        red += pixelRed * brightness;
        green += pixelGreen * brightness;
        blue += pixelBlue * brightness;
        weight += brightness;
      }
    }

    if (weight === 0) {
      return 'rgba(47, 138, 122, 0.42)';
    }

    return `rgba(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(
      blue / weight
    )}, 0.54)`;
  }

  function setButtonState(key: string, state: ActionState) {
    clearTimeout(buttonTimers[key]);
    buttonState = { ...buttonState, [key]: state };

    if (state !== 'busy') {
      buttonTimers[key] = setTimeout(() => {
        const { [key]: _cleared, ...rest } = buttonState;
        buttonState = rest;
      }, 1400);
    }
  }

  function actionLabel(key: string, label: string) {
    if (buttonState[key] === 'busy') {
      return 'Отправка';
    }

    if (buttonState[key] === 'sent') {
      return 'Отправлено';
    }

    if (buttonState[key] === 'error') {
      return 'Ошибка';
    }

    return label;
  }

  async function refreshStatus(buttonKey = '') {
    if (buttonKey) {
      setButtonState(buttonKey, 'busy');
    }

    try {
      const response = await fetch('/api/v1/status');
      const body = (await response.json()) as StatusPayload;
      status = body;
      syncConfig(body.config);
      syncFromSettings(body.settings);

      if (buttonKey) {
        setButtonState(buttonKey, body.reachable ? 'sent' : 'error');
      }
    } catch (error) {
      if (buttonKey) {
        setButtonState(buttonKey, 'error');
      }
    }
  }

  async function refreshClockfaces() {
    const response = await fetch('/api/v1/clockfaces');
    const body = (await response.json()) as ClockfacesPayload;

    if (!response.ok || body.ok === false) {
      throw new Error(body.message || 'Не удалось загрузить clockfaces');
    }

    syncClockfaces(body);
  }

  async function refreshPreviewSnapshot() {
    const response = await fetch('/api/v1/preview.jpg', {
      cache: 'no-store'
    });

    if (!response.ok) {
      return;
    }

    const blob = await response.blob();

    if (typeof createImageBitmap !== 'function') {
      return;
    }

    const bitmap = await createImageBitmap(blob);
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = PREVIEW_SIZE;
    snapshotCanvas.height = PREVIEW_SIZE;
    const context = snapshotCanvas.getContext('2d');

    if (!context) {
      bitmap.close();
      return;
    }

    context.drawImage(bitmap, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    bitmap.close();

    const imageData = context.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const buffer: number[] = [];

    for (let index = 0; index < imageData.data.length; index += 4) {
      buffer.push(imageData.data[index] ?? 0, imageData.data[index + 1] ?? 0, imageData.data[index + 2] ?? 0);
    }

    syncPreview({
      size: PREVIEW_SIZE,
      buffer
    });
  }

  function connectPreviewStream() {
    if (typeof WebSocket === 'undefined') {
      return;
    }

    clearTimeout(previewReconnectTimer);
    previewSocket?.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/events`);
    previewSocket = socket;

    socket.onopen = () => {
      previewReconnectDelayMs = 500;
    };

    socket.onmessage = (event) => {
      const payload = parsePixooPalEvent(event.data);

      if (payload?.type === 'preview' && payload.activeId === activeClockfaceId) {
        syncPreview(payload.preview);
        return;
      }

      if (payload?.type === 'clockface_changed') {
        activeClockfaceId = payload.activeId;
        activeClockface = payload.clockface;
        refreshClockfaces().catch(() => undefined);
        return;
      }

      if (payload?.type === 'clockface_data_changed') {
        syncActiveClockfaceData(payload.activeId, payload.data);
        return;
      }

      if (payload?.type === 'device_status') {
        status = payload.status;
        syncConfig(payload.status.config);
        syncFromSettings(payload.status.settings);
      }
    };

    socket.onclose = () => {
      if (previewSocket === socket) {
        previewSocket = undefined;
        schedulePreviewReconnect();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  function schedulePreviewReconnect() {
    clearTimeout(previewReconnectTimer);
    previewReconnectTimer = setTimeout(connectPreviewStream, previewReconnectDelayMs);
    previewReconnectDelayMs = Math.min(previewReconnectDelayMs * 1.8, 5000);
  }

  function parsePixooPalEvent(value: unknown): PixooPalEvent | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    try {
      const payload = JSON.parse(value) as PixooPalEvent;
      return typeof payload?.type === 'string' ? payload : undefined;
    } catch {
      return undefined;
    }
  }

  async function refreshConfig() {
    const response = await fetch('/api/config');
    const body = (await response.json()) as { ok: boolean; config: StatusPayload['config'] };
    syncConfig(body.config);
  }

  async function savePixooAddress() {
    const value = pixooAddress.trim();

    if (!value) {
      return;
    }

    const key = 'pixooAddress';
    setButtonState(key, 'busy');

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ pixooAddress: value })
      });
      const body = (await response.json()) as { ok: boolean; config: StatusPayload['config'] };

      if (!response.ok || body.ok === false) {
        throw new Error('Pixoo address was not saved');
      }

      syncConfig(body.config);
      await refreshStatus();
      setButtonState(key, 'sent');
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  async function selectClockface(id: string) {
    activeClockfaceId = id;

    try {
      const response = await fetch('/api/v1/clockfaces/current', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id })
      });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface не выбран');
      }

      syncClockfaces(body);
    } catch (error) {
      activeClockfaceId = activeClockface?.id ?? '';
    }
  }

  async function submitClockfaceInput(id: string, value: string | File) {
    const key = `clockface:${id}`;
    setButtonState(key, 'busy');

    try {
      const response =
        value instanceof File
          ? await submitClockfaceFileInput(id, value)
          : await fetch('/api/v1/clockfaces/input', {
              method: 'POST',
              headers: {
                'content-type': 'application/json'
              },
              body: JSON.stringify({ inputId: id, value })
            });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Параметр clockface не применен');
      }

      syncClockfaces(body);
      setButtonState(key, 'sent');
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  function submitClockfaceFileInput(id: string, file: File) {
    const form = new FormData();
    form.set('inputId', id);
    form.set('value', file);

    return fetch('/api/v1/clockfaces/input', {
      method: 'POST',
      body: form
    });
  }

  async function submitNotification() {
    const key = 'notification';
    setButtonState(key, 'busy');

    try {
      const response = await fetch('/api/v1/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          message: notificationText,
          beep: notificationBeep
        })
      });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Уведомление не отправлено');
      }

      syncClockfaces(body);
      setButtonState(key, 'sent');
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  async function sendAction(key: string, action: string, payload: Record<string, unknown> = {}) {
    setButtonState(key, 'busy');

    try {
      const response = await fetch('/api/pixoo', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action, ...payload })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Команда Pixoo не выполнена');
      }

      setButtonState(key, 'sent');
      await refreshStatus();
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  function getPixooConnectionLabel(nextStatus: StatusPayload | null) {
    if (!nextStatus?.config?.pixooHost) {
      return 'IP не задан';
    }

    return nextStatus.reachable ? 'online' : 'offline';
  }

  onMount(() => {
    refreshConfig()
      .catch(() => undefined)
      .finally(() => {
        refreshStatus()
          .then(() => refreshClockfaces())
          .then(() => refreshPreviewSnapshot())
          .catch(() => undefined);
        connectPreviewStream();
      });
  });

  onDestroy(() => {
    clearTimeout(previewReconnectTimer);
    previewSocket?.close();
    Object.values(buttonTimers).forEach(clearTimeout);
  });
</script>

<svelte:head>
  <title>PixooPal</title>
  <meta name="description" content="SvelteKit WebUI for controlling a Divoom Pixoo display" />
</svelte:head>

<main class="shell">
  <section class="preview-stage" style={previewStyle}>
    <form class="address-bar" onsubmit={(event) => {
      event.preventDefault();
      savePixooAddress();
    }}>
      <label>
        <Wifi size={16} />
        <span>Pixoo IP</span>
        <input
          aria-label="Pixoo IP"
          bind:value={pixooAddress}
          placeholder="192.168.1.50"
          spellcheck="false"
        />
      </label>

      <span class:online={status?.reachable === true} class="address-status">
        {pixooConnectionLabel}
      </span>

      <button
        class:error={buttonState.pixooAddress === 'error'}
        class:sent={buttonState.pixooAddress === 'sent'}
        disabled={buttonState.pixooAddress === 'busy' || !pixooAddress.trim()}
        type="submit"
        title="Сохранить Pixoo IP"
      >
        <Save size={16} />
      </button>
    </form>

    <div class="preview-aura"></div>
    <div class="preview-shell">
      <div class="pixoo-frame">
        <div class="pixel-screen">
          <canvas
            aria-label="Буфер Pixoo 64 на 64 пикселя"
            bind:this={previewCanvas}
            height={PREVIEW_SIZE}
            width={PREVIEW_SIZE}
          ></canvas>
        </div>
      </div>
    </div>
  </section>

  <section class="device-controls" aria-label="Управление устройством">
    <div class="control-block brightness-block">
      <div class="control-heading">
        <Sun size={18} />
        <span>Яркость</span>
        <strong>{brightness}%</strong>
      </div>

      <input
        aria-label="Яркость"
        type="range"
        min="0"
        max="100"
        bind:value={brightness}
        onchange={() => sendAction('brightness', 'brightness', { value: brightness })}
      />
    </div>

    <div class="control-block power-block">
      <div class="control-heading">
        <Power size={18} />
        <span>Питание</span>
      </div>

      <div class="segmented" aria-label="Питание экрана">
        <button
          type="button"
          class:active={powered}
          class:error={buttonState.screenOn === 'error'}
          class:sent={buttonState.screenOn === 'sent'}
          disabled={buttonState.screenOn === 'busy'}
          onclick={() => {
            powered = true;
            sendAction('screenOn', 'screen', { on: true });
          }}
        >
          <Monitor size={17} />
          <span>{actionLabel('screenOn', 'Вкл')}</span>
        </button>
        <button
          type="button"
          class:active={!powered}
          class:error={buttonState.screenOff === 'error'}
          class:sent={buttonState.screenOff === 'sent'}
          disabled={buttonState.screenOff === 'busy'}
          onclick={() => {
            powered = false;
            sendAction('screenOff', 'screen', { on: false });
          }}
        >
          <Power size={17} />
          <span>{actionLabel('screenOff', 'Выкл')}</span>
        </button>
      </div>
    </div>
  </section>

  <section class="clockface-panel" aria-label="Выбор Clockface">
    <div class="panel-title">
      <Layers size={19} />
      <h2>Clockface</h2>
    </div>

    <div class="clockface-picker-row">
      <label class="select-label">
        <span>Активный</span>
        <select
          value={activeClockfaceId}
          onchange={(event) => selectClockface(event.currentTarget.value)}
        >
          {#each clockfaces as clockface}
            <option value={clockface.id}>{clockface.name}</option>
          {/each}
        </select>
      </label>

      {#if activeClockface && activeClockfaceHasSettings}
        <ClockfaceInputs
          mode="settings"
          inputs={activeClockface.inputs}
          data={activeClockface.data}
          {buttonState}
          onSubmitInput={submitClockfaceInput}
        />
      {/if}
    </div>

    {#if activeClockface}
      <ClockfaceInputs
        mode="visible"
        inputs={activeClockface.inputs}
        data={activeClockface.data}
        {buttonState}
        onSubmitInput={submitClockfaceInput}
      />
    {/if}
  </section>

  <section class="notification-panel" aria-label="Уведомление">
    <div class="panel-title">
      <Bell size={19} />
      <h2>Уведомление</h2>
    </div>

    <div class="notification-form">
      <label class="notification-text">
        <span>Текст</span>
        <input
          type="text"
          bind:value={notificationText}
          placeholder="Привет, Pixoo!"
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              submitNotification();
            }
          }}
        />
      </label>

      <label class="beep-toggle">
        <input type="checkbox" bind:checked={notificationBeep} />
        <Volume2 size={17} />
        <span>Beep</span>
      </label>

      <button
        class:error={buttonState.notification === 'error'}
        class:sent={buttonState.notification === 'sent'}
        disabled={buttonState.notification === 'busy'}
        type="button"
        onclick={submitNotification}
      >
        <Send size={17} />
        <span>{actionLabel('notification', 'Отправить')}</span>
      </button>
    </div>
  </section>
</main>

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

  button,
  input,
  select {
    font: inherit;
  }

  button {
    border: 0;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0;
  }

  .shell {
    display: grid;
    width: min(920px, calc(100% - 28px));
    min-height: 100vh;
    margin: 0 auto;
    padding: clamp(22px, 5vh, 54px) 0 42px;
    gap: 20px;
    align-content: center;
  }

  .preview-stage {
    position: relative;
    display: grid;
    min-height: min(58vh, 560px);
    gap: 14px;
    place-items: center;
    isolation: isolate;
  }

  .address-bar {
    display: grid;
    grid-template-columns: minmax(210px, 320px) auto auto;
    gap: 8px;
    align-items: center;
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    background: rgba(10, 14, 20, 0.72);
    box-shadow:
      0 14px 40px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(14px);
  }

  .address-bar label {
    display: grid;
    grid-template-columns: auto auto minmax(110px, 1fr);
    gap: 7px;
    align-items: center;
    color: #9fb0c3;
    font-size: 0.82rem;
    font-weight: 850;
  }

  .address-bar label :global(svg) {
    color: #87cfc0;
  }

  .address-bar input {
    min-height: 34px;
    padding: 0 10px;
  }

  .address-status {
    min-width: 74px;
    color: #aeb9c8;
    font-size: 0.78rem;
    font-weight: 850;
    text-align: center;
  }

  .address-status.online {
    color: #87e6c7;
  }

  .address-bar button {
    display: inline-grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 8px;
    color: #07110f;
    background: #76dcca;
    cursor: pointer;
  }

  .address-bar button.sent {
    background: #9af0d7;
  }

  .address-bar button.error {
    color: #ffffff;
    background: #b84b45;
  }

  .address-bar button:disabled {
    cursor: progress;
    opacity: 0.55;
  }

  .preview-aura {
    position: absolute;
    z-index: -1;
    width: min(78vw, 520px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--preview-glow);
    filter: blur(58px);
    opacity: 0.82;
    transform: scale(0.92);
  }

  .preview-shell {
    padding: clamp(14px, 3vw, 22px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.02)),
      rgba(10, 13, 18, 0.72);
    box-shadow:
      0 0 80px var(--preview-glow),
      0 26px 82px rgba(0, 0, 0, 0.58),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(18px);
  }

  .pixoo-frame {
    width: min(74vw, 430px);
    aspect-ratio: 1;
    padding: 18px;
    border: 10px solid #1b202b;
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

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .device-controls,
  .notification-panel,
  .clockface-panel {
    width: min(620px, 100%);
    margin: 0 auto;
  }

  .device-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: stretch;
  }

  .control-block,
  .notification-panel,
  .clockface-panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    background: rgba(12, 16, 23, 0.78);
    box-shadow:
      0 18px 48px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(16px);
  }

  .control-block {
    display: grid;
    gap: 12px;
    padding: 14px;
  }

  .control-heading,
  .panel-title {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #d9e2ec;
    font-size: 0.94rem;
    font-weight: 800;
  }

  .control-heading :global(svg),
  .panel-title :global(svg) {
    color: #87cfc0;
  }

  .control-heading strong {
    margin-left: auto;
    color: #ffffff;
    font-size: 0.9rem;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #63d1bb;
  }

  .power-block {
    min-width: 190px;
  }

  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 4px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
  }

  .segmented button {
    display: inline-flex;
    min-height: 38px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: 8px;
    color: #9aa8ba;
    background: transparent;
    cursor: pointer;
    transition:
      color 160ms ease,
      background 160ms ease,
      box-shadow 160ms ease;
  }

  .segmented button.active,
  .segmented button.sent {
    color: #07110f;
    background: #76dcca;
    box-shadow: 0 8px 24px rgba(118, 220, 202, 0.18);
  }

  .segmented button.error {
    color: #ffffff;
    background: #b84b45;
  }

  .segmented button:disabled {
    cursor: progress;
    opacity: 0.68;
  }

  .clockface-panel {
    display: grid;
    gap: 14px;
    padding: 16px;
  }

  .select-label {
    display: grid;
    gap: 7px;
    color: #94a3b8;
    font-size: 0.82rem;
    font-weight: 800;
  }

  .clockface-picker-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
  }

  .notification-panel {
    display: grid;
    gap: 14px;
    padding: 16px;
  }

  .notification-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 10px;
    align-items: end;
  }

  .notification-text {
    display: grid;
    gap: 7px;
    color: #94a3b8;
    font-size: 0.82rem;
    font-weight: 800;
  }

  .beep-toggle {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #d9e2ec;
    background: #151b25;
    font-size: 0.9rem;
    font-weight: 800;
  }

  .beep-toggle input {
    accent-color: #63d1bb;
  }

  .notification-form button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 14px;
    border-radius: 8px;
    color: #07110f;
    background: #76dcca;
    box-shadow: 0 12px 26px rgba(118, 220, 202, 0.16);
    cursor: pointer;
    font-weight: 850;
  }

  .notification-form button.error {
    color: #ffffff;
    background: #b84b45;
  }

  .notification-form button:disabled {
    cursor: progress;
    opacity: 0.68;
  }

  input[type='text'],
  select {
    width: 100%;
    min-height: 42px;
    padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #f8fbff;
    background: #151b25;
    outline: none;
  }

  input[type='text']:focus,
  select:focus {
    border-color: #63d1bb;
    box-shadow: 0 0 0 3px rgba(99, 209, 187, 0.16);
  }

  @media (max-width: 680px) {
    .shell {
      padding-top: 18px;
      align-content: start;
    }

    .preview-stage {
      min-height: 48vh;
    }

    .address-bar {
      grid-template-columns: 1fr auto;
      width: min(100%, 430px);
    }

    .address-bar label {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .address-bar label span {
      display: none;
    }

    .address-status {
      grid-column: 1 / -1;
      grid-row: 2;
      text-align: left;
    }

    .device-controls {
      grid-template-columns: 1fr;
    }

    .notification-form {
      grid-template-columns: 1fr;
    }

    .power-block {
      min-width: 0;
    }
  }
</style>
