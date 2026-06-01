import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 64;
const DEFAULT_SNOWFLAKE_COUNT = 48;
const MIN_SNOWFLAKE_COUNT = 0;
const MAX_SNOWFLAKE_COUNT = 180;

type Snowflake = {
  x: number;
  y: number;
  speed: number;
  drift: number;
  phase: number;
  brightness: number;
  size: number;
};

let snowflakes: Snowflake[] = [];
let frame = 0;

export default new Clockface({
  resolution: RESOLUTION,
  data: {
    snowflakeCount: DEFAULT_SNOWFLAKE_COUNT.toString()
  },
  inputs: [
    {
      type: 'input-num',
      id: 'snowflakeCount',
      friendlyName: 'Snowflakes',
      onSubmit: (value, context) => {
        context.data.snowflakeCount = normalizeSnowflakeCount(String(value)).toString();
        syncSnowflakes(context);
      }
    }
  ],
  updateIntervalMs: 120,
  init: (context) => {
    syncSnowflakes(context);
  },
  main: renderSnowfall
});

function renderSnowfall(context: ClockfaceContext) {
  frame += 1;
  syncSnowflakes(context);
  drawBackground(context);

  for (const snowflake of snowflakes) {
    snowflake.y += snowflake.speed;
    snowflake.x += Math.sin(frame * 0.045 + snowflake.phase) * snowflake.drift;

    if (snowflake.y >= context.resolution + 2) {
      resetSnowflake(snowflake, true);
    }

    if (snowflake.x < -2) {
      snowflake.x = context.resolution + 1;
    } else if (snowflake.x > context.resolution + 2) {
      snowflake.x = -1;
    }

    drawSnowflake(context, snowflake);
  }
}

function syncSnowflakes(context: ClockfaceContext) {
  const targetCount = normalizeSnowflakeCount(context.data.snowflakeCount);
  context.data.snowflakeCount = targetCount.toString();

  while (snowflakes.length < targetCount) {
    snowflakes.push(createSnowflake(false));
  }

  if (snowflakes.length > targetCount) {
    snowflakes = snowflakes.slice(0, targetCount);
  }
}

function createSnowflake(fromTop: boolean): Snowflake {
  const snowflake: Snowflake = {
    x: 0,
    y: 0,
    speed: 0,
    drift: 0,
    phase: 0,
    brightness: 0,
    size: 1
  };

  resetSnowflake(snowflake, fromTop);
  return snowflake;
}

function resetSnowflake(snowflake: Snowflake, fromTop: boolean) {
  snowflake.x = randomBetween(0, RESOLUTION - 1);
  snowflake.y = fromTop ? randomBetween(-10, -1) : randomBetween(0, RESOLUTION - 1);
  snowflake.speed = randomBetween(0.28, 0.92);
  snowflake.drift = randomBetween(0.04, 0.22);
  snowflake.phase = randomBetween(0, Math.PI * 2);
  snowflake.brightness = randomBetween(150, 255);
  snowflake.size = Math.random() > 0.86 ? 2 : 1;
}

function drawBackground(context: ClockfaceContext) {
  const top: ClockfacePixel = [5, 10, 24];
  const bottom: ClockfacePixel = [20, 32, 54];

  for (let y = 0; y < context.resolution; y += 1) {
    const amount = y / (context.resolution - 1);
    const color = mixPixel(top, bottom, amount);

    for (let x = 0; x < context.resolution; x += 1) {
      setPixel(context, x, y, color);
    }
  }
}

function drawSnowflake(context: ClockfaceContext, snowflake: Snowflake) {
  const x = Math.round(snowflake.x);
  const y = Math.round(snowflake.y);
  const color = getSnowColor(snowflake.brightness);

  blendPixel(context, x, y, color, 0.95);

  if (snowflake.size === 2) {
    blendPixel(context, x - 1, y, color, 0.34);
    blendPixel(context, x + 1, y, color, 0.34);
    blendPixel(context, x, y - 1, color, 0.28);
    blendPixel(context, x, y + 1, color, 0.28);
  }
}

function normalizeSnowflakeCount(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SNOWFLAKE_COUNT;
  }

  return Math.max(MIN_SNOWFLAKE_COUNT, Math.min(MAX_SNOWFLAKE_COUNT, parsed));
}

function getSnowColor(brightness: number): ClockfacePixel {
  return [
    Math.round(brightness * 0.88),
    Math.round(brightness * 0.94),
    Math.round(brightness)
  ];
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function mixPixel(start: ClockfacePixel, end: ClockfacePixel, amount: number): ClockfacePixel {
  const clamped = Math.max(0, Math.min(1, amount));

  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped)
  ];
}

function blendPixel(
  context: ClockfaceContext,
  x: number,
  y: number,
  color: ClockfacePixel,
  opacity: number
) {
  if (x < 0 || y < 0 || x >= context.resolution || y >= context.resolution) {
    return;
  }

  const current = context.buffer[x + y * context.resolution];
  context.buffer[x + y * context.resolution] = mixPixel(current, color, opacity);
}

function setPixel(context: ClockfaceContext, x: number, y: number, color: ClockfacePixel) {
  context.buffer[x + y * context.resolution] = [...color];
}
