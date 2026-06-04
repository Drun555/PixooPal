<script lang="ts">
  import { Activity, Play, RotateCcw } from '@lucide/svelte';
  import { apiUrl } from '$lib/client/urls';

  type MetricSummary = {
    count: number;
    min: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    max: number;
  } | null;

  type BenchmarkRun = {
    size: 32 | 64;
    summary: {
      generateMs: MetricSummary;
      encodeMs: MetricSummary;
      pushMs: MetricSummary;
      pushStartGapMs: MetricSummary;
    };
  };

  type BenchmarkResult = {
    ok: boolean;
    message?: string;
    options: {
      frames: number;
      warmupFrames: number;
      intervalMs: number;
    };
    durationMs: number;
    server: {
      nodeVersion: string;
      platform: string;
      cpuCount: number;
      loadavg: number[];
    };
    pixoo: {
      host: string | null;
      recoveryBefore: {
        reachable: boolean;
        drawCooldownRemainingMs: number;
      };
      recoveryAfter: {
        reachable: boolean;
        drawCooldownRemainingMs: number;
      };
    };
    runs: BenchmarkRun[];
  };

  type ClockfaceBenchmarkResult = {
    ok: boolean;
    message?: string;
    options: {
      durationMs: number;
    };
    activeClockface: {
      id: string;
      name: string;
      resolution: number;
      updateIntervalMs: number;
      frameQueueSize: number;
    };
    durationMs: number;
    pixoo: {
      host: string | null;
      recoveryBefore: {
        reachable: boolean;
        drawCooldownRemainingMs: number;
      };
      recoveryAfter: {
        reachable: boolean;
        drawCooldownRemainingMs: number;
      };
    };
    summary: {
      renderMs: MetricSummary;
      displayBufferMs: MetricSummary;
      renderStartGapMs: MetricSummary;
      queueWaitMs: MetricSummary;
      pushDurationMs: MetricSummary;
      encodeMs: MetricSummary;
      sendMs: MetricSummary;
      previewPublishMs: MetricSummary;
      waitReadyMs: MetricSummary;
      resetMs: MetricSummary;
      postSendDelayMs: MetricSummary;
      frameBytes: MetricSummary;
      base64Bytes: MetricSummary;
      pushStartGapMs: MetricSummary;
      counts: {
        renderedFrames: number;
        pushedFrames: number;
        scheduledFrames: number;
        schedulerBlocks: Record<string, number>;
        pixooCommands: number;
        pixooCommandCounts: Record<
          string,
          { count: number; ok: number; error: number; durationMs: MetricSummary }
        >;
      };
    };
  };

  let frames = 30;
  let warmupFrames = 2;
  let intervalMs = 120;
  let busy = false;
  let errorMessage = '';
  let result: BenchmarkResult | null = null;
  let clockfaceDurationMs = 20000;
  let clockfaceBusy = false;
  let clockfaceErrorMessage = '';
  let clockfaceResult: ClockfaceBenchmarkResult | null = null;

  async function run() {
    busy = true;
    errorMessage = '';

    try {
      const response = await fetch(apiUrl('/api/v1/benchmark'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          frames,
          warmupFrames,
          intervalMs
        })
      });
      const body = (await response.json()) as BenchmarkResult;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Benchmark failed');
      }

      result = body;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Benchmark failed';
    } finally {
      busy = false;
    }
  }

  function formatMetric(summary: MetricSummary, key: keyof NonNullable<MetricSummary>) {
    if (!summary) {
      return '-';
    }

    return `${summary[key]} ms`;
  }

  function reset() {
    result = null;
    clockfaceResult = null;
    errorMessage = '';
    clockfaceErrorMessage = '';
  }

  async function runClockfaceBenchmark() {
    clockfaceBusy = true;
    clockfaceErrorMessage = '';

    try {
      const response = await fetch(apiUrl('/api/v1/benchmark/clockface'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          durationMs: clockfaceDurationMs
        })
      });
      const body = (await response.json()) as ClockfaceBenchmarkResult;

      if (!response.ok || body.ok === false) {
        throw new Error(body.message || 'Clockface benchmark failed');
      }

      clockfaceResult = body;
    } catch (error) {
      clockfaceErrorMessage =
        error instanceof Error ? error.message : 'Clockface benchmark failed';
    } finally {
      clockfaceBusy = false;
    }
  }

  function schedulerBlockEntries(result: ClockfaceBenchmarkResult) {
    return Object.entries(result.summary.counts.schedulerBlocks);
  }

  function commandEntries(result: ClockfaceBenchmarkResult) {
    return Object.entries(result.summary.counts.pixooCommandCounts);
  }
</script>

<svelte:head>
  <title>PixooPal Benchmark</title>
</svelte:head>

<main class="benchmark-shell">
  <header>
    <div>
      <span class="mark"><Activity size={16} /></span>
      <h1>Benchmark</h1>
    </div>
    <button class="icon-button" type="button" aria-label="Clear results" onclick={reset}>
      <RotateCcw size={16} />
    </button>
  </header>

  <section class="benchmark-group" aria-label="Pixoo transport benchmark">
    <div class="section-heading">
      <h2>Default benchmark</h2>
    </div>

  <section class="controls" aria-label="Pixoo transport controls">
    <label>
      <span>Frames</span>
      <input type="number" min="1" max="120" bind:value={frames} disabled={busy} />
    </label>
    <label>
      <span>Warmup</span>
      <input type="number" min="0" max="10" bind:value={warmupFrames} disabled={busy} />
    </label>
    <label>
      <span>Interval</span>
      <input type="number" min="0" max="2000" bind:value={intervalMs} disabled={busy} />
    </label>
    <button class="run-button" type="button" disabled={busy} onclick={run}>
      <Play size={16} />
      <span>{busy ? 'Running' : 'Run'}</span>
    </button>
  </section>

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  {#if result}
    <section class="summary" aria-label="Benchmark summary">
      <div>
        <span>Pixoo</span>
        <strong>{result.pixoo.host ?? 'not configured'}</strong>
      </div>
      <div>
        <span>Duration</span>
        <strong>{result.durationMs} ms</strong>
      </div>
      <div>
        <span>Node</span>
        <strong>{result.server.nodeVersion}</strong>
      </div>
      <div>
        <span>CPU</span>
        <strong>{result.server.cpuCount}</strong>
      </div>
    </section>

    <section class="runs" aria-label="Benchmark runs">
      {#each result.runs as run}
        <article>
          <h2>{run.size}x{run.size}</h2>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Avg</th>
                <th>P95</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Generate</td>
                <td>{formatMetric(run.summary.generateMs, 'avg')}</td>
                <td>{formatMetric(run.summary.generateMs, 'p95')}</td>
                <td>{formatMetric(run.summary.generateMs, 'max')}</td>
              </tr>
              <tr>
                <td>Encode</td>
                <td>{formatMetric(run.summary.encodeMs, 'avg')}</td>
                <td>{formatMetric(run.summary.encodeMs, 'p95')}</td>
                <td>{formatMetric(run.summary.encodeMs, 'max')}</td>
              </tr>
              <tr>
                <td>Push</td>
                <td>{formatMetric(run.summary.pushMs, 'avg')}</td>
                <td>{formatMetric(run.summary.pushMs, 'p95')}</td>
                <td>{formatMetric(run.summary.pushMs, 'max')}</td>
              </tr>
              <tr>
                <td>Start gap</td>
                <td>{formatMetric(run.summary.pushStartGapMs, 'avg')}</td>
                <td>{formatMetric(run.summary.pushStartGapMs, 'p95')}</td>
                <td>{formatMetric(run.summary.pushStartGapMs, 'max')}</td>
              </tr>
            </tbody>
          </table>
        </article>
      {/each}
    </section>
  {/if}
  </section>

  <section class="benchmark-group" aria-label="Active clockface benchmark">
    <div class="section-heading">
      <h2>Active clockface benchmark</h2>
    </div>

    <section class="controls clockface-controls" aria-label="Active clockface controls">
      <label>
        <span>Duration</span>
        <input
          type="number"
          min="1000"
          max="120000"
          step="1000"
          bind:value={clockfaceDurationMs}
          disabled={clockfaceBusy}
        />
      </label>
      <button
        class="run-button"
        type="button"
        disabled={clockfaceBusy}
        onclick={runClockfaceBenchmark}
      >
        <Play size={16} />
        <span>{clockfaceBusy ? 'Running' : 'Run'}</span>
      </button>
    </section>

    {#if clockfaceErrorMessage}
      <p class="error">{clockfaceErrorMessage}</p>
    {/if}

    {#if clockfaceResult}
      <section class="summary" aria-label="Active clockface summary">
        <div>
          <span>Clockface</span>
          <strong>{clockfaceResult.activeClockface.name}</strong>
        </div>
        <div>
          <span>Interval</span>
          <strong>{clockfaceResult.activeClockface.updateIntervalMs} ms</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>{clockfaceResult.activeClockface.frameQueueSize}</strong>
        </div>
        <div>
          <span>Frames</span>
          <strong
            >{clockfaceResult.summary.counts.renderedFrames}/{clockfaceResult.summary.counts
              .pushedFrames}</strong
          >
        </div>
      </section>

      <section class="runs" aria-label="Active clockface runs">
        <article>
          <h2>Render / queue / push</h2>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Avg</th>
                <th>P95</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Render</td>
                <td>{formatMetric(clockfaceResult.summary.renderMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.renderMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.renderMs, 'max')}</td>
              </tr>
              <tr>
                <td>Display buffer</td>
                <td>{formatMetric(clockfaceResult.summary.displayBufferMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.displayBufferMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.displayBufferMs, 'max')}</td>
              </tr>
              <tr>
                <td>Render gap</td>
                <td>{formatMetric(clockfaceResult.summary.renderStartGapMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.renderStartGapMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.renderStartGapMs, 'max')}</td>
              </tr>
              <tr>
                <td>Queue wait</td>
                <td>{formatMetric(clockfaceResult.summary.queueWaitMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.queueWaitMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.queueWaitMs, 'max')}</td>
              </tr>
              <tr>
                <td>Push</td>
                <td>{formatMetric(clockfaceResult.summary.pushDurationMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.pushDurationMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.pushDurationMs, 'max')}</td>
              </tr>
              <tr>
                <td>Encode</td>
                <td>{formatMetric(clockfaceResult.summary.encodeMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.encodeMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.encodeMs, 'max')}</td>
              </tr>
              <tr>
                <td>Send</td>
                <td>{formatMetric(clockfaceResult.summary.sendMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.sendMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.sendMs, 'max')}</td>
              </tr>
              <tr>
                <td>Preview publish</td>
                <td>{formatMetric(clockfaceResult.summary.previewPublishMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.previewPublishMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.previewPublishMs, 'max')}</td>
              </tr>
              <tr>
                <td>Wait ready</td>
                <td>{formatMetric(clockfaceResult.summary.waitReadyMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.waitReadyMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.waitReadyMs, 'max')}</td>
              </tr>
              <tr>
                <td>Reset GIF</td>
                <td>{formatMetric(clockfaceResult.summary.resetMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.resetMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.resetMs, 'max')}</td>
              </tr>
              <tr>
                <td>Post-send delay</td>
                <td>{formatMetric(clockfaceResult.summary.postSendDelayMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.postSendDelayMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.postSendDelayMs, 'max')}</td>
              </tr>
              <tr>
                <td>Push gap</td>
                <td>{formatMetric(clockfaceResult.summary.pushStartGapMs, 'avg')}</td>
                <td>{formatMetric(clockfaceResult.summary.pushStartGapMs, 'p95')}</td>
                <td>{formatMetric(clockfaceResult.summary.pushStartGapMs, 'max')}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article>
          <h2>Scheduler blocks</h2>
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {#each schedulerBlockEntries(clockfaceResult) as [reason, count]}
                <tr>
                  <td>{reason}</td>
                  <td>{count}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </article>

        <article>
          <h2>Pixoo commands</h2>
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Count</th>
                <th>Errors</th>
                <th>Avg</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {#each commandEntries(clockfaceResult) as [command, sample]}
                <tr>
                  <td>{command}</td>
                  <td>{sample.count}</td>
                  <td>{sample.error}</td>
                  <td>{formatMetric(sample.durationMs, 'avg')}</td>
                  <td>{formatMetric(sample.durationMs, 'max')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </article>
      </section>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #111318;
    color: #eef1f5;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .benchmark-shell {
    width: min(940px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 28px 0 40px;
  }

  header,
  .controls,
  .summary,
  article {
    border: 1px solid #2a3039;
    background: #181b22;
    border-radius: 8px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
  }

  header div {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h1,
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 650;
  }

  h2 {
    font-size: 15px;
  }

  .mark {
    display: grid;
    place-items: center;
    color: #7dd3fc;
  }

  .benchmark-group {
    margin-top: 18px;
  }

  .section-heading {
    margin-bottom: 10px;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(110px, 1fr)) auto;
    gap: 12px;
    padding: 14px;
  }

  .clockface-controls {
    grid-template-columns: minmax(110px, 1fr) auto;
  }

  label {
    display: grid;
    gap: 6px;
    color: #9aa5b5;
    font-size: 12px;
  }

  input {
    min-width: 0;
    height: 34px;
    border: 1px solid #303743;
    border-radius: 6px;
    background: #101217;
    color: #eef1f5;
    padding: 0 10px;
  }

  button {
    border: 1px solid #303743;
    background: #202632;
    color: #eef1f5;
    cursor: pointer;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .icon-button {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 6px;
  }

  .run-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-width: 96px;
    height: 34px;
    align-self: end;
    border-radius: 6px;
  }

  .error {
    margin: 14px 0 0;
    color: #fca5a5;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
    padding: 14px;
  }

  .summary div {
    display: grid;
    gap: 4px;
  }

  .summary span {
    color: #9aa5b5;
    font-size: 12px;
  }

  .summary strong {
    overflow-wrap: anywhere;
    font-size: 14px;
  }

  .runs {
    display: grid;
    gap: 14px;
    margin-top: 14px;
  }

  article {
    padding: 14px;
  }

  table {
    width: 100%;
    margin-top: 12px;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 9px 8px;
    border-bottom: 1px solid #29303a;
    text-align: right;
  }

  th:first-child,
  td:first-child {
    text-align: left;
  }

  th {
    color: #9aa5b5;
    font-weight: 550;
  }

  tr:last-child td {
    border-bottom: 0;
  }

  @media (max-width: 720px) {
    .controls,
    .summary {
      grid-template-columns: 1fr;
    }
  }
</style>
