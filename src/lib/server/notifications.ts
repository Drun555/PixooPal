import {
  drawBitmapText,
  getBitmapTextRenderHeight,
  measureBitmapText,
  type BitmapTextColor
} from '@pixoopal/clockface/bitmap-text';

const SCREEN_SIZE = 64;
const POPUP_HEIGHT = 21;
const POPUP_MARGIN = 2;
const POPUP_LEFT = 2;
const POPUP_RIGHT_INSET = 2;
const TEXT_INSET = 3;
const SLIDE_MS = 1100;
const HOLD_MS = 20_000;
const SCROLL_SPEED = 18;
const NOTIFICATION_FRAME_MS = 100;
const NOTIFICATION_CLEANUP_MS = NOTIFICATION_FRAME_MS * 2;
const TEXT_COLOR: BitmapTextColor = [248, 255, 255];

type NotificationState = {
  text: string;
  startedAt: number;
  durationMs: number;
};

let activeNotification: NotificationState | undefined;

export { NOTIFICATION_FRAME_MS };

export function startNotification(text: string) {
  const safeText = normalizeText(text);
  const scrollDistance = Math.max(0, measureBitmapText(safeText) - getAvailableTextWidth());
  const scrollMs = scrollDistance > 0 ? Math.ceil((scrollDistance / SCROLL_SPEED) * 1000) * 2 : 0;

  activeNotification = {
    text: safeText,
    startedAt: Date.now(),
    durationMs: SLIDE_MS * 2 + HOLD_MS + scrollMs
  };
}

export function isNotificationActive() {
  return getNotificationState(Date.now()) !== 'idle';
}

export async function applyNotificationOverlay(size: number, source: number[]) {
  const now = Date.now();
  const progress = getNotificationProgress(now);

  if (!progress) {
    clearExpiredNotification(now);
    return source;
  }

  const output = source.slice();
  const textWidth = measureBitmapText(progress.text);
  const popupY = getPopupY(progress.elapsedMs, progress.durationMs);
  const textX = getTextX(textWidth, progress.elapsedMs, progress.durationMs);

  drawPopup(output, size, popupY);
  await drawNotificationText(output, size, progress.text, textX, popupY);

  return output;
}

function getNotificationProgress(now: number) {
  if (!activeNotification) {
    return undefined;
  }

  const elapsedMs = now - activeNotification.startedAt;

  if (elapsedMs >= activeNotification.durationMs) {
    return undefined;
  }

  return {
    ...activeNotification,
    elapsedMs
  };
}

function getNotificationState(now: number) {
  if (!activeNotification) {
    return 'idle';
  }

  const elapsedMs = now - activeNotification.startedAt;

  if (elapsedMs < activeNotification.durationMs) {
    return 'visible';
  }

  if (elapsedMs < activeNotification.durationMs + NOTIFICATION_CLEANUP_MS) {
    return 'cleanup';
  }

  activeNotification = undefined;
  return 'idle';
}

function clearExpiredNotification(now: number) {
  if (getNotificationState(now) === 'idle') {
    activeNotification = undefined;
  }
}

function getPopupY(elapsedMs: number, durationMs: number) {
  if (elapsedMs < SLIDE_MS) {
    return Math.round(easeOut(elapsedMs / SLIDE_MS) * (POPUP_HEIGHT + POPUP_MARGIN) - POPUP_HEIGHT);
  }

  if (elapsedMs > durationMs - SLIDE_MS) {
    const progress = (elapsedMs - (durationMs - SLIDE_MS)) / SLIDE_MS;
    return Math.round(POPUP_MARGIN - easeIn(progress) * (POPUP_HEIGHT + POPUP_MARGIN));
  }

  return POPUP_MARGIN;
}

function getTextX(textWidth: number, elapsedMs: number, durationMs: number) {
  const left = getTextClipLeft();
  const availableWidth = getAvailableTextWidth();

  if (textWidth <= availableWidth) {
    return left + Math.floor((availableWidth - textWidth) / 2);
  }

  const scrollStart = SLIDE_MS + 360;
  const scrollEnd = durationMs - SLIDE_MS - 360;
  const scrollDuration = Math.max(1, scrollEnd - scrollStart);
  const progress = Math.max(0, Math.min(1, (elapsedMs - scrollStart) / scrollDuration));
  const pingPong = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
  const distance = textWidth - availableWidth;

  return left - Math.round(distance * pingPong);
}

function drawPopup(buffer: number[], size: number, top: number) {
  const left = POPUP_LEFT;
  const right = size - POPUP_RIGHT_INSET - 1;
  const bottom = top + POPUP_HEIGHT - 1;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        continue;
      }

      const edge = y === top || y === bottom || x === left || x === right;
      const alpha = edge ? 0.68 : 0.86;
      blendFlatPixel(buffer, size, x, y, edge ? [85, 224, 204] : [11, 18, 29], alpha);
    }
  }
}

async function drawNotificationText(
  buffer: number[],
  size: number,
  text: string,
  startX: number,
  popupY: number
) {
  const textHeight = getBitmapTextRenderHeight(text);

  await drawBitmapText({
    buffer,
    size,
    text,
    x: startX,
    y: popupY + Math.ceil((POPUP_HEIGHT - textHeight) / 2),
    color: TEXT_COLOR,
    clip: {
      left: getTextClipLeft(),
      right: getTextClipRight(size),
      top: popupY + 2,
      bottom: popupY + POPUP_HEIGHT - 3
    }
  });
}

function getTextClipLeft() {
  return POPUP_LEFT + TEXT_INSET;
}

function getTextClipRight(size = SCREEN_SIZE) {
  return size - POPUP_RIGHT_INSET - TEXT_INSET - 1;
}

function getAvailableTextWidth() {
  return getTextClipRight() - getTextClipLeft() + 1;
}

function blendFlatPixel(
  buffer: number[],
  size: number,
  x: number,
  y: number,
  color: [number, number, number],
  alpha: number
) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const index = (x + y * size) * 3;
  buffer[index] = mixChannel(buffer[index], color[0], alpha);
  buffer[index + 1] = mixChannel(buffer[index + 1], color[1], alpha);
  buffer[index + 2] = mixChannel(buffer[index + 2], color[2], alpha);
}

function mixChannel(current: number, next: number, alpha: number) {
  return Math.round(current + (next - current) * Math.max(0, Math.min(1, alpha)));
}

function normalizeText(text: string) {
  const trimmed = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return trimmed || 'PixooPal';
}

function easeOut(value: number) {
  return 1 - (1 - value) ** 3;
}

function easeIn(value: number) {
  return value ** 3;
}
