import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 64;
const UPDATE_INTERVAL_MS = 1;
const FOV = Math.PI / 3;
const MOVE_STEP = 0.22;
const STRAFE_STEP = 0.18;
const TURN_STEP = 0.2;
const MAX_RAY_STEPS = 48;

const DEFAULT_DATA = {
  health: '100',
  ammo: '20',
  kills: '0'
};

const MAP = [
  '1111111111111111',
  '1000000000000001',
  '1011110111101101',
  '1000010000100001',
  '1111011100101111',
  '1001000000100001',
  '1001011111101101',
  '1001000000000101',
  '1001110111110101',
  '1000000100000001',
  '1011110101111101',
  '1000000001000001',
  '1011111111011101',
  '1000000000000001',
  '1000111111100001',
  '1111111111111111'
];

const WALL_COLORS: Record<string, ClockfacePixel> = {
  '1': [118, 116, 108],
  '2': [132, 32, 24],
  '3': [54, 116, 128]
};

const SKY_TOP: ClockfacePixel = [19, 18, 29];
const SKY_BOTTOM: ClockfacePixel = [74, 48, 45];
const FLOOR_TOP: ClockfacePixel = [46, 42, 36];
const FLOOR_BOTTOM: ClockfacePixel = [18, 17, 16];
const HUD_BG: ClockfacePixel = [18, 18, 20];
const HUD_LINE: ClockfacePixel = [124, 105, 82];
const HEALTH_COLOR: ClockfacePixel = [224, 45, 41];
const AMMO_COLOR: ClockfacePixel = [236, 180, 52];
const WEAPON_DARK: ClockfacePixel = [43, 45, 50];
const WEAPON_LIGHT: ClockfacePixel = [122, 128, 135];
const MUZZLE: ClockfacePixel = [255, 218, 84];
const DEMON: ClockfacePixel = [168, 47, 36];
const DEMON_DARK: ClockfacePixel = [76, 20, 18];
const DEMON_EYE: ClockfacePixel = [255, 232, 116];
const DEMON_HIT: ClockfacePixel = [255, 220, 190];

const DIGITS = [
  ['111', '101', '101', '101', '111'],
  ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'],
  ['111', '001', '111', '001', '111'],
  ['101', '101', '111', '001', '001'],
  ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'],
  ['111', '001', '010', '010', '010'],
  ['111', '101', '111', '101', '111'],
  ['111', '101', '111', '001', '111']
];

type Player = {
  x: number;
  y: number;
  angle: number;
  health: number;
  ammo: number;
  kills: number;
};

type Enemy = {
  x: number;
  y: number;
  health: number;
  alive: boolean;
  hitFrames: number;
};

type RayHit = {
  distance: number;
  side: 0 | 1;
  wall: string;
  texture: number;
};

let player: Player = createPlayer();
let enemy: Enemy = createEnemy();
let frame = 0;
let fireFrames = 0;

export default new Clockface({
  resolution: RESOLUTION,
  data: { ...DEFAULT_DATA },
  inputs: [
    {
      type: 'button',
      id: 'fire',
      friendlyName: 'FIRE',
      onSubmit: (_value, context) => {
        fire(context);
        renderDoom(context);
      }
    },
    {
      type: 'button',
      id: 'forward',
      friendlyName: '↑',
      onSubmit: (_value, context) => {
        moveForward(1);
        renderDoom(context);
      }
    },
    [
      {
        type: 'button',
        id: 'turnLeft',
        friendlyName: '←',
        onSubmit: (_value, context) => {
          player.angle -= TURN_STEP;
          renderDoom(context);
        }
      },
      {
        type: 'button',
        id: 'turnRight',
        friendlyName: '→',
        onSubmit: (_value, context) => {
          player.angle += TURN_STEP;
          renderDoom(context);
        }
      }
    ],
    {
      type: 'button',
      id: 'back',
      friendlyName: '↓',
      onSubmit: (_value, context) => {
        moveForward(-0.8);
        renderDoom(context);
      }
    },
    [
      {
        type: 'button',
        id: 'strafeLeft',
        friendlyName: 'A',
        onSubmit: (_value, context) => {
          strafe(-1);
          renderDoom(context);
        }
      },
      {
        type: 'button',
        id: 'strafeRight',
        friendlyName: 'D',
        onSubmit: (_value, context) => {
          strafe(1);
          renderDoom(context);
        }
      }
    ],
    {
      type: 'button',
      id: 'reset',
      friendlyName: 'RESET',
      onSubmit: (_value, context) => {
        resetGame(context);
      }
    }
  ],
  updateIntervalMs: UPDATE_INTERVAL_MS,
  init: resetGame,
  main: (context) => {
    frame += 1;
    fireFrames = Math.max(0, fireFrames - 1);
    enemy.hitFrames = Math.max(0, enemy.hitFrames - 1);
    renderDoom(context);
  }
});

function resetGame(context: ClockfaceContext) {
  player = createPlayer();
  enemy = createEnemy();
  frame = 0;
  fireFrames = 0;
  syncData(context);
  renderDoom(context);
}

function createPlayer(): Player {
  return {
    x: 2.5,
    y: 1.7,
    angle: 0.35,
    health: 100,
    ammo: 20,
    kills: 0
  };
}

function createEnemy(): Enemy {
  return {
    x: 12.5,
    y: 13.5,
    health: 3,
    alive: true,
    hitFrames: 0
  };
}

function renderDoom(context: ClockfaceContext) {
  const zBuffer = new Array(context.resolution).fill(Infinity) as number[];

  drawBackdrop(context);
  drawWalls(context, zBuffer);
  drawEnemy(context, zBuffer);
  drawWeapon(context);
  drawHud(context);
}

function drawBackdrop(context: ClockfaceContext) {
  const horizon = Math.floor(context.resolution * 0.48);

  for (let y = 0; y < context.resolution; y += 1) {
    const isSky = y < horizon;
    const amount = isSky ? y / Math.max(1, horizon - 1) : (y - horizon) / Math.max(1, context.resolution - horizon);
    const color = isSky ? mixPixel(SKY_TOP, SKY_BOTTOM, amount) : mixPixel(FLOOR_TOP, FLOOR_BOTTOM, amount);

    for (let x = 0; x < context.resolution; x += 1) {
      setPixel(context, x, y, color);
    }
  }
}

function drawWalls(context: ClockfaceContext, zBuffer: number[]) {
  for (let x = 0; x < context.resolution; x += 1) {
    const camera = x / Math.max(1, context.resolution - 1) - 0.5;
    const rayAngle = player.angle + camera * FOV;
    const hit = castRay(rayAngle);
    const correctedDistance = Math.max(0.001, hit.distance * Math.cos(rayAngle - player.angle));
    const wallHeight = clampInt(Math.round((context.resolution * 0.92) / correctedDistance), 1, context.resolution);
    const startY = clampInt(Math.floor(context.resolution / 2 - wallHeight / 2), 0, context.resolution - 1);
    const endY = clampInt(Math.ceil(context.resolution / 2 + wallHeight / 2), 0, context.resolution - 1);
    const baseColor = WALL_COLORS[hit.wall] ?? WALL_COLORS['1'];

    zBuffer[x] = correctedDistance;

    for (let y = startY; y <= endY; y += 1) {
      const sideShade = hit.side === 1 ? 0.72 : 1;
      const distanceShade = clampNumber(1.16 - correctedDistance * 0.13, 0.22, 1);
      const flicker = 0.96 + Math.sin(frame * 0.17 + x * 0.31) * 0.04;
      const textureShade = getWallTextureShade(hit, x, y);

      setPixel(
        context,
        x,
        y,
        shadePixel(baseColor, textureShade * sideShade * distanceShade * flicker)
      );
    }
  }
}

function getWallTextureShade(hit: RayHit, x: number, y: number) {
  const brickX = Math.floor(hit.texture * 4);
  const brickY = Math.floor(y / 7);
  const seam = hit.texture < 0.035 || hit.texture > 0.965 || y % 7 === 0;
  const grain = Math.sin((brickX * 19 + brickY * 31 + x * 3 + y * 5) * 1.37) * 0.045;
  const brick = (brickX + brickY) % 2 === 0 ? 1.03 : 0.94;

  return (seam ? 0.78 : brick) + grain;
}

function drawEnemy(context: ClockfaceContext, zBuffer: number[]) {
  if (!enemy.alive) {
    return;
  }

  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  const distance = Math.hypot(dx, dy);
  const angleToEnemy = Math.atan2(dy, dx);
  const angleOffset = normalizeAngle(angleToEnemy - player.angle);

  if (Math.abs(angleOffset) > FOV * 0.58 || !hasLineOfSight(enemy.x, enemy.y)) {
    return;
  }

  const screenX = Math.round((0.5 + angleOffset / FOV) * context.resolution);
  const spriteSize = clampInt(Math.round(context.resolution / Math.max(0.3, distance) * 0.85), 5, 30);
  const startX = screenX - Math.floor(spriteSize / 2);
  const startY = Math.floor(context.resolution * 0.52 - spriteSize / 2);
  const color = enemy.hitFrames > 0 ? DEMON_HIT : DEMON;

  for (let y = 0; y < spriteSize; y += 1) {
    for (let x = 0; x < spriteSize; x += 1) {
      const maskX = (x / Math.max(1, spriteSize - 1)) * 2 - 1;
      const maskY = (y / Math.max(1, spriteSize - 1)) * 2 - 1;
      const body = maskX * maskX * 0.72 + maskY * maskY <= 0.86;
      const horns = y < spriteSize * 0.24 && Math.abs(maskX) > 0.48 && Math.abs(maskX) < 0.88;
      const legs = y > spriteSize * 0.74 && Math.abs(maskX) > 0.24 && Math.abs(maskX) < 0.66;
      const eye = y > spriteSize * 0.33 && y < spriteSize * 0.48 && Math.abs(Math.abs(maskX) - 0.28) < 0.12;
      const px = startX + x;

      if ((!body && !horns && !legs) || px < 0 || px >= context.resolution || distance >= zBuffer[px]) {
        continue;
      }

      const shade = clampNumber(1.1 - distance * 0.08, 0.32, 1);
      setPixel(context, px, startY + y, eye ? DEMON_EYE : shadePixel(horns || legs ? DEMON_DARK : color, shade));
    }
  }
}

function drawWeapon(context: ClockfaceContext) {
  const bob = Math.round(Math.sin(frame * 0.45) * 1.2);
  const muzzle = fireFrames > 0;

  fillRect(context, 25, 48 + bob, 14, 16, WEAPON_DARK);
  fillRect(context, 28, 44 + bob, 8, 12, WEAPON_LIGHT);
  fillRect(context, 30, 39 + bob, 4, 8, [84, 88, 94]);
  fillRect(context, 23, 55 + bob, 18, 9, [28, 29, 34]);

  if (muzzle) {
    fillRect(context, 29, 33 + bob, 6, 6, MUZZLE);
    fillRect(context, 27, 35 + bob, 10, 2, [255, 122, 48]);
  }
}

function drawHud(context: ClockfaceContext) {
  fillRect(context, 0, 57, context.resolution, 7, HUD_BG);

  for (let x = 0; x < context.resolution; x += 2) {
    setPixel(context, x, 57, HUD_LINE);
  }

  const healthWidth = Math.round((Math.max(0, player.health) / 100) * 20);
  const ammoWidth = Math.round((Math.max(0, player.ammo) / 20) * 18);
  fillRect(context, 2, 60, 20, 2, [50, 18, 18]);
  fillRect(context, 2, 60, healthWidth, 2, HEALTH_COLOR);
  fillRect(context, 44, 60, 18, 2, [52, 39, 12]);
  fillRect(context, 44, 60, ammoWidth, 2, AMMO_COLOR);
  drawDigit(context, Math.floor(player.health / 10), 24, 58, HEALTH_COLOR);
  drawDigit(context, player.ammo % 10, 38, 58, AMMO_COLOR);
}

function fire(context: ClockfaceContext) {
  if (player.ammo <= 0) {
    fireFrames = 1;
    return;
  }

  player.ammo -= 1;
  fireFrames = 4;

  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  const distance = Math.hypot(dx, dy);
  const angleOffset = normalizeAngle(Math.atan2(dy, dx) - player.angle);

  if (enemy.alive && Math.abs(angleOffset) < 0.16 && distance < 10 && hasLineOfSight(enemy.x, enemy.y)) {
    enemy.health -= 1;
    enemy.hitFrames = 5;

    if (enemy.health <= 0) {
      enemy.alive = false;
      player.kills += 1;
    }
  }

  syncData(context);
}

function moveForward(direction: number) {
  const step = MOVE_STEP * direction;
  movePlayer(Math.cos(player.angle) * step, Math.sin(player.angle) * step);
}

function strafe(direction: number) {
  const angle = player.angle + Math.PI / 2;
  const step = STRAFE_STEP * direction;
  movePlayer(Math.cos(angle) * step, Math.sin(angle) * step);
}

function movePlayer(dx: number, dy: number) {
  const nextX = player.x + dx;
  const nextY = player.y + dy;

  if (isWalkable(nextX, player.y)) {
    player.x = nextX;
  }

  if (isWalkable(player.x, nextY)) {
    player.y = nextY;
  }
}

function castRay(angle: number): RayHit {
  const rayDirX = Math.cos(angle) || 0.0001;
  const rayDirY = Math.sin(angle) || 0.0001;
  let mapX = Math.floor(player.x);
  let mapY = Math.floor(player.y);
  const deltaDistX = Math.abs(1 / rayDirX);
  const deltaDistY = Math.abs(1 / rayDirY);
  const stepX = rayDirX < 0 ? -1 : 1;
  const stepY = rayDirY < 0 ? -1 : 1;
  let sideDistX = rayDirX < 0 ? (player.x - mapX) * deltaDistX : (mapX + 1 - player.x) * deltaDistX;
  let sideDistY = rayDirY < 0 ? (player.y - mapY) * deltaDistY : (mapY + 1 - player.y) * deltaDistY;
  let side: 0 | 1 = 0;

  for (let step = 0; step < MAX_RAY_STEPS; step += 1) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }

    const wall = getMapCell(mapX, mapY);

    if (wall !== '0') {
      const distance =
        side === 0
          ? (mapX - player.x + (1 - stepX) / 2) / rayDirX
          : (mapY - player.y + (1 - stepY) / 2) / rayDirY;
      const hit = side === 0 ? player.y + distance * rayDirY : player.x + distance * rayDirX;

      return {
        distance: Math.max(0.001, distance),
        side,
        wall,
        texture: hit - Math.floor(hit)
      };
    }
  }

  return {
    distance: MAX_RAY_STEPS,
    side: 0,
    wall: '1',
    texture: 0
  };
}

function hasLineOfSight(targetX: number, targetY: number) {
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance * 6));

  for (let step = 1; step < steps; step += 1) {
    const amount = step / steps;
    const x = player.x + dx * amount;
    const y = player.y + dy * amount;

    if (!isWalkable(x, y)) {
      return false;
    }
  }

  return true;
}

function isWalkable(x: number, y: number) {
  return getMapCell(Math.floor(x), Math.floor(y)) === '0';
}

function getMapCell(x: number, y: number) {
  return MAP[y]?.[x] ?? '1';
}

function syncData(context: ClockfaceContext) {
  context.data.health = String(player.health);
  context.data.ammo = String(player.ammo);
  context.data.kills = String(player.kills);
}

function setPixel(context: ClockfaceContext, x: number, y: number, color: ClockfacePixel) {
  if (x < 0 || y < 0 || x >= context.resolution || y >= context.resolution) {
    return;
  }

  context.buffer[x + y * context.resolution] = [...color];
}

function fillRect(
  context: ClockfaceContext,
  startX: number,
  startY: number,
  width: number,
  height: number,
  color: ClockfacePixel
) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(context, startX + x, startY + y, color);
    }
  }
}

function drawDigit(
  context: ClockfaceContext,
  digit: number,
  startX: number,
  startY: number,
  color: ClockfacePixel
) {
  const segments = DIGITS[Math.max(0, Math.min(9, digit))] ?? DIGITS[0];

  segments.forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel === '1') {
        setPixel(context, startX + x, startY + y, color);
      }
    });
  });
}

function shadePixel(color: ClockfacePixel, amount: number): ClockfacePixel {
  return color.map((channel) => clampInt(Math.round(channel * amount), 0, 255)) as ClockfacePixel;
}

function mixPixel(start: ClockfacePixel, end: ClockfacePixel, amount: number): ClockfacePixel {
  const clamped = clampNumber(amount, 0, 1);

  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped)
  ];
}

function normalizeAngle(angle: number) {
  let nextAngle = angle;

  while (nextAngle > Math.PI) {
    nextAngle -= Math.PI * 2;
  }

  while (nextAngle < -Math.PI) {
    nextAngle += Math.PI * 2;
  }

  return nextAngle;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
