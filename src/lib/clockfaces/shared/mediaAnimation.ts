import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ClockfaceContext, ClockfaceFileInputValue, ClockfacePixel } from '$lib/Clockface';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export const DEFAULT_GIF_FRAME_DELAY_MS = 100;
export const MIN_GIF_FRAME_DELAY_MS = 50;
export const DEFAULT_GIF_PLAYBACK_SPEED = 1;
export const MIN_GIF_PLAYBACK_SPEED = 0.1;
export const MAX_GIF_PLAYBACK_SPEED = 8;
export const DEFAULT_VIDEO_FRAME_RATE = 12;
export const MIN_VIDEO_FRAME_RATE = 1;
export const MAX_VIDEO_FRAME_RATE = 24;

export type MediaFrame = {
  pixels: ClockfacePixel[];
  delay: number;
};

export type MediaAnimation = {
  frames: MediaFrame[];
  totalDuration: number;
  startedAt: number;
  reset(): void;
  getFrame(index: number): MediaFrame;
  getCurrentFrame(speed?: string | number): MediaFrame;
};

export type GifFrame = MediaFrame;
export type GifAnimation = MediaAnimation;

export type DecodeGifOptions = {
  resolution?: number;
  maxFrames?: number;
};

export type DecodeMediaOptions = DecodeGifOptions & {
  videoFrameRate?: number;
};

export async function decodeMediaFile(
  file: ClockfaceFileInputValue,
  options: DecodeMediaOptions = {}
) {
  if (isGifFile(file)) {
    return decodeGifFile(file, options);
  }

  return decodeVideoFile(file, options);
}

export async function decodeGifFile(file: ClockfaceFileInputValue, options: DecodeGifOptions = {}) {
  const resolution = options.resolution ?? 64;
  const parsed = parseGIF(toArrayBuffer(file.bytes));
  const decodedFrames = decompressFrames(parsed, true);
  const sourceFrames =
    options.maxFrames === undefined ? decodedFrames : decodedFrames.slice(0, options.maxFrames);

  if (sourceFrames.length === 0) {
    throw new Error('В GIF не найдено кадров.');
  }

  const canvas = new Uint8ClampedArray(parsed.lsd.width * parsed.lsd.height * 4);
  const frames: MediaFrame[] = [];

  for (const frame of sourceFrames) {
    const restoreCanvas = frame.disposalType === 3 ? canvas.slice() : undefined;
    applyPatch(canvas, parsed.lsd.width, parsed.lsd.height, frame);
    frames.push({
      pixels: await resizeToResolution(canvas, parsed.lsd.width, parsed.lsd.height, resolution),
      delay: normalizeGifFrameDelay(frame.delay)
    });
    applyDisposal(canvas, parsed.lsd.width, parsed.lsd.height, frame, restoreCanvas);
  }

  return frames;
}

export async function decodeVideoFile(
  file: ClockfaceFileInputValue,
  options: DecodeMediaOptions = {}
) {
  const resolution = options.resolution ?? 64;
  const frameRate = normalizeVideoFrameRate(options.videoFrameRate);
  const frameDelay = Math.round(1000 / frameRate);
  const directory = await mkdtemp(join(tmpdir(), 'pixoopal-video-'));
  const inputPath = join(directory, `input${getFileExtension(file)}`);

  try {
    await writeFile(inputPath, Buffer.from(file.bytes));

    const { stdout } = await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-vf',
        `fps=${frameRate},scale=${resolution}:${resolution}:force_original_aspect_ratio=increase,crop=${resolution}:${resolution}`,
        '-an',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1'
      ],
      {
        encoding: 'buffer',
        maxBuffer: 512 * 1024 * 1024
      }
    );

    const frameSize = resolution * resolution * 3;
    const frames: MediaFrame[] = [];
    const frameCount = Math.floor(stdout.length / frameSize);
    const limitedFrameCount =
      options.maxFrames === undefined ? frameCount : Math.min(frameCount, options.maxFrames);

    for (let frameIndex = 0; frameIndex < limitedFrameCount; frameIndex += 1) {
      const offset = frameIndex * frameSize;
      const pixels: ClockfacePixel[] = [];

      for (let index = 0; index < frameSize; index += 3) {
        pixels.push([
          stdout[offset + index] ?? 0,
          stdout[offset + index + 1] ?? 0,
          stdout[offset + index + 2] ?? 0
        ]);
      }

      frames.push({
        pixels,
        delay: frameDelay
      });
    }

    if (frames.length === 0) {
      throw new Error('В видео не найдено кадров.');
    }

    return frames;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function createMediaAnimation(frames: MediaFrame[]): MediaAnimation {
  const animation = {
    frames,
    totalDuration: getTotalDuration(frames),
    startedAt: Date.now(),
    reset() {
      animation.startedAt = Date.now();
    },
    getFrame(index: number) {
      if (animation.frames.length === 0) {
        throw new Error('GIF animation has no frames.');
      }

      const normalizedIndex = Math.max(0, Math.min(animation.frames.length - 1, Math.round(index)));
      return animation.frames[normalizedIndex];
    },
    getCurrentFrame(speed = DEFAULT_GIF_PLAYBACK_SPEED) {
      if (animation.frames.length === 0) {
        throw new Error('GIF animation has no frames.');
      }

      const elapsed =
        ((Date.now() - animation.startedAt) * normalizeGifPlaybackSpeed(speed)) %
        animation.totalDuration;
      let cursor = 0;

      for (const frame of animation.frames) {
        cursor += frame.delay;

        if (elapsed < cursor) {
          return frame;
        }
      }

      return animation.frames[animation.frames.length - 1];
    }
  };

  return animation;
}

export function drawMediaFrame(context: ClockfaceContext, frame: MediaFrame) {
  for (let index = 0; index < context.buffer.length; index += 1) {
    context.buffer[index] = [...(frame.pixels[index] ?? [0, 0, 0])];
  }
}

export const createGifAnimation = createMediaAnimation;

export function drawMediaAnimationFrame(
  context: ClockfaceContext,
  animation: MediaAnimation,
  speed: string | number | undefined = DEFAULT_GIF_PLAYBACK_SPEED
) {
  drawMediaFrame(context, animation.getCurrentFrame(speed));
}

export const drawGifFrame = drawMediaFrame;
export const drawGifAnimationFrame = drawMediaAnimationFrame;

export function normalizeGifPlaybackSpeed(value: string | number | undefined) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');

  if (!Number.isFinite(parsed)) {
    return DEFAULT_GIF_PLAYBACK_SPEED;
  }

  return Math.max(MIN_GIF_PLAYBACK_SPEED, Math.min(MAX_GIF_PLAYBACK_SPEED, parsed));
}

export function isGifFileInput(value: unknown): value is ClockfaceFileInputValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bytes' in value &&
    value.bytes instanceof Uint8Array
  );
}

export function isMediaFileInput(value: unknown): value is ClockfaceFileInputValue {
  return isGifFileInput(value);
}

function applyPatch(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  frame: ParsedFrame
) {
  const { left, top, width, height } = frame.dims;

  for (let y = 0; y < height; y += 1) {
    const targetY = top + y;

    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const targetX = left + x;

      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }

      const sourceIndex = (x + y * width) * 4;
      const alpha = frame.patch[sourceIndex + 3] ?? 0;

      if (alpha === 0) {
        continue;
      }

      const targetIndex = (targetX + targetY * canvasWidth) * 4;
      canvas[targetIndex] = frame.patch[sourceIndex] ?? 0;
      canvas[targetIndex + 1] = frame.patch[sourceIndex + 1] ?? 0;
      canvas[targetIndex + 2] = frame.patch[sourceIndex + 2] ?? 0;
      canvas[targetIndex + 3] = alpha;
    }
  }
}

function applyDisposal(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  frame: ParsedFrame,
  restoreCanvas: Uint8ClampedArray | undefined
) {
  if (frame.disposalType === 3 && restoreCanvas) {
    canvas.set(restoreCanvas);
    return;
  }

  if (frame.disposalType !== 2) {
    return;
  }

  const { left, top, width, height } = frame.dims;

  for (let y = 0; y < height; y += 1) {
    const targetY = top + y;

    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const targetX = left + x;

      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }

      const index = (targetX + targetY * canvasWidth) * 4;
      canvas.fill(0, index, index + 4);
    }
  }
}

async function resizeToResolution(
  canvas: Uint8ClampedArray,
  width: number,
  height: number,
  resolution: number
) {
  const resized = await sharp(Buffer.from(canvas), {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .resize(resolution, resolution, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: 'nearest'
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixels: ClockfacePixel[] = [];

  for (let index = 0; index < resolution * resolution * 3; index += 3) {
    pixels.push([resized[index] ?? 0, resized[index + 1] ?? 0, resized[index + 2] ?? 0]);
  }

  return pixels;
}

function normalizeGifFrameDelay(delay: number) {
  if (!Number.isFinite(delay) || delay <= 0) {
    return DEFAULT_GIF_FRAME_DELAY_MS;
  }

  return Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(delay));
}

function getTotalDuration(frames: GifFrame[]) {
  return frames.reduce((sum, frame) => sum + frame.delay, 0) || DEFAULT_GIF_FRAME_DELAY_MS;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isGifFile(file: ClockfaceFileInputValue) {
  return file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
}

function getFileExtension(file: ClockfaceFileInputValue) {
  const extension = extname(file.name).toLowerCase();
  return /^[a-z0-9.]+$/i.test(extension) && extension ? extension : '.bin';
}

function normalizeVideoFrameRate(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_VIDEO_FRAME_RATE;
  }

  return Math.max(MIN_VIDEO_FRAME_RATE, Math.min(MAX_VIDEO_FRAME_RATE, Math.round(value ?? DEFAULT_VIDEO_FRAME_RATE)));
}
