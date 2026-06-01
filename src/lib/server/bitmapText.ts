import * as PImage from 'pureimage';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import emojiAtlasPath from '$lib/emojis/Dotto Emoji.png?url';
import emojiManifest from '$lib/emojis/dotto-emoji.json';

export type BitmapTextColor = [number, number, number];

export type BitmapTextClip = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type DrawBitmapTextOptions = {
  buffer: number[];
  size: number;
  text: string;
  x: number;
  y: number;
  fontName?: string;
  color?: BitmapTextColor;
  clip?: BitmapTextClip;
};

type BitmapGlyph = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
};

type BitmapFont = {
  lineHeight: number;
  glyphs: Map<number, BitmapGlyph>;
  fallback: BitmapGlyph;
};

type BitmapAtlas = {
  width: number;
  height: number;
  data: Uint8Array;
};

type BitmapEmoji = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  codepoints: string[];
};

type BitmapEmojiManifest = {
  sheet: string;
  cellSize: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  count: number;
  entries: Record<string, BitmapEmoji>;
};

type BitmapTextToken =
  | {
      type: 'glyph';
      glyph: BitmapGlyph;
      xadvance: number;
    }
  | {
      type: 'emoji';
      emoji: BitmapEmoji;
      xadvance: number;
    };

type LoadedBitmapFont = {
  name: string;
  atlasPath: string;
  font: BitmapFont;
  atlasReady?: Promise<BitmapAtlas>;
};

const DEFAULT_FONT_NAME = 'regular';
const EMOJI_ADVANCE = 17;
const dottoEmojiManifest = emojiManifest as BitmapEmojiManifest;
const textSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const fontDefinitions = import.meta.glob<string>('../fonts/*.fnt', {
  eager: true,
  query: '?raw',
  import: 'default'
});
const fontAtlasPaths = import.meta.glob<string>('../fonts/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
});
const bitmapFonts = loadBitmapFonts();
let emojiAtlasReady: Promise<BitmapAtlas> | undefined;

export function getBitmapTextLineHeight(fontName = DEFAULT_FONT_NAME) {
  return getBitmapFont(fontName).font.lineHeight;
}

export function getBitmapTextRenderHeight(text: string, fontName = DEFAULT_FONT_NAME) {
  const bitmapFont = getBitmapFont(fontName).font;

  return tokenizeBitmapText(text, bitmapFont).reduce((height, token) => {
    if (token.type === 'emoji') {
      return Math.max(height, token.emoji.height);
    }

    return Math.max(height, bitmapFont.lineHeight);
  }, bitmapFont.lineHeight);
}

export function measureBitmapText(text: string, fontName = DEFAULT_FONT_NAME) {
  const bitmapFont = getBitmapFont(fontName).font;

  return tokenizeBitmapText(text, bitmapFont).reduce((width, token) => width + token.xadvance, 0);
}

export async function drawBitmapText({
  buffer,
  size,
  text,
  x,
  y,
  fontName = DEFAULT_FONT_NAME,
  color = [248, 255, 255],
  clip = {
    left: 0,
    right: size - 1,
    top: 0,
    bottom: size - 1
  }
}: DrawBitmapTextOptions) {
  const bitmapFont = getBitmapFont(fontName);
  const atlas = await ensureAtlasReady(bitmapFont);
  const tokens = tokenizeBitmapText(text, bitmapFont.font);
  const renderHeight = getTokenRenderHeight(tokens, bitmapFont.font);
  let emojiAtlas: BitmapAtlas | undefined;
  let cursorX = x;

  for (const token of tokens) {
    if (token.type === 'emoji') {
      emojiAtlas ??= await ensureEmojiAtlasReady();
      drawEmoji(buffer, size, emojiAtlas, token.emoji, cursorX, y, clip);
      cursorX += token.xadvance;
      continue;
    }

    const glyphY = y + Math.floor((renderHeight - bitmapFont.font.lineHeight) / 2);
    drawGlyph(buffer, size, atlas, token.glyph, cursorX, glyphY, color, clip);
    cursorX += token.xadvance;
  }
}

function drawGlyph(
  buffer: number[],
  size: number,
  atlas: BitmapAtlas,
  glyph: BitmapGlyph,
  startX: number,
  startY: number,
  color: BitmapTextColor,
  clip: BitmapTextClip
) {
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const targetX = startX + glyph.xoffset + x;
      const targetY = startY + glyph.yoffset + y;

      if (
        targetX < clip.left ||
        targetX > clip.right ||
        targetY < clip.top ||
        targetY > clip.bottom
      ) {
        continue;
      }

      const sourceIndex = (glyph.x + x + (glyph.y + y) * atlas.width) * 4;
      const alpha = atlas.data[sourceIndex + 3] / 255;

      if (alpha < 0.5) {
        continue;
      }

      setFlatPixel(buffer, size, targetX, targetY, color);
    }
  }
}

function drawEmoji(
  buffer: number[],
  size: number,
  atlas: BitmapAtlas,
  emoji: BitmapEmoji,
  startX: number,
  startY: number,
  clip: BitmapTextClip
) {
  for (let y = 0; y < emoji.height; y += 1) {
    for (let x = 0; x < emoji.width; x += 1) {
      const targetX = startX + x;
      const targetY = startY + y;

      if (
        targetX < clip.left ||
        targetX > clip.right ||
        targetY < clip.top ||
        targetY > clip.bottom
      ) {
        continue;
      }

      const sourceIndex = (emoji.x + x + (emoji.y + y) * atlas.width) * 4;
      const alpha = atlas.data[sourceIndex + 3] / 255;

      if (alpha < 0.5) {
        continue;
      }

      setFlatPixel(buffer, size, targetX, targetY, [
        atlas.data[sourceIndex],
        atlas.data[sourceIndex + 1],
        atlas.data[sourceIndex + 2]
      ]);
    }
  }
}

function getGlyph(bitmapFont: BitmapFont, character: string) {
  return bitmapFont.glyphs.get(character.codePointAt(0) ?? 0) ?? bitmapFont.fallback;
}

function setFlatPixel(buffer: number[], size: number, x: number, y: number, color: BitmapTextColor) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const index = (x + y * size) * 3;
  buffer[index] = color[0];
  buffer[index + 1] = color[1];
  buffer[index + 2] = color[2];
}

function ensureAtlasReady(bitmapFont: LoadedBitmapFont) {
  if (!bitmapFont.atlasReady) {
    bitmapFont.atlasReady = PImage.decodePNGFromStream(
      createReadStream(resolveAssetPath(bitmapFont))
    ).then((image: ReturnType<typeof PImage.make>) => ({
      width: image.width,
      height: image.height,
      data: image.data as Uint8Array
    }));
  }

  return bitmapFont.atlasReady;
}

function ensureEmojiAtlasReady() {
  if (!emojiAtlasReady) {
    emojiAtlasReady = PImage.decodePNGFromStream(
      createReadStream(
        resolveImportedAssetPath(
          emojiAtlasPath,
          join(process.cwd(), 'src', 'lib', 'emojis', dottoEmojiManifest.sheet)
        )
      )
    ).then((image: ReturnType<typeof PImage.make>) => ({
      width: image.width,
      height: image.height,
      data: image.data as Uint8Array
    }));
  }

  return emojiAtlasReady;
}

function resolveAssetPath(font: LoadedBitmapFont) {
  return resolveImportedAssetPath(
    font.atlasPath,
    join(process.cwd(), 'src', 'lib', 'fonts', `${font.name}.png`)
  );
}

function resolveImportedAssetPath(path: string, sourcePath: string) {
  if (/^[a-z]:/i.test(path)) {
    return path;
  }

  if (path.startsWith('/')) {
    const assetPath = join(process.cwd(), path.slice(1));

    if (existsSync(assetPath)) {
      return assetPath;
    }

    const buildAssetPath = join(process.cwd(), 'build', 'client', path.slice(1));
    return existsSync(buildAssetPath) ? buildAssetPath : sourcePath;
  }

  const modulePath = fileURLToPath(new URL(path, import.meta.url));
  return existsSync(modulePath) ? modulePath : sourcePath;
}

function tokenizeBitmapText(text: string, bitmapFont: BitmapFont) {
  return segmentText(text).map((segment): BitmapTextToken => {
    const emoji = getEmoji(segment);

    if (emoji) {
      return {
        type: 'emoji',
        emoji,
        xadvance: EMOJI_ADVANCE
      };
    }

    const glyph = getGlyph(bitmapFont, segment);

    return {
      type: 'glyph',
      glyph,
      xadvance: glyph.xadvance
    };
  });
}

function getTokenRenderHeight(tokens: BitmapTextToken[], bitmapFont: BitmapFont) {
  return tokens.reduce((height, token) => {
    if (token.type === 'emoji') {
      return Math.max(height, token.emoji.height);
    }

    return Math.max(height, bitmapFont.lineHeight);
  }, bitmapFont.lineHeight);
}

function segmentText(text: string) {
  return [...textSegmenter.segment(text)].map((segment) => segment.segment);
}

function getEmoji(segment: string) {
  const stripped = stripEmojiVariationSelectors(segment);
  const candidates = [
    segment,
    stripped
  ].filter((value): value is string => typeof value === 'string');

  for (const candidate of candidates) {
    const emoji = dottoEmojiManifest.entries[candidate];

    if (emoji?.visible) {
      return emoji;
    }
  }

  return undefined;
}

function stripEmojiVariationSelectors(segment: string) {
  return segment.replace(/\ufe0f/gu, '');
}

function loadBitmapFonts() {
  const atlases = new Map<string, string>();
  const fonts = new Map<string, LoadedBitmapFont>();

  for (const [path, atlasPath] of Object.entries(fontAtlasPaths)) {
    atlases.set(getFontNameFromPath(path), atlasPath);
  }

  for (const [path, definition] of Object.entries(fontDefinitions)) {
    const name = getFontNameFromPath(path);
    const atlasPath = atlases.get(name);

    if (!atlasPath) {
      throw new Error(`Bitmap font "${name}" has no matching PNG atlas.`);
    }

    fonts.set(name, {
      name,
      atlasPath,
      font: parseBitmapFont(definition)
    });
  }

  if (!fonts.has(DEFAULT_FONT_NAME)) {
    throw new Error(`Default bitmap font "${DEFAULT_FONT_NAME}" was not found.`);
  }

  return fonts;
}

function getBitmapFont(fontName: string | undefined) {
  return bitmapFonts.get(normalizeFontName(fontName)) ?? bitmapFonts.get(DEFAULT_FONT_NAME)!;
}

function getFontNameFromPath(path: string) {
  const fileName = path.split(/[\\/]/).at(-1) ?? path;
  return normalizeFontName(fileName.replace(/\.[^.]+$/, ''));
}

function normalizeFontName(fontName: string | undefined) {
  return (fontName || DEFAULT_FONT_NAME).trim().toLowerCase() || DEFAULT_FONT_NAME;
}

function parseBitmapFont(source: string): BitmapFont {
  const glyphs = new Map<number, BitmapGlyph>();
  let lineHeight = 9;

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('common ')) {
      lineHeight = Number(getAttributes(line).lineHeight ?? lineHeight);
    }

    if (line.startsWith('char ')) {
      const attributes = getAttributes(line);
      const glyph = {
        id: Number(attributes.id),
        x: Number(attributes.x),
        y: Number(attributes.y),
        width: Number(attributes.width),
        height: Number(attributes.height),
        xoffset: Number(attributes.xoffset),
        yoffset: Number(attributes.yoffset),
        xadvance: Number(attributes.xadvance)
      };

      glyphs.set(glyph.id, glyph);
    }
  }

  const fallback = glyphs.get('?'.codePointAt(0) ?? 0) ?? glyphs.values().next().value;

  if (!fallback) {
    throw new Error('Bitmap font has no glyphs.');
  }

  return {
    lineHeight,
    glyphs,
    fallback
  };
}

function getAttributes(line: string) {
  const attributes: Record<string, string> = {};
  const pattern = /(\w+)=("[^"]*"|\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line))) {
    attributes[match[1]] = match[2].replace(/^"|"$/g, '');
  }

  return attributes;
}
