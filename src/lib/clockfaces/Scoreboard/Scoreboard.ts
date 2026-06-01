import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 64;
const MAX_SCORE = 99;
const DEFAULT_DATA = {
  blueScore: '0',
  redScore: '0'
};

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '010', '010', '010', '010'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111']
};

export default new Clockface({
  resolution: RESOLUTION,
  data: { ...DEFAULT_DATA },
  inputs: [
    [
      {
        type: 'button',
        id: 'incrementRed',
        friendlyName: 'Red +',
        onSubmit: (_value, context) => {
          context.data.redScore = String(clampScore(getScore(context, 'redScore') + 1));
          renderScoreboard(context);
        }
      },
      {
        type: 'button',
        id: 'incrementBlue',
        friendlyName: 'Blue +',
        onSubmit: (_value, context) => {
          context.data.blueScore = String(clampScore(getScore(context, 'blueScore') + 1));
          renderScoreboard(context);
        }
      }
    ],
    {
      type: 'button',
      id: 'reset',
      friendlyName: 'Clear',
      onSubmit: (_value, context) => {
        context.data.blueScore = DEFAULT_DATA.blueScore;
        context.data.redScore = DEFAULT_DATA.redScore;
        renderScoreboard(context);
      }
    }
  ],
  init: renderScoreboard,
  main: renderScoreboard
});

function renderScoreboard(context: ClockfaceContext) {
  drawBackground(context);
  drawCenterLine(context);
  drawScore(context, getScore(context, 'redScore'), 16, [255, 244, 235]);
  drawScore(context, getScore(context, 'blueScore'), 48, [236, 248, 255]);
}

function drawBackground(context: ClockfaceContext) {
  for (let y = 0; y < context.resolution; y += 1) {
    const verticalShade = 1 - Math.abs(y - 31.5) / 64;

    for (let x = 0; x < context.resolution; x += 1) {
      const isRedSide = x < context.resolution / 2;
      const base: ClockfacePixel = isRedSide ? [126, 18, 30] : [12, 54, 132];
      const accent: ClockfacePixel = isRedSide ? [216, 38, 45] : [28, 122, 224];
      const amount = Math.max(0, Math.min(1, verticalShade * 0.52));

      setPixel(context, x, y, mixPixel(base, accent, amount));
    }
  }
}

function drawCenterLine(context: ClockfaceContext) {
  for (let y = 3; y < context.resolution - 3; y += 1) {
    setPixel(context, 31, y, [18, 20, 28]);
    setPixel(context, 32, y, [232, 238, 245]);
  }
}

function drawScore(context: ClockfaceContext, score: number, centerX: number, color: ClockfacePixel) {
  const text = String(score);
  const scale = text.length > 1 ? 4 : 6;
  const textWidth = getTextWidth(text, scale);
  const x = Math.round(centerX - textWidth / 2);
  const y = Math.round((context.resolution - 7 * scale) / 2);

  drawText(context, text, x + 1, y + 1, scale, [0, 0, 0], 0.42);
  drawText(context, text, x, y, scale, color);
}

function drawText(
  context: ClockfaceContext,
  text: string,
  startX: number,
  startY: number,
  scale: number,
  color: ClockfacePixel,
  opacity = 1
) {
  let cursorX = startX;

  for (const character of text) {
    const digit = DIGITS[character] ?? DIGITS['0'];
    drawDigit(context, digit, cursorX, startY, scale, color, opacity);
    cursorX += (digit[0].length + 1) * scale;
  }
}

function drawDigit(
  context: ClockfaceContext,
  digit: string[],
  startX: number,
  startY: number,
  scale: number,
  color: ClockfacePixel,
  opacity: number
) {
  digit.forEach((row, rowY) => {
    [...row].forEach((pixel, rowX) => {
      if (pixel !== '1') {
        return;
      }

      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          blendPixel(context, startX + rowX * scale + x, startY + rowY * scale + y, color, opacity);
        }
      }
    });
  });
}

function getTextWidth(text: string, scale: number) {
  return text.length * 3 * scale + Math.max(0, text.length - 1) * scale;
}

function getScore(context: ClockfaceContext, key: 'blueScore' | 'redScore') {
  return clampScore(Number.parseInt(context.data[key] ?? '0', 10));
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_SCORE, Math.round(value)));
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

function mixPixel(start: ClockfacePixel, end: ClockfacePixel, amount: number): ClockfacePixel {
  const clamped = Math.max(0, Math.min(1, amount));

  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped)
  ];
}
