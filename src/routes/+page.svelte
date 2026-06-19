<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    Bell,
    Monitor,
    Palette,
    Power,
    RotateCcw,
    Send,
    Star,
    Sun,
    Volume2
  } from '@lucide/svelte';
  import ClockfaceInputs from '$lib/components/ClockfaceInputs.svelte';
  import ClockfacePreview from '$lib/components/ClockfacePreview.svelte';
  import { apiUrl, apiWebSocketUrl } from '$lib/client/urls';

  type PixooSettings = {
    Brightness?: number;
    RValue?: number;
    GValue?: number;
    BValue?: number;
    WhiteBalanceR?: number;
    WhiteBalanceG?: number;
    WhiteBalanceB?: number;
    LightSwitch?: number;
    CurClockId?: number;
    Time24Flag?: number;
    TemperatureMode?: number;
    MirrorFlag?: number;
    [key: string]: unknown;
  };

  type StatusPayload = {
    ok: boolean;
    reachable: boolean;
    config: {
      configured: boolean;
      homeAssistantConfigured: boolean;
      homeAssistantTokenConfigured: boolean;
      homeAssistantUrl: string;
      pixooAddress: string;
      pixooHost: string;
      pixooPostUrl: string;
      resolution: number;
      webuiPort: string;
    };
    homeAssistant?: {
      checkedAt: string | null;
      configured: boolean;
      connected: boolean;
      message: string;
      supervisor: boolean;
      tokenConfigured: boolean;
      url: string;
    };
    settings: PixooSettings | null;
    control?: {
      pixooPalOff: boolean;
    };
    recovery?: {
      reachable: boolean;
      screenOn?: boolean;
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
    keyCodes?: string[];
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
    pictureUrl?: string;
    resolution: number;
    updateIntervalMs: number;
    data: Record<string, string>;
    inputs: ClockfaceInputRowView[];
  };

  type ClockfacesPayload = {
    ok: boolean;
    activeId: string;
    favoriteId?: string | null;
    clockfaces: ClockfaceView[];
    active: ClockfaceView | null;
    message?: string;
  };

  type ControlPayload = {
    ok: boolean;
    control: {
      pixooPalOff: boolean;
    };
  };

  type PixooPalEvent =
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
        type: 'pixoo_reachability';
        reachable: boolean;
        recovery: NonNullable<StatusPayload['recovery']>;
        message?: string;
      }
    | {
        type: 'recovery_status';
        recovery: NonNullable<StatusPayload['recovery']>;
      }
    | {
        type: 'notification';
        message: string;
        beep: boolean;
      };

  let status: StatusPayload | null = null;
  let clockfaces: ClockfaceView[] = [];
  let activeClockface: ClockfaceView | null = null;
  let activeClockfaceId = '';
  let favoriteClockfaceId: string | null = null;
  let buttonState: Record<string, ActionState> = {};
  let buttonTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let previewSocket: WebSocket | undefined;
  let previewReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let previewReconnectDelayMs = 500;
  let pixooAddress = '';
  let pixooPalOff = false;
  let brightness = 50;
  let whiteBalance = {
    red: 100,
    green: 100,
    blue: 100
  };
  let whiteBalanceOpen = false;
  let powered = true;
  let notificationText = '';
  let notificationBeep = true;
  let previewSrc = '';
  let previewFallbackSrc = '';
  let runtimeResolution = 64;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryNowMs = Date.now();
  let recoveryDeadlineMs = 0;
  let recoverySignature = '';

  $: activeClockfaceHasSettings =
    activeClockface?.inputs.some((row) => row.some((input) => input.isSetting === true)) === true;
  $: activeClockfaceShortcutInputs =
    activeClockface?.inputs.flat().filter((input) => (input.keyCodes?.length ?? 0) > 0) ?? [];

  $: pixooAddressConfigured = Boolean(status?.config?.pixooHost || pixooAddress);
  $: syncRecoveryDeadline(status?.recovery);
  $: isRecovering = Boolean(status?.reachable && recoveryDeadlineMs > recoveryNowMs);
  $: pixooConnectionLabel = getPixooConnectionLabel(status, isRecovering);
  $: pixooConnectionMessage = getPixooConnectionMessage(status);
  function syncFromSettings(settings: PixooSettings | null) {
    if (!settings) {
      return;
    }

    if (typeof settings.Brightness === 'number') {
      brightness = settings.Brightness;
    }

    whiteBalance = {
      red: getSettingsNumber(settings.RValue, settings.WhiteBalanceR, whiteBalance.red),
      green: getSettingsNumber(settings.GValue, settings.WhiteBalanceG, whiteBalance.green),
      blue: getSettingsNumber(settings.BValue, settings.WhiteBalanceB, whiteBalance.blue)
    };

    if (typeof settings.LightSwitch === 'number') {
      powered = settings.LightSwitch === 1;
    }
  }

  function getSettingsNumber(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return 100;
  }

  function syncControl(control: StatusPayload['control'] | ControlPayload['control'] | undefined) {
    if (!control) {
      return;
    }

    pixooPalOff = control.pixooPalOff;
  }

  function syncConfig(config: StatusPayload['config'] | undefined) {
    if (!config) {
      return;
    }

    pixooAddress = config.pixooAddress || config.pixooHost || pixooAddress;
    runtimeResolution = config.resolution || runtimeResolution;
  }

  function syncRecoveryDeadline(recovery: StatusPayload['recovery'] | undefined) {
    const nextSignature = `${recovery?.reachable ?? ''}:${recovery?.drawReadyAt ?? ''}:${
      recovery?.drawCooldownRemainingMs ?? 0
    }`;

    if (nextSignature === recoverySignature) {
      return;
    }

    recoverySignature = nextSignature;
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    recoveryNowMs = Date.now();

    if (!recovery || recovery.drawCooldownRemainingMs <= 0) {
      recoveryDeadlineMs = 0;
      return;
    }

    const parsedDeadlineMs = recovery.drawReadyAt ? Date.parse(recovery.drawReadyAt) : NaN;
    recoveryDeadlineMs = Number.isFinite(parsedDeadlineMs)
      ? parsedDeadlineMs
      : recoveryNowMs + recovery.drawCooldownRemainingMs;

    recoveryTimer = setTimeout(() => {
      recoveryNowMs = Date.now();
      recoveryTimer = undefined;
    }, Math.max(0, recoveryDeadlineMs - recoveryNowMs) + 25);
  }

  function syncClockfaces(body: ClockfacesPayload) {
    clockfaces = body.clockfaces ?? [];
    activeClockface = body.active ?? null;
    activeClockfaceId = body.activeId ?? body.active?.id ?? '';
    favoriteClockfaceId = body.favoriteId ?? null;
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

  function openBenchmark() {
    location.href = apiUrl('/benchmark');
  }

  async function refreshStatus(buttonKey = '') {
    if (buttonKey) {
      setButtonState(buttonKey, 'busy');
    }

    try {
      const response = await fetch(apiUrl('/api/v1/status'));
      const body = (await response.json()) as StatusPayload;
      status = body;
      syncConfig(body.config);
      syncControl(body.control);
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
    const response = await fetch(apiUrl('/api/v1/clockfaces'));
    const body = (await response.json()) as ClockfacesPayload;

    if (!response.ok || body.ok === false) {
      throw new Error(body.message || 'Не удалось загрузить clockfaces');
    }

    syncClockfaces(body);
  }

  function connectPreviewStream() {
    if (typeof WebSocket === 'undefined') {
      return;
    }

    clearTimeout(previewReconnectTimer);
    previewSocket?.close();

    const socket = new WebSocket(apiWebSocketUrl('/api/v1/events'));
    previewSocket = socket;

    socket.onopen = () => {
      previewReconnectDelayMs = 500;
    };

    socket.onmessage = (event) => {
      const payload = parsePixooPalEvent(event.data);

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
        syncControl(payload.status.control);
        syncFromSettings(payload.status.settings);
        return;
      }

      if (payload?.type === 'pixoo_reachability') {
        status = {
          ...(status ?? createEmptyStatus()),
          ok: payload.reachable,
          reachable: payload.reachable,
          settings: payload.reachable ? status?.settings ?? null : null,
          message: payload.reachable ? undefined : payload.message || 'Pixoo is offline.',
          recovery: payload.recovery
        };
        return;
      }

      if (payload?.type === 'recovery_status') {
        status = {
          ...(status ?? createEmptyStatus()),
          reachable: payload.recovery.reachable || status?.reachable === true,
          recovery: payload.recovery
        };
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
    const response = await fetch(apiUrl('/api/config'));
    const body = (await response.json()) as { ok: boolean; config: StatusPayload['config'] };
    syncConfig(body.config);
  }

  async function refreshControl() {
    const response = await fetch(apiUrl('/api/v1/control'));
    const body = (await response.json()) as ControlPayload;
    syncControl(body.control);
  }

  async function setPixooPalPower(off: boolean) {
    const key = 'pixooPalPower';
    setButtonState(key, 'busy');

    try {
      const response = await fetch(apiUrl('/api/v1/control'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ pixooPalOff: off })
      });
      const body = (await response.json()) as ControlPayload;

      if (!response.ok || body.ok === false) {
        throw new Error('PixooPal control was not saved');
      }

      syncControl(body.control);
      setButtonState(key, 'sent');
      await refreshStatus();
    } catch (error) {
      pixooPalOff = !off;
      setButtonState(key, 'error');
    }
  }

  async function selectClockface(id: string) {
    activeClockfaceId = id;

    try {
      const response = await fetch(apiUrl('/api/v1/clockfaces/current'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id })
      });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface is not set');
      }

      syncClockfaces(body);
    } catch (error) {
      activeClockfaceId = activeClockface?.id ?? '';
    }
  }

  async function setFavoriteClockface(id: string | null) {
    const previousFavoriteId = favoriteClockfaceId;
    const nextFavoriteId = favoriteClockfaceId === id ? null : id;
    favoriteClockfaceId = nextFavoriteId;

    try {
      const response = await fetch(apiUrl('/api/v1/clockfaces/favorite'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id: nextFavoriteId })
      });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Favorite clockface was not saved');
      }

      syncClockfaces(body);
    } catch (error) {
      favoriteClockfaceId = previousFavoriteId;
    }
  }

  async function submitClockfaceInput(id: string, value: string | File) {
    const key = `clockface:${id}`;
    setButtonState(key, 'busy');

    try {
      const response =
        value instanceof File
          ? await submitClockfaceFileInput(id, value)
          : await fetch(apiUrl('/api/v1/clockfaces/input'), {
              method: 'POST',
              headers: {
                'content-type': 'application/json'
              },
              body: JSON.stringify({ inputId: id, value })
            });
      const body = (await response.json()) as ClockfacesPayload;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface error');
      }

      syncClockfaces(body);
      setButtonState(key, 'sent');
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  async function submitClockfaceFileInput(id: string, file: File) {
    const params = new URLSearchParams({
      inputId: id,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: String(file.size)
    });

    return fetch(apiUrl(`/api/v1/clockfaces/input?${params.toString()}`), {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-pixoopal-input-id': encodeURIComponent(id),
        'x-pixoopal-file-name': encodeURIComponent(file.name),
        'x-pixoopal-file-type': encodeURIComponent(file.type || 'application/octet-stream'),
        'x-pixoopal-file-size': String(file.size)
      },
      body: file
    });
  }

  async function submitNotification() {
    const key = 'notification';
    setButtonState(key, 'busy');

    try {
      const response = await fetch(apiUrl('/api/v1/notify'), {
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
        throw new Error(body.message || 'Notification was not sent');
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
      const response = await fetch(apiUrl('/api/pixoo'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action, ...payload })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Error');
      }

      setButtonState(key, 'sent');
      await refreshStatus();
    } catch (error) {
      setButtonState(key, 'error');
    }
  }

  async function applyWhiteBalance() {
    await sendAction('whiteBalance', 'whiteBalance', whiteBalance);
  }

  function resetWhiteBalance() {
    whiteBalance = {
      red: 100,
      green: 100,
      blue: 100
    };

    applyWhiteBalance();
  }

  function getPixooConnectionLabel(nextStatus: StatusPayload | null, nextIsRecovering: boolean) {
    const homeAssistantLabel = getHomeAssistantConnectionLabel(nextStatus);

    if (!nextStatus) {
      return joinStatusLabels(pixooAddress ? 'checking' : 'Pixoo IP is not set', homeAssistantLabel);
    }

    if (!nextStatus.config.pixooHost) {
      return joinStatusLabels('Pixoo IP is not set', homeAssistantLabel);
    }

    return joinStatusLabels(nextIsRecovering ? 'recovering' : nextStatus.reachable ? 'online' : 'offline', homeAssistantLabel);
  }

  function getPixooConnectionMessage(nextStatus: StatusPayload | null) {
    if (!nextStatus) {
      return pixooAddress
        ? 'Checking Pixoo reachability.'
        : 'Provide IP address.';
    }

    if (!nextStatus.config.pixooHost) {
      return 'Provide IP address.';
    }

    if (!nextStatus.reachable) {
      return nextStatus.message || 'Pixoo is not reachable.';
    }

    return pixooPalOff
      ? 'PixooPal is paused.'
      : false;
  }

  function getHomeAssistantConnectionLabel(nextStatus: StatusPayload | null) {
    const homeAssistant = nextStatus?.homeAssistant;

    if (!homeAssistant?.configured || homeAssistant.connected) {
      return '';
    }

    return 'HA offline';
  }

  function joinStatusLabels(...labels: string[]) {
    return labels.filter(Boolean).join(' / ');
  }

  function clockfaceInitial(clockface: ClockfaceView) {
    return clockface.name.trim().slice(0, 1).toUpperCase() || '?';
  }

  function createEmptyStatus(): StatusPayload {
    return {
      ok: true,
      reachable: false,
      config: {
        configured: false,
        homeAssistantConfigured: false,
        homeAssistantTokenConfigured: false,
        homeAssistantUrl: '',
        pixooAddress: '',
        pixooHost: '',
        pixooPostUrl: '',
        resolution: runtimeResolution,
        webuiPort: ''
      },
      settings: null,
      activeClockface: activeClockface
    };
  }

  function handleClockfaceKeydown(event: KeyboardEvent) {
    if (
      !activeClockface ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const input = activeClockfaceShortcutInputs.find((item) => matchesInputKeyCode(item, event));

    if (!input) {
      return;
    }

    event.preventDefault();
    submitClockfaceInput(input.id, activeClockface.data[input.id] ?? '');
  }

  function matchesInputKeyCode(input: ClockfaceInputView, event: KeyboardEvent) {
    return input.keyCodes?.some((keyCode) => keyCode === event.code || keyCode === event.key) === true;
  }

  function isEditableKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return (
      target.isContentEditable ||
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea'
    );
  }

  onMount(() => {
    window.addEventListener('keydown', handleClockfaceKeydown);

    previewSrc = apiWebSocketUrl('/api/v1/preview.ws');
    previewFallbackSrc = apiUrl('/api/v1/preview.mjpeg');

    refreshConfig()
      .catch(() => undefined)
      .finally(() => {
        refreshControl()
          .catch(() => undefined)
          .then(() => refreshStatus())
          .then(() => refreshClockfaces())
          .catch(() => undefined);
        connectPreviewStream();
      });
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleClockfaceKeydown);
    clearTimeout(previewReconnectTimer);
    clearTimeout(recoveryTimer);
    previewSocket?.close();
    Object.values(buttonTimers).forEach(clearTimeout);
  });
</script>

<svelte:head>
  <title>PixooPal</title>
  <meta name="description" content="SvelteKit WebUI for controlling a Divoom Pixoo display" />
</svelte:head>

<main class="shell">
  <section class="pixoo-status-card" aria-label="Pixoo status">
    <div class="status-connection">
      <button
        aria-label="Open benchmark"
        class:missing={!pixooAddressConfigured}
        class:offline={pixooAddressConfigured && status?.reachable === false}
        class:online={status?.reachable === true && !isRecovering}
        class:recovering={isRecovering}
        class="address-status"
        ondblclick={openBenchmark}
        type="button"
      >
        {pixooConnectionLabel}
      </button>

      <div class="status-address">{pixooAddress || 'Not configured'}</div>
      <input aria-label="Pixoo IP" bind:value={pixooAddress} disabled readonly type="hidden" />
      {#if pixooConnectionMessage}
        <p class="connection-note">{pixooConnectionMessage}</p>
      {/if}
    </div>

    <div class="status-actions" aria-label="Clockface actions">
      <button
        aria-label="Toggle favorite clockface"
        aria-pressed={favoriteClockfaceId === activeClockfaceId}
        class:favorite={favoriteClockfaceId === activeClockfaceId}
        class="status-action-button"
        disabled={!activeClockfaceId}
        type="button"
        onclick={() => setFavoriteClockface(activeClockfaceId || null)}
      >
        <Star
          size={18}
          fill={favoriteClockfaceId === activeClockfaceId ? '#76dcca' : 'none'}
        />
      </button>

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
  </section>

  <div class="desktop-surface">
    <section class="desktop-column clockface-column" aria-label="Installed Clockfaces">
      <div
        class="clockface-carousel"
        aria-label="Installed clockface carousel"
      >
        {#each clockfaces as clockface}
          <article
            class:active={clockface.id === activeClockfaceId}
            class="clockface-card"
          >
            <button
              aria-pressed={clockface.id === activeClockfaceId}
              class="clockface-select"
              type="button"
              onclick={() => selectClockface(clockface.id)}
            >
              <span class="clockface-image">
                {#if clockface.pictureUrl}
                  <img src={clockface.pictureUrl} alt="" loading="lazy" />
                {:else}
                  <span>{clockfaceInitial(clockface)}</span>
                {/if}
              </span>
              <span class="clockface-card-copy">
                <strong>{clockface.name}</strong>
              </span>
            </button>
          </article>
        {/each}
      </div>

      {#if activeClockface && activeClockface.inputs.flat().filter(x => !x.isSetting).length > 0}
        <section class="clockface-panel" aria-label="Active Clockface controls">
          <ClockfaceInputs
            mode="visible"
            inputs={activeClockface.inputs}
            data={activeClockface.data}
            {buttonState}
            onSubmitInput={submitClockfaceInput}
          />
        </section>
      {/if}
    </section>

    <section class="desktop-column preview-column" aria-label="Pixoo preview">
      <ClockfacePreview
        fallbackSrc={previewFallbackSrc}
        {previewSrc}
        resolution={runtimeResolution}
      />
    </section>

    <section class="desktop-column controls-column" aria-label="PixooPal controls">
      <section class="control-block pixoopal-power compact" aria-label="PixooPal control">
        <label class="switch-row">
          <input
            type="checkbox"
            bind:checked={pixooPalOff}
            disabled={buttonState.pixooPalPower === 'busy'}
            onchange={(event) => setPixooPalPower(event.currentTarget.checked)}
          />
          <span class="switch-track" aria-hidden="true"></span>
          <span>
            <strong>Pause PixooPal</strong>
            <small>{pixooPalOff ? 'Clockface is paused' : 'Clockface is active'}</small>
          </span>
        </label>
      </section>

      <section class="device-controls" aria-label="Device settings">
        <div class="control-block brightness-block">
          <div class="control-heading">
            <Sun size={18} />
            <span>Brightness</span>
            <strong>{brightness}%</strong>
            <div class="white-balance-menu">
              <button
                aria-expanded={whiteBalanceOpen}
                aria-label="White balance"
                class:error={buttonState.whiteBalance === 'error'}
                class:sent={buttonState.whiteBalance === 'sent'}
                class="icon-button white-balance-button"
                disabled={buttonState.whiteBalance === 'busy'}
                type="button"
                onclick={() => {
                  whiteBalanceOpen = !whiteBalanceOpen;
                }}
              >
                <Palette size={16} />
              </button>

              {#if whiteBalanceOpen}
                <div class="white-balance-popover" role="dialog" aria-label="White balance settings">
                  <div class="popover-title">
                    <span>White balance</span>
                    <button
                      aria-label="Reset white balance"
                      class="icon-button"
                      disabled={buttonState.whiteBalance === 'busy'}
                      type="button"
                      onclick={resetWhiteBalance}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>

                  <label class="balance-slider red">
                    <span>Red</span>
                    <strong>{whiteBalance.red}%</strong>
                    <input
                      aria-label="White balance red"
                      type="range"
                      min="0"
                      max="100"
                      bind:value={whiteBalance.red}
                    />
                  </label>

                  <label class="balance-slider green">
                    <span>Green</span>
                    <strong>{whiteBalance.green}%</strong>
                    <input
                      aria-label="White balance green"
                      type="range"
                      min="0"
                      max="100"
                      bind:value={whiteBalance.green}
                    />
                  </label>

                  <label class="balance-slider blue">
                    <span>Blue</span>
                    <strong>{whiteBalance.blue}%</strong>
                    <input
                      aria-label="White balance blue"
                      type="range"
                      min="0"
                      max="100"
                      bind:value={whiteBalance.blue}
                    />
                  </label>

                  <button
                    class:error={buttonState.whiteBalance === 'error'}
                    class:sent={buttonState.whiteBalance === 'sent'}
                    class="apply-balance"
                    disabled={buttonState.whiteBalance === 'busy'}
                    type="button"
                    onclick={applyWhiteBalance}
                  >
                    {actionLabel('whiteBalance', 'Apply')}
                  </button>
                </div>
              {/if}
            </div>
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
            <span>Screen</span>
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
              <span>{actionLabel('screenOn', 'On')}</span>
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
              <span>{actionLabel('screenOff', 'Off')}</span>
            </button>
          </div>
        </div>
      </section>

      <section class="notification-panel" aria-label="Notification">
        <div class="panel-title">
          <Bell size={19} />
          <h2>Notification</h2>
        </div>

        <div class="notification-form">
          <label class="notification-text">
            <span>Text</span>
            <input
              type="text"
              bind:value={notificationText}
              placeholder="Hi, Pixoo!"
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
            <span>{actionLabel('notification', 'Send')}</span>
          </button>
        </div>
      </section>
    </section>
  </div>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: calc(100vh - 50px);
    background:
      radial-gradient(circle at 50% 17%, rgba(56, 72, 96, 0.34), transparent 24rem),
      linear-gradient(180deg, #10141d 0%, #07090d 100%);
    color: #edf2f7;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button,
  input {
    min-width: 0;
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
    width: min(1180px, calc(100% - 32px));
    min-height: calc(100vh - 50px);
    margin: 0 auto;
    padding: 22px 0 34px;
    gap: 14px;
    align-content: center;
  }

  .pixoo-status-card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    align-items: center;
    justify-content: stretch;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(12, 16, 23, 0.46);
    overflow: visible;
  }

  .status-connection {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .status-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .status-action-button {
    display: inline-grid;
    width: 42px;
    height: 42px;
    flex: 0 0 42px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #d9e2ec;
    background: #151b25;
    cursor: pointer;
  }

  .status-action-button.favorite,
  .status-action-button:hover {
    color: #76dcca;
    border-color: rgba(118, 220, 202, 0.42);
  }

  .status-action-button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .status-actions :global(.input-shell) {
    width: auto;
  }

  .status-actions :global(.settings-area) {
    position: relative;
  }

  .status-address {
    min-width: 0;
    max-width: 280px;
    overflow: hidden;
    color: #f8fbff;
    font-size: 0.88rem;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .address-status {
    border: 0;
    background: transparent;
    cursor: default;
    flex: 0 0 auto;
    padding: 0;
    color: #aeb9c8;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 850;
    text-align: center;
  }

  .address-status.online {
    color: #87e6c7;
  }

  .address-status.recovering {
    color: #f8dd7c;
  }

  .address-status.offline,
  .address-status.missing {
    color: #ffb8a8;
  }

  .connection-note {
    margin: 0;
    color: #91a1b5;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .desktop-surface {
    display: grid;
    grid-template-columns: minmax(290px, 0.85fr) minmax(0, 1.55fr) minmax(290px, 0.85fr);
    align-items: stretch;
    height: 550px;
    gap: 18px;
    padding: 18px;
    border-radius: 18px;
  }

  .desktop-column {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 14px;
    overflow: visible;
  }

  .clockface-column,
  .controls-column {
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    background: rgba(12, 16, 23, 0.54);
  }

  .clockface-column {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
  }

  .preview-column {
    display: grid;
    grid-template-rows: 1fr;
    justify-content: stretch;
    align-items: center;
    padding: 0;
    overflow: visible;
  }

  .controls-column {
    display: grid;
    /* grid-template-rows: minmax(86px, 0.8fr) minmax(210px, 1.7fr) minmax(150px, 1.2fr); */
    align-content: stretch;
  }

  .controls-column > section {
    min-height: 0;
    height: 100%;
  }

  .clockface-carousel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: max-content;
    flex: 1 1 auto;
    min-height: 0;
    gap: 8px;
    align-content: start;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 0;
    scrollbar-width: none;
  }

  .clockface-carousel::-webkit-scrollbar {
    display: none;
  }

  .clockface-card {
    position: relative;
    display: grid;
    gap: 6px;
    align-items: stretch;
    align-content: start;
    min-height: 105px;
    padding: 5px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 9px;
    color: #d9e2ec;
    background: rgba(255, 255, 255, 0.04);
    transition:
      border-color 160ms ease,
      background 160ms ease;
  }

  .clockface-select {
    display: grid;
    grid-template-rows: auto auto;
    gap: 6px;
    align-content: start;
    justify-items: stretch;
    width: 100%;
    min-width: 0;
    padding: 0;
    color: inherit;
    background: transparent;
    cursor: pointer;
    text-align: center;
  }

  .clockface-card:hover,
  .clockface-card.active {
    border-color: rgba(118, 220, 202, 0.48);
    background: rgba(118, 220, 202, 0.11);
  }

  .clockface-image {
    display: grid;
    width: 100%;
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border-radius: 9px;
    color: #07110f;
    background:
      radial-gradient(circle at 36% 26%, rgba(255, 255, 255, 0.42), transparent 28px),
      #76dcca;
    font-size: 1.5rem;
    font-weight: 950;
  }

  .clockface-image img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .clockface-card-copy {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 0;
  }

  .clockface-card-copy strong {
    display: block;
    width: 100%;
    overflow: hidden;
    color: #f8fbff;
    font-size: 0.66rem;
    font-weight: 800;
    line-height: 1.18;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-controls,
  .notification-panel,
  .clockface-panel {
    width: 100%;
    margin: 0;
  }

  .device-controls {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
    align-content: stretch;
  }

  .control-block,
  .notification-panel,
  .clockface-panel {
    position: relative;
    /* border: 1px solid rgba(255, 255, 255, 0.08); */
    border-radius: 14px;
    /* background: rgba(12, 16, 23, 0.78); */
    /* box-shadow: */
      /* 0 18px 48px rgba(0, 0, 0, 0.28), */
      /* inset 0 1px 0 rgba(255, 255, 255, 0.05); */
    overflow: visible;
  }

  .pixoopal-power {
    width: 100%;
  }

  .pixoopal-power.compact {
    padding: 10px 12px;
  }

  .pixoopal-power.compact .switch-row {
    font-size: 0.86rem;
  }

  .pixoopal-power strong,
  .pixoopal-power small {
    display: block;
  }

  .pixoopal-power small {
    margin-top: 2px;
    color: #91a1b5;
    font-size: 0.75rem;
    font-weight: 800;
  }

  .switch-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    color: #d9e2ec;
    font-size: 0.88rem;
    font-weight: 800;
  }

  .switch-row input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .switch-track {
    position: relative;
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    transition: background 160ms ease;
  }

  .switch-track::after {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #d6e4ef;
    content: '';
    transition: transform 160ms ease;
  }

  .switch-row input:checked + .switch-track {
    background: #b84b45;
  }

  .switch-row input:checked + .switch-track::after {
    transform: translateX(20px);
  }

  .switch-row input:disabled + .switch-track {
    opacity: 0.62;
  }

  .control-block {
    display: grid;
    gap: 10px;
    padding: 12px;
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

  .white-balance-menu {
    position: relative;
    display: inline-grid;
    place-items: center;
  }

  .icon-button {
    display: inline-grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #d9e2ec;
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
    transition:
      color 160ms ease,
      background 160ms ease,
      border-color 160ms ease;
  }

  .icon-button:hover,
  .white-balance-button.sent {
    color: #07110f;
    border-color: transparent;
    background: #76dcca;
  }

  .white-balance-button.error {
    color: #ffffff;
    border-color: transparent;
    background: #b84b45;
  }

  .icon-button:disabled {
    cursor: progress;
    opacity: 0.68;
  }

  .white-balance-popover {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 80;
    display: grid;
    width: min(320px, calc(100vw - 56px));
    gap: 12px;
    padding: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(12, 16, 23, 0.98);
    box-shadow:
      0 22px 62px rgba(0, 0, 0, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .popover-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #edf2f7;
    font-size: 0.9rem;
    font-weight: 900;
  }

  .popover-title .icon-button {
    width: 30px;
    height: 30px;
  }

  .balance-slider {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px 10px;
    align-items: center;
    color: #aeb9c8;
    font-size: 0.78rem;
    font-weight: 850;
  }

  .balance-slider strong {
    color: #edf2f7;
    font-size: 0.78rem;
  }

  .balance-slider input {
    grid-column: 1 / -1;
  }

  .balance-slider.red input {
    accent-color: #ff6f78;
  }

  .balance-slider.green input {
    accent-color: #76dcca;
  }

  .balance-slider.blue input {
    accent-color: #75a7ff;
  }

  .apply-balance {
    display: inline-flex;
    min-height: 38px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #07110f;
    background: #76dcca;
    cursor: pointer;
    font-weight: 900;
  }

  .apply-balance.error {
    color: #ffffff;
    background: #b84b45;
  }

  .apply-balance:disabled {
    cursor: progress;
    opacity: 0.68;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #63d1bb;
  }

  .brightness-block {
    min-width: 0;
  }

  .power-block {
    min-width: 0;
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
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
  }

  .clockface-column .clockface-panel {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0;
    padding: 10px 0 0;
    background: transparent;
    box-shadow: none;
  }

  .notification-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
  }

  .notification-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    align-items: end;
  }

  .notification-text {
    display: grid;
    grid-column: 1 / -1;
    min-width: 0;
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
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    accent-color: #63d1bb;
  }

  .notification-form button {
    display: inline-flex;
    width: 100%;
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

  input[type='text'] {
    width: 100%;
    min-height: 42px;
    padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #f8fbff;
    background: #151b25;
    outline: none;
  }

  input[type='text']:focus {
    border-color: #63d1bb;
    box-shadow: 0 0 0 3px rgba(99, 209, 187, 0.16);
  }

  @media (max-width: 860px) {
    .shell {
      width: min(100% - 24px, 560px);
      min-height: auto;
      padding: 16px 0 28px;
      align-content: start;
      gap: 12px;
    }

    .pixoo-status-card {
      grid-template-columns: 1fr;
      gap: 10px;
      padding: 12px;
    }

    .status-connection {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      justify-content: stretch;
      gap: 4px 10px;
    }

    .address-status {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
      max-width: 44vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-address {
      grid-column: 1;
      grid-row: 1;
      max-width: none;
    }

    .connection-note {
      grid-column: 1 / -1;
    }

    .status-actions {
      justify-content: space-between;
    }

    .desktop-surface {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 0;
      gap: 12px;
      padding: 0;
      border-radius: 0;
    }

    .desktop-column {
      min-height: 0;
    }

    .clockface-column,
    .controls-column {
      padding: 10px;
      border-radius: 12px;
    }

    .clockface-column {
      overflow: visible;
    }

    .clockface-carousel {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(86px, 29%);
      grid-template-columns: none;
      flex: 0 0 auto;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 2px;
      scroll-snap-type: x proximity;
      scrollbar-width: none;
    }

    .clockface-carousel::-webkit-scrollbar {
      display: none;
    }

    .clockface-card {
      min-height: 0;
      scroll-snap-align: start;
    }

    .clockface-card-copy strong {
      font-size: 0.68rem;
    }

    .clockface-column .clockface-panel {
      padding-top: 8px;
    }

    .preview-column {
      min-height: min(76vw, 440px);
      order: -1;
    }

    .controls-column {
      display: grid;
      gap: 10px;
    }

    .controls-column > section {
      height: auto;
    }

    .device-controls {
      gap: 10px;
    }

    .control-block,
    .notification-panel,
    .clockface-panel {
      padding: 12px;
    }

    .notification-form {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 420px) {
    .shell {
      width: calc(100% - 18px);
      padding-top: 12px;
    }

    .pixoo-status-card,
    .clockface-column,
    .controls-column {
      padding: 9px;
    }

    .clockface-carousel {
      grid-auto-columns: minmax(78px, 32%);
      gap: 7px;
    }

    .clockface-card {
      padding: 4px;
    }

    .preview-column {
      min-height: calc(100vw - 18px);
    }
  }
</style>
