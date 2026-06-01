import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 64;
const SCALE = 2;

const DIGITS: Record<string, string[]> = {
  ':': ['0', '1', '0', '0', '0', '1', '0'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110']
};

type TimePalette = {
  hour: number;
  top: ClockfacePixel;
  bottom: ClockfacePixel;
  text: ClockfacePixel;
  glow: ClockfacePixel;
};

const PALETTES: TimePalette[] = [
  {
    hour: 0,
    top: [7, 10, 32],
    bottom: [20, 12, 42],
    text: [218, 232, 255],
    glow: [42, 58, 114]
  },
  {
    hour: 5,
    top: [28, 35, 85],
    bottom: [213, 92, 98],
    text: [255, 237, 215],
    glow: [236, 112, 114]
  },
  {
    hour: 9,
    top: [42, 136, 214],
    bottom: [124, 207, 227],
    text: [255, 252, 235],
    glow: [250, 220, 132]
  },
  {
    hour: 16,
    top: [55, 124, 192],
    bottom: [252, 161, 84],
    text: [255, 244, 225],
    glow: [255, 181, 105]
  },
  {
    hour: 20,
    top: [20, 25, 68],
    bottom: [88, 35, 86],
    text: [230, 238, 255],
    glow: [96, 72, 155]
  },
  {
    hour: 24,
    top: [7, 10, 32],
    bottom: [20, 12, 42],
    text: [218, 232, 255],
    glow: [42, 58, 114]
  }
];

export default new Clockface({
  resolution: RESOLUTION,
  data: {},
  inputs: [],
  updateIntervalMs: 1000,
  init: renderClock,
  main: renderClock
});

function renderClock(context: ClockfaceContext) {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const palette = getPalette(hour + minute / 60);
  const textWidth = getTextWidth(time) * SCALE;
  const textHeight = 7 * SCALE;
  const x = Math.floor((context.resolution - textWidth) / 2);
  const y = Math.floor((context.resolution - textHeight) / 2);

  drawBackground(context, palette);
  drawText(context, time, x + 1, y + 2, SCALE, [0, 0, 0], 0.38);
  drawText(context, time, x, y, SCALE, palette.text);
}

function drawBackground(context: ClockfaceContext, palette: TimePalette) {
  const center = (context.resolution - 1) / 2;

  for (let y = 0; y < context.resolution; y += 1) {
    const vertical = y / (context.resolution - 1);

    for (let x = 0; x < context.resolution; x += 1) {
      const distance = Math.hypot((x - center) / center, (y - center) / center);
      const vignette = Math.max(0, 1 - distance) * 0.24;
      const base = mixPixel(palette.top, palette.bottom, vertical);
      const glow = mixPixel(base, palette.glow, vignette);

      setPixel(context, x, y, glow);
    }
  }
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
    const bitmap = DIGITS[character];

    if (!bitmap) {
      continue;
    }

    drawCharacter(context, bitmap, cursorX, startY, scale, color, opacity);
    cursorX += (bitmap[0].length + 1) * scale;
  }
}

function drawCharacter(
  context: ClockfaceContext,
  bitmap: string[],
  startX: number,
  startY: number,
  scale: number,
  color: ClockfacePixel,
  opacity: number
) {
  bitmap.forEach((row, rowY) => {
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

function getTextWidth(text: string) {
  return [...text].reduce((width, character) => {
    const bitmap = DIGITS[character];

    if (!bitmap) {
      return width;
    }

    return width + bitmap[0].length + 1;
  }, -1);
}

function getPalette(hour: number): TimePalette {
  const nextIndex = PALETTES.findIndex((palette) => palette.hour >= hour);
  const end = PALETTES[Math.max(nextIndex, 1)];
  const start = PALETTES[Math.max(nextIndex - 1, 0)];
  const progress = (hour - start.hour) / (end.hour - start.hour || 1);

  return {
    hour,
    top: mixPixel(start.top, end.top, progress),
    bottom: mixPixel(start.bottom, end.bottom, progress),
    text: mixPixel(start.text, end.text, progress),
    glow: mixPixel(start.glow, end.glow, progress)
  };
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
