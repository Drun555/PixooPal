<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Settings, Upload, X } from '@lucide/svelte';

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
  type ClockfaceInputListView = ClockfaceInputView[] | ClockfaceInputRowView[];

  type ActionState = 'busy' | 'sent' | 'error';

  export let inputs: ClockfaceInputListView = [];
  export let data: Record<string, string> = {};
  export let buttonState: Record<string, ActionState> = {};
  export let onSubmitInput: (id: string, value: string | File) => void | Promise<void> = async () => {};
  export let mode: 'all' | 'visible' | 'settings' = 'all';

  const keyPrefix = 'clockface:';
  let draftValues: Record<string, string> = {};
  let submitTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let settingsOpen = false;

  $: inputRows = normalizeRows(inputs);
  $: visibleRows =
    mode === 'settings' ? [] : filterRows(inputRows, (input) => input.isSetting !== true);
  $: settingRows =
    mode === 'visible' ? [] : filterRows(inputRows, (input) => input.isSetting === true);

  function keyFor(id: string) {
    return `${keyPrefix}${id}`;
  }

  function valueFor(id: string) {
    return draftValues[id] ?? data[id] ?? '';
  }

  function setDraft(id: string, value: string) {
    draftValues = {
      ...draftValues,
      [id]: value
    };
  }

  function buttonLabel(id: string, fallback: string) {
    const state = buttonState[keyFor(id)];

    if (state === 'error') {
      return 'Ошибка';
    }

    return fallback;
  }

  function isBusy(id: string) {
    return buttonState[keyFor(id)] === 'busy';
  }

  function disablesWhileBusy(input: ClockfaceInputView) {
    return input.type !== 'button';
  }

  function submit(id: string, value: string) {
    onSubmitInput(id, value);
  }

  function submitFile(id: string, file: File | undefined) {
    if (!file) {
      return;
    }

    onSubmitInput(id, file);
  }

  function submitChange(id: string, value: string) {
    setDraft(id, value);
    clearTimeout(submitTimers[id]);
    submitTimers[id] = setTimeout(() => submit(id, value), 250);
  }

  function normalizeRows(nextInputs: ClockfaceInputListView): ClockfaceInputRowView[] {
    return nextInputs.map((inputOrRow) =>
      Array.isArray(inputOrRow) ? inputOrRow : [inputOrRow]
    );
  }

  function filterRows(
    rows: ClockfaceInputRowView[],
    predicate: (input: ClockfaceInputView) => boolean
  ) {
    return rows.map((row) => row.filter(predicate)).filter((row) => row.length > 0);
  }

  function rowStyle(row: ClockfaceInputRowView) {
    return `grid-template-columns: repeat(${row.length}, minmax(0, 1fr));`;
  }

  onDestroy(() => {
    Object.values(submitTimers).forEach(clearTimeout);
  });
</script>

<div class="input-shell">
  {#if visibleRows.length > 0}
    <div class="input-list">
      {#each visibleRows as row}
        <div class="input-row" style={rowStyle(row)}>
          {#each row as input}
            {@render renderInput(input)}
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  {#if settingRows.length > 0}
    <div class="settings-area">
      <button
        class:active={settingsOpen}
        class="settings-button"
        type="button"
        aria-label="Настройки Clockface"
        aria-expanded={settingsOpen}
        onclick={() => {
          settingsOpen = !settingsOpen;
        }}
      >
        <Settings size={18} />
      </button>

      {#if settingsOpen}
        <div class="settings-popover">
          <div class="settings-head">
            <strong>Настройки</strong>
            <button
              type="button"
              aria-label="Закрыть настройки"
              onclick={() => {
                settingsOpen = false;
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div class="settings-list">
            {#each settingRows as row}
              <div class="input-row" style={rowStyle(row)}>
                {#each row as input}
                  {@render renderInput(input)}
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#snippet renderInput(input: ClockfaceInputView)}
  {#if input.type === 'button'}
    <button
      class:error={buttonState[keyFor(input.id)] === 'error'}
      class="submit"
      type="button"
      onclick={() => submit(input.id, valueFor(input.id))}
    >
      {buttonLabel(input.id, input.friendlyName)}
    </button>
  {:else if input.type === 'select'}
    <label>
      <span>{input.friendlyName}</span>
      <select
        value={valueFor(input.id)}
        disabled={isBusy(input.id)}
        onchange={(event) => submitChange(input.id, event.currentTarget.value)}
      >
        {#each input.options ?? [] as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
  {:else if input.type === 'input-file'}
    <label>
      <span>{input.friendlyName}</span>
      <div class="file-control">
        <Upload size={17} />
        <input
          type="file"
          accept={input.accept}
          disabled={isBusy(input.id)}
          onchange={(event) => submitFile(input.id, event.currentTarget.files?.[0])}
        />
      </div>
    </label>
  {:else}
    <label>
      <span>{input.friendlyName}</span>
      <input
        type={input.type === 'colorpicker' ? 'color' : input.type === 'input-num' ? 'number' : 'text'}
        min={input.min}
        max={input.max}
        step={input.step}
        value={valueFor(input.id)}
        disabled={isBusy(input.id)}
        oninput={(event) => submitChange(input.id, event.currentTarget.value)}
      />
    </label>
  {/if}
{/snippet}

<style>
  .input-shell {
    position: relative;
    display: grid;
    gap: 12px;
  }

  .input-list {
    display: grid;
    gap: 12px;
  }

  .input-row {
    display: grid;
    gap: 10px;
    align-items: end;
  }

  label {
    display: grid;
    gap: 6px;
    min-width: 0;
    color: #94a3b8;
    font-size: 0.84rem;
    font-weight: 800;
  }

  input,
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

  input[type='color'] {
    padding: 4px;
  }

  .file-control {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    min-height: 42px;
    align-items: center;
    gap: 9px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #d9e2ec;
    background: #151b25;
  }

  .file-control :global(svg) {
    color: #87cfc0;
    flex: 0 0 auto;
  }

  .file-control:focus-within {
    border-color: #63d1bb;
    box-shadow: 0 0 0 3px rgba(99, 209, 187, 0.16);
  }

  input[type='file'] {
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #9fb0c3;
    font-size: 0.84rem;
    font-weight: 800;
  }

  input[type='file']::file-selector-button {
    min-height: 30px;
    margin-right: 9px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    color: #07110f;
    background: #76dcca;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 850;
  }

  input:focus,
  select:focus {
    border-color: #63d1bb;
    box-shadow: 0 0 0 3px rgba(99, 209, 187, 0.16);
  }

  input:disabled,
  select:disabled {
    cursor: progress;
    opacity: 0.62;
  }

  .submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    border: 0;
    border-radius: 8px;
    color: #07110f;
    background: #76dcca;
    box-shadow: 0 12px 26px rgba(118, 220, 202, 0.16);
    cursor: pointer;
    font: inherit;
    font-weight: 850;
  }

  .submit:disabled {
    cursor: progress;
    opacity: 0.62;
  }

  .submit.error {
    color: #ffffff;
    background: #b13f39;
    box-shadow: 0 12px 26px rgba(177, 63, 57, 0.16);
  }

  .settings-area {
    position: relative;
    display: flex;
    justify-content: flex-end;
  }

  .settings-button {
    display: inline-grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #d9e2ec;
    background: #151b25;
    cursor: pointer;
  }

  .settings-button.active,
  .settings-button:hover {
    color: #07110f;
    background: #76dcca;
  }

  .settings-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    z-index: 5;
    display: grid;
    width: min(320px, calc(100vw - 36px));
    gap: 12px;
    padding: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(12, 16, 23, 0.98);
    box-shadow: 0 22px 58px rgba(0, 0, 0, 0.46);
  }

  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #f8fbff;
    font-size: 0.94rem;
  }

  .settings-head button {
    display: inline-grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 8px;
    color: #9aa8ba;
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
  }

  .settings-list {
    display: grid;
    gap: 12px;
  }
</style>
