import { Clockface, type ClockfaceContext, type ClockfacePixel } from '$lib/Clockface';

const RESOLUTION = 32;
const CELL_SIZE = 2;
const GRID_SIZE = RESOLUTION / CELL_SIZE;
const UPDATE_INTERVAL_MS = 150;
const BACKGROUND: ClockfacePixel = [0, 0, 0];
const SNAKE_HEAD: ClockfacePixel = [143, 244, 190];
const SNAKE_BODY: ClockfacePixel = [59, 204, 142];
const FOOD_COLOR: ClockfacePixel = [255, 76, 101];

type Direction = 'up' | 'down' | 'left' | 'right';
type Point = {
  x: number;
  y: number;
};

const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];
const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
};

let snake: Point[] = [];
let food: Point = { x: 0, y: 0 };
let direction: Direction = 'right';
let pendingDirection: Direction = 'right';
let gameOverFrames = 0;

export default new Clockface({
  resolution: RESOLUTION,
  data: {
    score: '0'
  },
  inputs: [],
  updateIntervalMs: UPDATE_INTERVAL_MS,
  init: (context) => {
    resetGame(context);
  },
  main: (context) => {
    stepGame(context);
    renderSnake(context);
  }
});

function resetGame(context: ClockfaceContext) {
  snake = [
    { x: 7, y: 8 },
    { x: 6, y: 8 },
    { x: 5, y: 8 }
  ];
  direction = 'right';
  pendingDirection = 'right';
  gameOverFrames = 0;
  context.data.score = '0';
  food = createFood();
  renderSnake(context);
}

function turn(nextDirection: Direction) {
  if (OPPOSITE_DIRECTION[nextDirection] === direction) {
    return;
  }

  pendingDirection = nextDirection;
}

function stepGame(context: ClockfaceContext) {
  if (snake.length === 0 || gameOverFrames > 0) {
    gameOverFrames -= 1;

    if (gameOverFrames <= 0) {
      resetGame(context);
    }

    return;
  }

  turn(chooseAutoDirection());
  direction = pendingDirection;

  const head = snake[0];
  const nextHead = wrapPoint({
    x: head.x + getDirectionDelta(direction).x,
    y: head.y + getDirectionDelta(direction).y
  });
  const eatsFood = nextHead.x === food.x && nextHead.y === food.y;
  const bodyToCheck = eatsFood ? snake : snake.slice(0, -1);

  if (bodyToCheck.some((point) => point.x === nextHead.x && point.y === nextHead.y)) {
    gameOverFrames = 5;
    return;
  }

  snake = [nextHead, ...snake];

  if (eatsFood) {
    context.data.score = String(Number.parseInt(context.data.score || '0', 10) + 1);
    food = createFood();
  } else {
    snake.pop();
  }
}

function chooseAutoDirection() {
  const pathToFood = findPath(snake[0], food, snake.slice(0, -1));
  const foodDirection = pathToFood[0];

  if (foodDirection && getAllowedDirections().includes(foodDirection) && isDirectionSafe(foodDirection)) {
    return foodDirection;
  }

  const safeDirections = getAllowedDirections().filter(isDirectionSafe);

  if (safeDirections.length > 0) {
    return safeDirections
      .map((nextDirection) => ({
        direction: nextDirection,
        space: countReachableCells(getNextHead(nextDirection), getSnakeAfterMove(nextDirection))
      }))
      .sort((left, right) => right.space - left.space)[0].direction;
  }

  return getAllowedDirections()[0] ?? direction;
}

function isDirectionSafe(nextDirection: Direction) {
  const nextSnake = getSnakeAfterMove(nextDirection);
  const nextHead = nextSnake[0];
  const eatsFood = nextHead.x === food.x && nextHead.y === food.y;
  const bodyToCheck = eatsFood ? snake : snake.slice(0, -1);

  if (bodyToCheck.some((point) => point.x === nextHead.x && point.y === nextHead.y)) {
    return false;
  }

  const nextTail = nextSnake.at(-1);

  if (!nextTail) {
    return false;
  }

  return findPath(nextHead, nextTail, nextSnake.slice(1, -1)).length > 0;
}

function getAllowedDirections() {
  return DIRECTIONS.filter((nextDirection) => OPPOSITE_DIRECTION[nextDirection] !== direction);
}

function getSnakeAfterMove(nextDirection: Direction) {
  const nextHead = getNextHead(nextDirection);
  const eatsFood = nextHead.x === food.x && nextHead.y === food.y;
  const nextSnake = [nextHead, ...snake];

  if (!eatsFood) {
    nextSnake.pop();
  }

  return nextSnake;
}

function getNextHead(nextDirection: Direction) {
  const head = snake[0];
  const delta = getDirectionDelta(nextDirection);

  return wrapPoint({
    x: head.x + delta.x,
    y: head.y + delta.y
  });
}

function findPath(start: Point, target: Point, blocked: Point[]) {
  const blockedKeys = new Set(blocked.map(getPointKey));
  const visited = new Set([getPointKey(start)]);
  const queue: Array<{ point: Point; path: Direction[] }> = [{ point: start, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    if (pointsEqual(current.point, target)) {
      return current.path;
    }

    for (const nextDirection of DIRECTIONS) {
      const delta = getDirectionDelta(nextDirection);
      const nextPoint = wrapPoint({
        x: current.point.x + delta.x,
        y: current.point.y + delta.y
      });
      const key = getPointKey(nextPoint);

      if (visited.has(key) || blockedKeys.has(key)) {
        continue;
      }

      visited.add(key);
      queue.push({
        point: nextPoint,
        path: [...current.path, nextDirection]
      });
    }
  }

  return [];
}

function countReachableCells(start: Point, nextSnake: Point[]) {
  const blockedKeys = new Set(nextSnake.slice(1).map(getPointKey));
  const visited = new Set<string>();
  const queue: Point[] = [start];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    const key = getPointKey(current);

    if (visited.has(key) || blockedKeys.has(key)) {
      continue;
    }

    visited.add(key);

    for (const nextDirection of DIRECTIONS) {
      const delta = getDirectionDelta(nextDirection);
      queue.push(
        wrapPoint({
          x: current.x + delta.x,
          y: current.y + delta.y
        })
      );
    }
  }

  return visited.size;
}

function renderSnake(context: ClockfaceContext) {
  drawBackground(context);
  drawCell(context, food, FOOD_COLOR);

  snake.forEach((point, index) => {
    drawCell(context, point, index === 0 ? SNAKE_HEAD : SNAKE_BODY);
  });

  if (gameOverFrames > 0) {
    drawGameOverFlash(context);
  }
}

function drawBackground(context: ClockfaceContext) {
  for (let y = 0; y < context.resolution; y += 1) {
    for (let x = 0; x < context.resolution; x += 1) {
      context.buffer[x + y * context.resolution] = [...BACKGROUND];
    }
  }
}

function drawCell(context: ClockfaceContext, point: Point, color: ClockfacePixel) {
  const startX = point.x * CELL_SIZE;
  const startY = point.y * CELL_SIZE;

  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      context.buffer[startX + x + (startY + y) * context.resolution] = [...color];
    }
  }
}

function drawGameOverFlash(context: ClockfaceContext) {
  const color: ClockfacePixel = [92, 18, 28];

  for (let index = 0; index < context.buffer.length; index += 1) {
    if (index % 5 === 0) {
      context.buffer[index] = [...color];
    }
  }
}

function createFood() {
  const available: Point[] = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!snake.some((point) => point.x === x && point.y === y)) {
        available.push({ x, y });
      }
    }
  }

  return available[Math.floor(Math.random() * available.length)] ?? { x: 0, y: 0 };
}

function getDirectionDelta(nextDirection: Direction) {
  if (nextDirection === 'up') {
    return { x: 0, y: -1 };
  }

  if (nextDirection === 'down') {
    return { x: 0, y: 1 };
  }

  if (nextDirection === 'left') {
    return { x: -1, y: 0 };
  }

  return { x: 1, y: 0 };
}

function wrapPoint(point: Point) {
  return {
    x: (point.x + GRID_SIZE) % GRID_SIZE,
    y: (point.y + GRID_SIZE) % GRID_SIZE
  };
}

function pointsEqual(left: Point, right: Point) {
  return left.x === right.x && left.y === right.y;
}

function getPointKey(point: Point) {
  return `${point.x},${point.y}`;
}
