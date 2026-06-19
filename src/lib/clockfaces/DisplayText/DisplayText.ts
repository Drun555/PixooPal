import { color, defineClockface, data, input } from '@pixoopal/clockface';
import {
  drawBitmapText,
  getBitmapTextLineHeight,
  measureBitmapText
} from '@pixoopal/clockface/bitmap-text';
import { getRuntimeResolution } from '$lib/server/config';

const DEFAULT_DATA = {
  text: 'love',
  textColor: '#ff00d0',
  backgroundColor: '#000000'
};

const LINE_GAP = 2;
const SCROLL_STEP_PX = 1;
const SCROLL_EDGE_PAUSE_FRAMES = 9;
const scrollStates = new Map<string, ScrollState>();

export default defineClockface({
  resolution: () => getRuntimeResolution(),
  interval: 80,
  frameQueueSize: 1,
  data: {
    text: data.string(DEFAULT_DATA.text),
    textColor: data.color(DEFAULT_DATA.textColor),
    backgroundColor: data.color(DEFAULT_DATA.backgroundColor)
  },
  inputs: [
    input.text('text', 'Text', {
      onSubmit(value, context) {
        context.data.text = String(value).toLowerCase();
      }
    }),
    input.color('textColor', 'Text color'),
    input.color('backgroundColor', 'Background color')
  ],
  render: async (context) => {
    const text = (context.data.text || DEFAULT_DATA.text).trim() || DEFAULT_DATA.text;
    const lines = wrapText(text, context.resolution);
    const lineHeight = getBitmapTextLineHeight();
    const blockHeight = lines.length * lineHeight + Math.max(0, lines.length - 1) * LINE_GAP;
    let y = Math.max(0, Math.floor((context.resolution - blockHeight) / 2));
    const textColor = color.parse(context.data.textColor || DEFAULT_DATA.textColor);

    context.canvas.clear(context.data.backgroundColor || DEFAULT_DATA.backgroundColor);

    for (const line of lines) {
      await drawBitmapText({
        buffer: context.buffer,
        size: context.resolution,
        text: line.text,
        x: getTextX(line, context.resolution, lines),
        y,
        color: textColor
      });

      y += lineHeight + LINE_GAP;
    }

    advanceScrollStates(lines, context.resolution);
  }
});

type TextLine = {
  text: string;
  width: number;
  scroll: boolean;
};

type ScrollState = {
  offset: number;
  direction: 1 | -1;
  pauseFrames: number;
};

function wrapText(text: string, resolution: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: TextLine[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (measureBitmapText(candidate) <= resolution) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(createLine(current, resolution));
      current = '';
    }

    if (measureBitmapText(word) <= resolution) {
      current = word;
    } else {
      lines.push(createLine(word, resolution));
    }
  }

  if (current) {
    lines.push(createLine(current, resolution));
  }

  return lines.length > 0 ? lines : [createLine(DEFAULT_DATA.text, resolution)];
}

function createLine(text: string, resolution: number): TextLine {
  const width = measureBitmapText(text);

  return {
    text,
    width,
    scroll: width > resolution
  };
}

function getTextX(line: TextLine, resolution: number, lines: TextLine[]) {
  if (!line.scroll) {
    return Math.floor((resolution - line.width) / 2);
  }

  return -getScrollState(line, lines).offset;
}

function advanceScrollStates(lines: TextLine[], resolution: number) {
  for (const line of lines) {
    if (!line.scroll) {
      continue;
    }

    const state = getScrollState(line, lines);
    const maxOffset = line.width - resolution;

    if (state.pauseFrames > 0) {
      state.pauseFrames -= 1;
      continue;
    }

    state.offset += state.direction * SCROLL_STEP_PX;

    if (state.offset >= maxOffset) {
      state.offset = maxOffset;
      state.direction = -1;
      state.pauseFrames = SCROLL_EDGE_PAUSE_FRAMES;
    } else if (state.offset <= 0) {
      state.offset = 0;
      state.direction = 1;
      state.pauseFrames = SCROLL_EDGE_PAUSE_FRAMES;
    }
  }
}

function getScrollState(line: TextLine, lines: TextLine[]) {
  const key = createScrollKey(line, lines);
  const existing = scrollStates.get(key);

  if (existing) {
    return existing;
  }

  const created: ScrollState = {
    offset: 0,
    direction: 1,
    pauseFrames: SCROLL_EDGE_PAUSE_FRAMES
  };

  scrollStates.set(key, created);
  deleteStaleScrollStates(lines);

  return created;
}

function createScrollKey(line: TextLine, lines: TextLine[]) {
  const lineIndex = lines.indexOf(line);

  return `${lineIndex}:${line.text}:${line.width}`;
}

function deleteStaleScrollStates(lines: TextLine[]) {
  const currentKeys = new Set(
    lines.filter((line) => line.scroll).map((line) => createScrollKey(line, lines))
  );

  for (const key of scrollStates.keys()) {
    if (!currentKeys.has(key)) {
      scrollStates.delete(key);
    }
  }
}
