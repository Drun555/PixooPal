# How To Create Clockfaces

A Clockface is a standalone file in `src/lib/clockfaces/*.ts` that exports `default new Clockface(...)`.
The file is picked up automatically and appears in the Clockface selector in the UI.

## Minimal Template

```ts
import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 64;

export default new Clockface({
  resolution: RESOLUTION,
  data: {
    text: 'hello'
  },
  inputs: [],
  init: render,
  main: render
});

function render(context: ClockfaceContext) {
  clear(context, [0, 0, 0]);
  // draw into context.buffer
}

function clear(context: ClockfaceContext, color: ClockfacePixel) {
  for (let index = 0; index < context.buffer.length; index += 1) {
    context.buffer[index] = [...color];
  }
}
```

## Core Fields

- `resolution`: usually `64`.
- `data`: string values that are visible to the UI and persisted across restarts.
- `inputs`: UI controls. You can pass single inputs or arrays of inputs to place them in one row.
- `init(context)`: called when the Clockface is created and after persisted state is loaded.
- `main(context)`: called on every render/frame push.
- `updateIntervalMs`: if greater than `0`, the Clockface updates itself on a timer.
- `getUpdateIntervalMs(context)`: a dynamic interval when timing depends on current state.
- `start(context)` / `stop(context)`: optional hooks for enabling/disabling resources.

## Inputs

Supported types:

- `button`
- `input-text`
- `input-num`
- `input-file`
- `colorpicker`
- `select`

Example with grouped buttons in one row:

```ts
inputs: [
  {
    type: 'button',
    id: 'up',
    friendlyName: '↑',
    onSubmit: (_value, context) => {
      // update state
    }
  },
  [
    {
      type: 'button',
      id: 'left',
      friendlyName: '←',
      onSubmit: (_value, context) => {}
    },
    {
      type: 'button',
      id: 'right',
      friendlyName: '→',
      onSubmit: (_value, context) => {}
    }
  ],
  {
    type: 'button',
    id: 'down',
    friendlyName: '↓',
    onSubmit: (_value, context) => {}
  }
]
```

Inside `Clockface`, grouped inputs are automatically flattened into `context.inputs`, while the UI uses the grouping to render rows.

## Drawing

`context.buffer` is an array of pixels:

```ts
type ClockfacePixel = [number, number, number];
```

Pixel index:

```ts
const index = x + y * context.resolution;
context.buffer[index] = [255, 255, 255];
```

Always check bounds if coordinates may go off-screen:

```ts
function setPixel(context: ClockfaceContext, x: number, y: number, color: ClockfacePixel) {
  if (x < 0 || y < 0 || x >= context.resolution || y >= context.resolution) {
    return;
  }

  context.buffer[x + y * context.resolution] = [...color];
}
```

## State And Persistence

Put user-facing settings into `context.data` when they should:

- be shown in the UI;
- survive restarts;
- be available to inputs.

`context.data` stores strings, so normalize numbers before saving:

```ts
context.data.speed = String(Math.max(1, Number.parseInt(value, 10) || 1));
```

Use module-level variables for internal runtime state:

```ts
let frame = 0;
let particles: Particle[] = [];
```

They are not persisted across restarts, but they are a good fit for animation state and game objects.

## Timers And Preview

If `updateIntervalMs > 0`, the server calls `main`, sends the frame to Pixoo, and pushes the preview over WebSocket at the same moment.

```ts
export default new Clockface({
  resolution: 64,
  data: {},
  inputs: [],
  updateIntervalMs: 120,
  init,
  main
});
```

Do not start your own `setInterval` inside a Clockface unless you really need to. Usually `updateIntervalMs` is enough.

## Bitmap Text And Emoji

For text, use helpers from `src/lib/server/bitmapText.ts` when the Clockface renders on the server and needs pixel fonts or emoji. It already has fallback to `regular` and emoji support.

## GIF / Video

For local GIF/video frames, use the shared helper:

```ts
import {
  createMediaAnimation,
  decodeMediaFile,
  drawMediaAnimationFrame,
  type MediaAnimation
} from './shared/mediaAnimation';

let animation: MediaAnimation | undefined;
```

Loading a file:

```ts
animation = createMediaAnimation(
  await decodeMediaFile(value, { resolution: context.resolution })
);
```

Drawing the current frame:

```ts
if (animation) {
  drawMediaAnimationFrame(context, animation, context.data.playbackSpeed);
}
```

## Good Rules

- Keep a Clockface self-contained in one file until it genuinely grows too large.
- Use `context.data` for settings and module-level variables for runtime state.
- After `onSubmit`, update `context.data` immediately and redraw the buffer if needed.
- For repeated animation, use `updateIntervalMs` instead of a manual timer.
- Do not put helper files directly in `src/lib/clockfaces/*.ts` unless they are Clockfaces. Put helpers in a subfolder such as `src/lib/clockfaces/shared/`; otherwise the autoloader will treat them as Clockfaces.
- After adding a Clockface, run `npm run check`.
