import * as PImage from 'pureimage';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CELL_SIZE = 16;
const EMOJI_DIR = join(process.cwd(), 'src', 'lib', 'emojis');
const LIST_PATH = join(EMOJI_DIR, 'emoji_list.txt');
const SHEET_FILE = 'Dotto Emoji.png';
const SHEET_PATH = join(EMOJI_DIR, SHEET_FILE);
const OUTPUT_PATH = join(EMOJI_DIR, 'dotto-emoji.json');

const emojiList = readFileSync(LIST_PATH, 'utf-8');
const image = await PImage.decodePNGFromStream(createReadStream(SHEET_PATH));
const width = image.width;
const height = image.height;
const data = image.data;
const columns = Math.floor(width / CELL_SIZE);
const rows = Math.floor(height / CELL_SIZE);
const { cells, sourceCount, skippedRows } = parseEmojiCells(emojiList);

if (width % CELL_SIZE !== 0 || height % CELL_SIZE !== 0) {
  throw new Error(`Dotto Emoji sheet size must be divisible by ${CELL_SIZE}: ${width}x${height}.`);
}

const entries = Object.fromEntries(
  cells.map(({ emoji, index, column, row }) => {
    const x = column * CELL_SIZE;
    const y = row * CELL_SIZE;

    return [
      emoji,
      {
        index,
        x,
        y,
        width: CELL_SIZE,
        height: CELL_SIZE,
        visible: hasVisiblePixels(data, width, x, y),
        codepoints: getCodepoints(emoji)
      }
    ];
  })
);

const visibleCount = Object.values(entries).filter((entry) => entry.visible).length;

writeFileSync(
  OUTPUT_PATH,
  `${JSON.stringify(
    {
      sheet: SHEET_FILE,
      cellSize: CELL_SIZE,
      width,
      height,
      columns,
      rows,
      count: Object.keys(entries).length,
      sourceCount,
      skippedRows,
      visibleCount,
      entries
    },
    null,
    2
  )}\n`,
  'utf-8'
);

console.log(`Built ${OUTPUT_PATH}`);
console.log(`Mapped ${Object.keys(entries).length} of ${sourceCount} emoji into ${columns}x${rows} cells.`);
console.log(`${visibleCount} mapped cells contain visible pixels.`);
console.log(`${skippedRows} emoji_list rows were outside the sprite sheet.`);

function parseEmojiCells(source) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const seen = new Set();
  const cells = [];
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/u, '').split('\n');
  let sourceCount = 0;
  let skippedRows = 0;

  for (const [row, line] of lines.entries()) {
    const emojis = [...segmenter.segment(line)]
      .map((item) => item.segment)
      .filter((segment) => !/^\s+$/u.test(segment));

    sourceCount += emojis.length;

    if (row >= rows) {
      skippedRows += 1;
      continue;
    }

    if (emojis.length > columns) {
      throw new Error(
        `emoji_list.txt row ${row + 1} has ${emojis.length} emoji, but ${SHEET_FILE} has ${columns} columns.`
      );
    }

    for (const [column, emoji] of emojis.entries()) {
      if (seen.has(emoji)) {
        continue;
      }

      seen.add(emoji);
      cells.push({
        emoji,
        index: cells.length,
        column,
        row
      });
    }
  }

  return { cells, sourceCount, skippedRows };
}

function hasVisiblePixels(data, width, x0, y0) {
  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      const alpha = data[(x0 + x + (y0 + y) * width) * 4 + 3];

      if (alpha > 127) {
        return true;
      }
    }
  }

  return false;
}

function getCodepoints(value) {
  return [...value].map((character) => character.codePointAt(0)?.toString(16) ?? '0');
}
