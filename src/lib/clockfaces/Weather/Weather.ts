import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawBitmapText, getBitmapTextRenderHeight, measureBitmapText } from '$lib/server/bitmapText';
import {
  createMediaAnimation,
  decodeGifFile,
  drawMediaFrame,
  type MediaAnimation
} from '../shared/mediaAnimation';

const RESOLUTION = 64;
const UPDATE_INTERVAL_MS = 180;
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
const WEATHER_GIF_MAX_FRAMES = 72;
const DEFAULT_DATA = {
  latitude: '51.5331',
  longitude: '46.0342',
  forceWeather: 'auto'
};

const FORCE_WEATHER_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'sunny', label: 'Sunny' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rainy', label: 'Rainy' },
  { value: 'snowy', label: 'Snowy' },
  { value: 'foggy', label: 'Foggy' },
  { value: 'stormy', label: 'Stormy' },
  { value: 'night', label: 'Night' }
] as const;

type ForceWeather = (typeof FORCE_WEATHER_OPTIONS)[number]['value'];
type WeatherAnimationKey = 'clear' | 'rain' | 'snow' | 'storm';

type WeatherSnapshot = {
  temperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  isDay: boolean;
  fetchedAt: number;
};

let weather: WeatherSnapshot | undefined;
let weatherError = '';
let weatherFetch: Promise<void> | undefined;
let frame = 0;
const weatherAnimations = new Map<WeatherAnimationKey, Promise<MediaAnimation>>();

export default new Clockface({
  resolution: RESOLUTION,
  data: { ...DEFAULT_DATA },
  inputs: [
    {
      type: 'input-num',
      id: 'latitude',
      friendlyName: 'Latitude',
      isSetting: true,
      onSubmit: (value, context) => {
        context.data.latitude = normalizeCoordinate(String(value), -90, 90, DEFAULT_DATA.latitude);
        weather = undefined;
      }
    },
    {
      type: 'input-num',
      id: 'longitude',
      friendlyName: 'Longitude',
      isSetting: true,
      onSubmit: (value, context) => {
        context.data.longitude = normalizeCoordinate(String(value), -180, 180, DEFAULT_DATA.longitude);
        weather = undefined;
      }
    },
    {
      type: 'select',
      id: 'forceWeather',
      friendlyName: 'Force weather',
      options: [...FORCE_WEATHER_OPTIONS],
      isSetting: true,
      onSubmit: (value, context) => {
        context.data.forceWeather = normalizeForceWeather(String(value));
      }
    }
  ],
  updateIntervalMs: UPDATE_INTERVAL_MS,
  init: renderWeather,
  main: renderWeather
});

async function renderWeather(context: ClockfaceContext) {
  await refreshWeatherIfNeeded(context);
  await drawWeather(context);
}

async function refreshWeatherIfNeeded(context: ClockfaceContext) {
  if (normalizeForceWeather(context.data.forceWeather) !== 'auto') {
    return;
  }

  if (weather && Date.now() - weather.fetchedAt < WEATHER_REFRESH_MS) {
    return;
  }

  if (!weatherFetch) {
    weatherFetch = fetchWeather(context).finally(() => {
      weatherFetch = undefined;
    });
  }

  await weatherFetch;
}

async function fetchWeather(context: ClockfaceContext) {
  const latitude = normalizeCoordinate(context.data.latitude, -90, 90, DEFAULT_DATA.latitude);
  const longitude = normalizeCoordinate(context.data.longitude, -180, 180, DEFAULT_DATA.longitude);
  context.data.latitude = latitude;
  context.data.longitude = longitude;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m'
  );
  url.searchParams.set('timezone', 'auto');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        is_day?: number;
        wind_speed_10m?: number;
      };
    };

    if (!response.ok || !body.current) {
      throw new Error('Open-Meteo response did not contain current weather.');
    }

    weather = {
      temperature: Number(body.current.temperature_2m ?? 0),
      humidity: Number(body.current.relative_humidity_2m ?? 0),
      windSpeed: Number(body.current.wind_speed_10m ?? 0),
      weatherCode: Number(body.current.weather_code ?? 0),
      isDay: Number(body.current.is_day ?? 1) === 1,
      fetchedAt: Date.now()
    };
    weatherError = '';
  } catch (error) {
    weatherError = 'no data';
  }
}

async function drawWeather(context: ClockfaceContext) {
  frame += 1;
  const snapshot = getDisplaySnapshot(context, weather);
  const theme = getTheme(snapshot);
  const phase = frame * 0.12;
  const hasAnimation = await drawWeatherAnimation(context, snapshot);

  if (!hasAnimation) {
    drawSky(context, theme, phase);
    drawAmbient(context, snapshot, phase);
  }

  if (!snapshot) {
    await drawContrastedBitmapText(context, weatherError || 'loading', 5, 48, [255, 255, 255]);
    return;
  }

  if (!hasAnimation) {
    drawConditionIcon(context, snapshot.weatherCode, snapshot.isDay, phase);
  }

  await drawTemperature(context, snapshot.temperature);
  await drawMeta(context, snapshot);
}

async function drawWeatherAnimation(context: ClockfaceContext, snapshot: WeatherSnapshot | undefined) {
  try {
    const animation = await getWeatherAnimation(getWeatherAnimationKey(snapshot));
    drawMediaFrame(context, animation.getCurrentFrame());
    return true;
  } catch {
    return false;
  }
}

function getWeatherAnimationKey(snapshot: WeatherSnapshot | undefined): WeatherAnimationKey {
  if (!snapshot) {
    return 'clear';
  }

  if (isThunder(snapshot.weatherCode)) {
    return 'storm';
  }

  if (isSnow(snapshot.weatherCode)) {
    return 'snow';
  }

  if (isRain(snapshot.weatherCode)) {
    return 'rain';
  }

  return 'clear';
}

async function getWeatherAnimation(key: WeatherAnimationKey) {
  let animation = weatherAnimations.get(key);

  if (!animation) {
    animation = loadWeatherAnimation(key).catch((error) => {
      weatherAnimations.delete(key);
      throw error;
    });
    weatherAnimations.set(key, animation);
  }

  return animation;
}

async function loadWeatherAnimation(key: WeatherAnimationKey) {
  const fileName = `${key}.gif`;
  const bytes = await readFile(join(process.cwd(), 'src', 'lib', 'clockfaces', 'Weather', fileName));
  const frames = await decodeGifFile(
    {
      name: fileName,
      type: 'image/gif',
      size: bytes.byteLength,
      bytes: new Uint8Array(bytes)
    },
    {
      resolution: RESOLUTION,
      maxFrames: WEATHER_GIF_MAX_FRAMES
    }
  );

  return createMediaAnimation(frames);
}

function getDisplaySnapshot(context: ClockfaceContext, snapshot: WeatherSnapshot | undefined) {
  const forced = normalizeForceWeather(context.data.forceWeather);
  context.data.forceWeather = forced;

  if (forced === 'auto') {
    return snapshot;
  }

  return {
    temperature: snapshot?.temperature ?? getForcedTemperature(forced),
    humidity: snapshot?.humidity ?? getForcedHumidity(forced),
    windSpeed: snapshot?.windSpeed ?? 0,
    weatherCode: getForcedWeatherCode(forced),
    isDay: forced !== 'night',
    fetchedAt: snapshot?.fetchedAt ?? Date.now()
  };
}

function drawSky(
  context: ClockfaceContext,
  theme: { top: ClockfacePixel; bottom: ClockfacePixel },
  phase: number
) {
  for (let y = 0; y < context.resolution; y += 1) {
    const amount = y / (context.resolution - 1);
    const glow = (Math.sin(phase + y * 0.16) + 1) * 0.035;
    const color = brightenPixel(mixPixel(theme.top, theme.bottom, amount), glow);

    for (let x = 0; x < context.resolution; x += 1) {
      setPixel(context, x, y, color);
    }
  }
}

function drawAmbient(context: ClockfaceContext, snapshot: WeatherSnapshot | undefined, phase: number) {
  if (!snapshot || snapshot.isDay) {
    return;
  }

  const stars = [
    [8, 7, 0.1],
    [18, 12, 1.7],
    [36, 8, 2.8],
    [50, 15, 0.8],
    [55, 29, 2.2],
    [7, 33, 3.1]
  ];

  for (const [x, y, offset] of stars) {
    const opacity = 0.34 + (Math.sin(phase * 1.3 + offset) + 1) * 0.28;
    blendPixel(context, x, y, [225, 238, 255], opacity);
  }
}

function drawConditionIcon(context: ClockfaceContext, code: number, isDay: boolean, phase: number) {
  if (isThunder(code)) {
    drawStormScene(context, phase);
    return;
  }

  if (isRain(code)) {
    drawRainScene(context, phase);
    return;
  }

  if (isSnow(code)) {
    drawCloud(context, 10 + Math.sin(phase * 0.38) * 1.2, 12, [222, 234, 244], [158, 178, 198]);
    drawSnow(context, 12, 30, phase);
    return;
  }

  if (isFog(code)) {
    drawFogScene(context, phase);
    return;
  }

  if (isCloudy(code)) {
    drawCloud(context, 7 + Math.sin(phase * 0.3) * 1.5, 13, [215, 229, 239], [142, 164, 184]);
    drawCloud(context, 20 + Math.sin(phase * 0.24 + 1.4) * 1.8, 18, [168, 190, 208], [91, 118, 145]);
    return;
  }

  if (isDay) {
    drawSunnyScene(context, phase);
  } else {
    drawMoon(context, 20, 20, phase);
  }
}

async function drawTemperature(context: ClockfaceContext, temperature: number) {
  const text = `${Math.round(temperature)}c`;
  await drawContrastedBitmapText(context, text, 5, 38, [255, 255, 250], 2);
}

async function drawMeta(context: ClockfaceContext, snapshot: WeatherSnapshot) {
  const label = getWeatherLabel(snapshot.weatherCode);
  const meta = `${label} ${Math.round(snapshot.humidity)}%`;
  await drawContrastedBitmapText(context, meta, 5, 55, [230, 246, 255]);
}

async function drawContrastedBitmapText(
  context: ClockfaceContext,
  text: string,
  x: number,
  y: number,
  color: ClockfacePixel,
  scale = 1
) {
  const mask = await rasterBitmapText(text);
  const shadow: ClockfacePixel = [4, 5, 8];

  for (const [offsetX, offsetY] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [1, 1]
  ]) {
    drawTextMask(context, mask, x + offsetX, y + offsetY, shadow, scale);
  }

  drawTextMask(context, mask, x, y, color, scale);
}

async function rasterBitmapText(text: string) {
  const width = Math.min(RESOLUTION, measureBitmapText(text));
  const height = Math.min(RESOLUTION, getBitmapTextRenderHeight(text));
  const buffer = new Array(RESOLUTION * RESOLUTION * 3).fill(0);

  await drawBitmapText({
    buffer,
    size: RESOLUTION,
    text,
    x: 0,
    y: 0,
    color: [255, 255, 255]
  });

  return {
    buffer,
    width,
    height
  };
}

function drawTextMask(
  context: ClockfaceContext,
  mask: { buffer: number[]; width: number; height: number },
  x: number,
  y: number,
  color: ClockfacePixel,
  scale: number
) {
  for (let sourceY = 0; sourceY < mask.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < mask.width; sourceX += 1) {
      const sourceIndex = (sourceX + sourceY * RESOLUTION) * 3;

      if ((mask.buffer[sourceIndex] ?? 0) < 128) {
        continue;
      }

      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          setPixel(
            context,
            x + sourceX * scale + offsetX,
            y + sourceY * scale + offsetY,
            color
          );
        }
      }
    }
  }
}

function drawSun(context: ClockfaceContext, centerX: number, centerY: number, radius: number, phase: number) {
  drawSoftCircle(context, centerX, centerY, radius + 4, [255, 181, 60], 0.2);
  drawSoftCircle(context, centerX, centerY, radius, [255, 222, 86], 0.95);
  drawSoftCircle(context, centerX - 3, centerY - 3, 4, [255, 246, 168], 0.6);

  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (Math.PI * 2 * ray) / 8 + phase * 0.12;
    const start = radius + 2;
    const end = radius + 5 + Math.round((Math.sin(phase + ray) + 1) * 1.5);

    for (let length = start; length <= end; length += 1) {
      blendPixel(
        context,
        Math.round(centerX + Math.cos(angle) * length),
        Math.round(centerY + Math.sin(angle) * length),
        [255, 235, 130],
        0.62
      );
    }
  }
}

function drawSunnyScene(context: ClockfaceContext, phase: number) {
  const sunX = 16 + Math.sin(phase * 0.18) * 1.2;
  const sunY = 16 + Math.cos(phase * 0.13) * 0.8;

  drawRadialGlow(context, sunX, sunY, 30, [255, 222, 94], 0.48);
  drawRadialGlow(context, sunX + 5, sunY + 5, 44, [255, 171, 63], 0.16);
  drawRadialGlow(context, 52, 6, 46, [255, 244, 190], 0.1);
  drawSoftCircle(context, Math.round(sunX), Math.round(sunY), 9, [255, 240, 128], 0.92);
  drawSoftCircle(context, Math.round(sunX - 3), Math.round(sunY - 3), 5, [255, 255, 212], 0.58);

  for (let index = 0; index < 9; index += 1) {
    const cloudX = (index * 13 + frame * 0.08) % 82 - 10;
    const cloudY = 6 + (index % 3) * 7 + Math.sin(phase * 0.35 + index) * 1.6;
    drawWispyBand(context, cloudX, cloudY, 18 + (index % 2) * 7, [210, 242, 255], 0.1);
  }
}

function drawRainScene(context: ClockfaceContext, phase: number) {
  drawRadialGlow(context, 28, 6, 42, [110, 144, 176], 0.24);
  drawRadialGlow(context, 48, 48, 40, [54, 85, 111], 0.18);
  drawAtmosphericCloud(context, 9 + Math.sin(phase * 0.22) * 1.4, 7, 1.08, [
    [204, 219, 232],
    [142, 163, 184],
    [78, 102, 127]
  ]);
  drawRain(context, 4, 17, phase, 18, 0.78);
  drawMistVeil(context, phase, 0.14);
}

function drawStormScene(context: ClockfaceContext, phase: number) {
  drawRadialGlow(context, 14, 5, 40, [82, 96, 150], 0.2);
  drawRadialGlow(context, 55, 20, 34, [48, 69, 105], 0.26);
  drawAtmosphericCloud(context, 7 + Math.sin(phase * 0.18) * 1.3, 6, 1.14, [
    [168, 183, 205],
    [92, 112, 141],
    [32, 42, 66]
  ]);
  drawRain(context, 2, 17, phase, 24, 0.84);

  const flash = Math.max(0, Math.sin(phase * 1.7) - 0.76) * 2.8;
  if (flash > 0) {
    drawRadialGlow(context, 34, 21, 38, [190, 210, 255], flash * 0.22);
    drawLightning(context, 34, 19, flash);
  }
}

function drawFogScene(context: ClockfaceContext, phase: number) {
  drawRadialGlow(context, 32, 12, 42, [224, 238, 246], 0.18);
  drawAtmosphericCloud(context, 11 + Math.sin(phase * 0.15), 4, 1, [
    [213, 226, 235],
    [160, 178, 190],
    [112, 134, 148]
  ]);
  drawMistVeil(context, phase, 0.36);

  for (let row = 0; row < 7; row += 1) {
    const y = 25 + row * 4;
    const speed = row % 2 === 0 ? 0.22 : -0.18;
    const shift = Math.sin(phase * 0.35 + row) * 4 + frame * speed;
    drawWispyBand(context, -12 + (shift % 18), y, 42, [220, 236, 244], 0.28 - row * 0.018);
    drawWispyBand(context, 24 + ((shift + row * 5) % 22), y + 1, 32, [236, 246, 250], 0.18);
  }
}

function drawMoon(context: ClockfaceContext, centerX: number, centerY: number, phase: number) {
  drawSoftCircle(context, centerX, centerY, 10, [206, 220, 255], 0.64);
  drawSoftCircle(context, centerX + 5, centerY - 2, 10, [14, 16, 42], 0.9);

  for (let index = 0; index < 4; index += 1) {
    const y = centerY + 13 + index * 4;
    const x = 10 + ((frame * 0.18 + index * 13) % 44);
    blendPixel(context, Math.round(x), y, [100, 125, 180], 0.2 + Math.sin(phase + index) * 0.06);
  }
}

function drawCloud(
  context: ClockfaceContext,
  x: number,
  y: number,
  color: ClockfacePixel,
  shade: ClockfacePixel
) {
  const baseX = Math.round(x);
  const baseY = Math.round(y);

  drawSoftCircle(context, baseX + 10, baseY + 10, 7, shade, 0.22);
  drawSoftCircle(context, baseX + 19, baseY + 8, 10, shade, 0.2);
  drawSoftCircle(context, baseX + 29, baseY + 11, 7, shade, 0.2);
  drawRoundedBlob(context, baseX + 8, baseY + 13, 27, 6, shade, 0.26);

  drawSoftCircle(context, baseX + 9, baseY + 8, 7, color, 0.86);
  drawSoftCircle(context, baseX + 18, baseY + 5, 9, color, 0.9);
  drawSoftCircle(context, baseX + 28, baseY + 9, 7, color, 0.84);
  drawRoundedBlob(context, baseX + 6, baseY + 10, 30, 8, color, 0.82);
  drawRoundedBlob(context, baseX + 9, baseY + 15, 24, 3, mixPixel(color, shade, 0.34), 0.38);

  drawSoftCircle(context, baseX + 15, baseY + 4, 3, [246, 252, 255], 0.38);
  drawSoftCircle(context, baseX + 25, baseY + 7, 3, [246, 252, 255], 0.22);
}

function drawAtmosphericCloud(
  context: ClockfaceContext,
  x: number,
  y: number,
  scale: number,
  palette: [ClockfacePixel, ClockfacePixel, ClockfacePixel]
) {
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const [light, mid, dark] = palette;

  drawRadialGlow(context, baseX + 22, baseY + 11, 28 * scale, light, 0.2);
  drawSoftCircle(context, baseX + Math.round(12 * scale), baseY + Math.round(14 * scale), Math.round(10 * scale), dark, 0.2);
  drawSoftCircle(context, baseX + Math.round(25 * scale), baseY + Math.round(9 * scale), Math.round(13 * scale), dark, 0.22);
  drawSoftCircle(context, baseX + Math.round(39 * scale), baseY + Math.round(15 * scale), Math.round(10 * scale), dark, 0.18);
  drawRoundedBlob(context, baseX + Math.round(7 * scale), baseY + Math.round(17 * scale), Math.round(39 * scale), Math.round(9 * scale), dark, 0.2);

  drawSoftCircle(context, baseX + Math.round(11 * scale), baseY + Math.round(12 * scale), Math.round(9 * scale), mid, 0.68);
  drawSoftCircle(context, baseX + Math.round(24 * scale), baseY + Math.round(7 * scale), Math.round(12 * scale), mid, 0.72);
  drawSoftCircle(context, baseX + Math.round(38 * scale), baseY + Math.round(13 * scale), Math.round(9 * scale), mid, 0.66);
  drawRoundedBlob(context, baseX + Math.round(6 * scale), baseY + Math.round(15 * scale), Math.round(42 * scale), Math.round(9 * scale), mid, 0.7);

  drawSoftCircle(context, baseX + Math.round(16 * scale), baseY + Math.round(8 * scale), Math.round(5 * scale), light, 0.34);
  drawSoftCircle(context, baseX + Math.round(31 * scale), baseY + Math.round(10 * scale), Math.round(4 * scale), light, 0.22);
  drawWispyBand(context, baseX + 9, baseY + Math.round(21 * scale), Math.round(34 * scale), mixPixel(mid, dark, 0.22), 0.32);
}

function drawRain(
  context: ClockfaceContext,
  x: number,
  y: number,
  phase: number,
  count = 12,
  opacity = 0.72
) {
  for (let index = 0; index < count; index += 1) {
    const dropX = x + index * 4 + Math.sin(phase * 0.5 + index) * 1.4;
    const dropY = y + ((frame * 2.1 + index * 9) % 44);
    const length = index % 3 === 0 ? 7 : 5;

    for (let offset = 0; offset < length; offset += 1) {
      blendPixel(
        context,
        Math.round(dropX + offset * 0.55),
        Math.round(dropY + offset),
        index % 4 === 0 ? [170, 232, 255] : [86, 204, 255],
        opacity * (1 - offset / (length + 2))
      );
    }
  }
}

function drawSnow(context: ClockfaceContext, x: number, y: number, phase: number) {
  for (let index = 0; index < 12; index += 1) {
    const flakeX = x + index * 4 + Math.sin(phase * 0.8 + index) * 2;
    const flakeY = y + ((frame * 0.62 + index * 6) % 28);
    const color: ClockfacePixel = index % 3 === 0 ? [255, 255, 255] : [220, 238, 255];
    drawTinySpark(context, Math.round(flakeX), Math.round(flakeY), color, index % 4 === 0);
  }
}

function drawFog(context: ClockfaceContext, phase: number) {
  drawCloud(context, 11 + Math.sin(phase * 0.2), 9, [188, 202, 214], [118, 137, 154]);

  for (let y = 34; y <= 46; y += 5) {
    for (let x = 10; x < 54; x += 1) {
      const wave = Math.sin(x * 0.24 + phase + y * 0.18);

      if (wave > -0.45) {
        blendPixel(context, x, y + Math.round(wave), [220, 231, 238], 0.48);
      }
    }
  }
}

function drawRadialGlow(
  context: ClockfaceContext,
  centerX: number,
  centerY: number,
  radius: number,
  color: ClockfacePixel,
  opacity: number
) {
  const left = Math.floor(centerX - radius);
  const right = Math.ceil(centerX + radius);
  const top = Math.floor(centerY - radius);
  const bottom = Math.ceil(centerY + radius);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

      if (distance <= radius) {
        const amount = (1 - distance / radius) ** 1.8;
        blendPixel(context, x, y, color, opacity * amount);
      }
    }
  }
}

function drawWispyBand(
  context: ClockfaceContext,
  x: number,
  y: number,
  width: number,
  color: ClockfacePixel,
  opacity: number
) {
  for (let offset = 0; offset < width; offset += 1) {
    const waveY = Math.round(y + Math.sin(offset * 0.34 + frame * 0.04) * 1.2);
    const edgeFade = Math.min(1, offset / 6, (width - offset) / 6);
    const bandOpacity = opacity * Math.max(0, edgeFade);
    blendPixel(context, Math.round(x + offset), waveY, color, bandOpacity);
    blendPixel(context, Math.round(x + offset), waveY + 1, color, bandOpacity * 0.42);
  }
}

function drawMistVeil(context: ClockfaceContext, phase: number, opacity: number) {
  for (let y = 0; y < context.resolution; y += 1) {
    const verticalFade = y / (context.resolution - 1);

    for (let x = 0; x < context.resolution; x += 1) {
      const noise =
        Math.sin(x * 0.21 + phase * 0.9) * 0.5 +
        Math.sin((x + y) * 0.13 - phase * 0.55) * 0.5;
      const amount = opacity * (0.15 + verticalFade * 0.55 + noise * 0.08);
      blendPixel(context, x, y, [208, 226, 236], Math.max(0, amount));
    }
  }
}

function drawLightning(context: ClockfaceContext, x: number, y: number, flash: number) {
  const points = [
    [x, y],
    [x - 4, y + 9],
    [x + 1, y + 9],
    [x - 5, y + 24],
    [x + 7, y + 8],
    [x + 2, y + 8],
    [x + 8, y]
  ];

  for (let index = 0; index < points.length - 1; index += 1) {
    drawLine(
      context,
      points[index][0],
      points[index][1],
      points[index + 1][0],
      points[index + 1][1],
      [255, 244, 156],
      Math.min(1, 0.42 + flash)
    );
  }
}

function drawLine(
  context: ClockfaceContext,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: ClockfacePixel,
  opacity: number
) {
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));

  for (let step = 0; step <= steps; step += 1) {
    const amount = steps === 0 ? 0 : step / steps;
    const x = Math.round(startX + (endX - startX) * amount);
    const y = Math.round(startY + (endY - startY) * amount);
    blendPixel(context, x, y, color, opacity);
    blendPixel(context, x + 1, y, color, opacity * 0.34);
  }
}

function drawSoftCircle(
  context: ClockfaceContext,
  centerX: number,
  centerY: number,
  radius: number,
  color: ClockfacePixel,
  opacity: number
) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);

      if (distance <= radius) {
        const edgeFade = 1 - Math.max(0, distance - radius * 0.68) / (radius * 0.32);
        blendPixel(context, centerX + x, centerY + y, color, opacity * Math.max(0, edgeFade));
      }
    }
  }
}

function drawRoundedBlob(
  context: ClockfaceContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: ClockfacePixel,
  opacity: number
) {
  const radius = Math.floor(height / 2);

  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      const left = offsetX < radius ? radius - offsetX : 0;
      const right = offsetX >= width - radius ? offsetX - (width - radius - 1) : 0;
      const edge = Math.max(left, right);
      const centerDistance = Math.abs(offsetY - radius);

      if (edge === 0 || edge * edge + centerDistance * centerDistance <= radius * radius) {
        const bottomFade = 1 - Math.max(0, offsetY - height * 0.68) / (height * 0.32);
        blendPixel(context, x + offsetX, y + offsetY, color, opacity * Math.max(0, bottomFade));
      }
    }
  }
}

function drawTinySpark(
  context: ClockfaceContext,
  x: number,
  y: number,
  color: ClockfacePixel,
  large: boolean
) {
  blendPixel(context, x, y, color, 0.9);

  if (!large) {
    return;
  }

  blendPixel(context, x - 1, y, color, 0.36);
  blendPixel(context, x + 1, y, color, 0.36);
  blendPixel(context, x, y - 1, color, 0.28);
  blendPixel(context, x, y + 1, color, 0.28);
}

function drawCircle(context: ClockfaceContext, centerX: number, centerY: number, radius: number, color: ClockfacePixel) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) {
        setPixel(context, centerX + x, centerY + y, color);
      }
    }
  }
}

function drawRect(context: ClockfaceContext, x: number, y: number, width: number, height: number, color: ClockfacePixel) {
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      setPixel(context, x + offsetX, y + offsetY, color);
    }
  }
}

function getTheme(snapshot?: WeatherSnapshot) {
  if (!snapshot) {
    return {
      top: [8, 12, 24] as ClockfacePixel,
      bottom: [20, 28, 46] as ClockfacePixel
    };
  }

  if (!snapshot.isDay) {
    return isRain(snapshot.weatherCode) || isCloudy(snapshot.weatherCode)
      ? { top: [10, 14, 30] as ClockfacePixel, bottom: [28, 34, 56] as ClockfacePixel }
      : { top: [8, 9, 28] as ClockfacePixel, bottom: [30, 20, 58] as ClockfacePixel };
  }

  if (isThunder(snapshot.weatherCode)) {
    return { top: [22, 29, 52] as ClockfacePixel, bottom: [62, 78, 96] as ClockfacePixel };
  }

  if (isRain(snapshot.weatherCode)) {
    return { top: [38, 56, 82] as ClockfacePixel, bottom: [80, 105, 124] as ClockfacePixel };
  }

  if (isSnow(snapshot.weatherCode)) {
    return { top: [96, 136, 176] as ClockfacePixel, bottom: [205, 223, 238] as ClockfacePixel };
  }

  if (isFog(snapshot.weatherCode)) {
    return { top: [120, 153, 174] as ClockfacePixel, bottom: [185, 204, 210] as ClockfacePixel };
  }

  if (isCloudy(snapshot.weatherCode)) {
    return { top: [82, 126, 160] as ClockfacePixel, bottom: [160, 185, 198] as ClockfacePixel };
  }

  return { top: [48, 151, 226] as ClockfacePixel, bottom: [122, 213, 236] as ClockfacePixel };
}

function getWeatherLabel(code: number) {
  if (isThunder(code)) {
    return 'storm';
  }

  if (isSnow(code)) {
    return 'snow';
  }

  if (isRain(code)) {
    return 'rain';
  }

  if (isFog(code)) {
    return 'fog';
  }

  if (isCloudy(code)) {
    return 'cloud';
  }

  return 'clear';
}

function getForcedWeatherCode(value: ForceWeather) {
  if (value === 'cloudy') {
    return 3;
  }

  if (value === 'rainy') {
    return 61;
  }

  if (value === 'snowy') {
    return 71;
  }

  if (value === 'foggy') {
    return 45;
  }

  if (value === 'stormy') {
    return 95;
  }

  return 0;
}

function getForcedTemperature(value: ForceWeather) {
  if (value === 'snowy') {
    return -3;
  }

  if (value === 'night') {
    return 12;
  }

  if (value === 'rainy' || value === 'foggy') {
    return 14;
  }

  return 23;
}

function getForcedHumidity(value: ForceWeather) {
  if (value === 'rainy' || value === 'foggy' || value === 'stormy') {
    return 86;
  }

  if (value === 'snowy') {
    return 76;
  }

  return 42;
}

function isCloudy(code: number) {
  return [1, 2, 3].includes(code);
}

function isFog(code: number) {
  return [45, 48].includes(code);
}

function isRain(code: number) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || isThunder(code);
}

function isSnow(code: number) {
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

function isThunder(code: number) {
  return code >= 95 && code <= 99;
}

function normalizeCoordinate(value: string | undefined, min: number, max: number, fallback: string) {
  const parsed = Number.parseFloat(value ?? '');

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return String(Math.max(min, Math.min(max, parsed)));
}

function normalizeForceWeather(value: string | undefined): ForceWeather {
  return FORCE_WEATHER_OPTIONS.some((option) => option.value === value)
    ? (value as ForceWeather)
    : 'auto';
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
  if (x < 0 || y < 0 || x >= context.resolution || y >= context.resolution) {
    return;
  }

  context.buffer[x + y * context.resolution] = [...color];
}

function brightenPixel(pixel: ClockfacePixel, amount: number): ClockfacePixel {
  return mixPixel(pixel, [255, 255, 255], amount);
}

function mixPixel(start: ClockfacePixel, end: ClockfacePixel, amount: number): ClockfacePixel {
  const clamped = Math.max(0, Math.min(1, amount));

  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped)
  ];
}
