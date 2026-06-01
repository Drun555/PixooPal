import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const DEFAULT_RESOLUTION = 64;
const DEFAULT_DATA = {
  text: 'PixooPal',
  textColor: '#ffffff',
  backgroundColor: '#000000'
};

const FONT: Record<string, string[]> = {
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '?': ['11110', '00001', '00001', '00110', '00100', '00000', '00100'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ':': ['0', '1', '0', '0', '0', '1', '0'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
};

export default new Clockface({
  resolution: DEFAULT_RESOLUTION,
  data: { ...DEFAULT_DATA },
  inputs: [
    {
      type: 'input-text',
      id: 'text',
      friendlyName: 'Text',
      onSubmit: (value, context) => {
        context.data.text = String(value);
        renderDisplayText(context);
      }
    },
    {
      type: 'colorpicker',
      id: 'textColor',
      friendlyName: 'Text color',
      onSubmit: (value, context) => {
        context.data.textColor = String(value);
        renderDisplayText(context);
      }
    },
    {
      type: 'colorpicker',
      id: 'backgroundColor',
      friendlyName: 'Background color',
      onSubmit: (value, context) => {
        context.data.backgroundColor = String(value);
        renderDisplayText(context);
      }
    }
  ],
  init: (context) => {
    clearBuffer(context, parseHexColor(context.data.backgroundColor));
  },
  main: renderDisplayText
});

function renderDisplayText(context: ClockfaceContext) {
  const text = (context.data.text || '').trim() || DEFAULT_DATA.text;
  const textColor = parseHexColor(context.data.textColor || DEFAULT_DATA.textColor);
  const backgroundColor = parseHexColor(context.data.backgroundColor || DEFAULT_DATA.backgroundColor);
  const characters = [...text.toUpperCase()].map((character) => FONT[character] ?? FONT['?']);
  const textWidth = getTextWidth(characters);
  const x = Math.floor((context.resolution - textWidth) / 2);
  const y = Math.floor((context.resolution - 7) / 2);

  clearBuffer(context, backgroundColor);
  drawText(context, characters, x, y, textColor);
}

function drawText(
  context: ClockfaceContext,
  characters: string[][],
  startX: number,
  startY: number,
  color: ClockfacePixel
) {
  let cursorX = startX;

  for (const character of characters) {
    drawCharacter(context, character, cursorX, startY, color);
    cursorX += character[0].length + 1;
  }
}

function drawCharacter(
  context: ClockfaceContext,
  character: string[],
  startX: number,
  startY: number,
  color: ClockfacePixel
) {
  character.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === '1') {
        setPixel(context, startX + x, startY + y, color);
      }
    });
  });
}

function getTextWidth(characters: string[][]) {
  if (characters.length === 0) {
    return 0;
  }

  return characters.reduce((width, character) => width + character[0].length + 1, -1);
}

function clearBuffer(context: ClockfaceContext, color: ClockfacePixel) {
  for (let index = 0; index < context.buffer.length; index += 1) {
    context.buffer[index] = [...color];
  }
}

function setPixel(context: ClockfaceContext, x: number, y: number, color: ClockfacePixel) {
  if (x < 0 || y < 0 || x >= context.resolution || y >= context.resolution) {
    return;
  }

  context.buffer[x + y * context.resolution] = [...color];
}

function parseHexColor(value: string): ClockfacePixel {
  const normalized = value.trim();

  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    return [255, 255, 255];
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16)
  ];
}
