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
  inputs: [
    {
      type: 'button',
      id: 'up',
      friendlyName: '↑',
      onSubmit: (_value, context) => {
        turn('up');
        renderSnake(context);
      }
    },
    [
      {
        type: 'button',
        id: 'left',
        friendlyName: '←',
        onSubmit: (_value, context) => {
          turn('left');
          renderSnake(context);
        }
      },
      {
        type: 'button',
        id: 'right',
        friendlyName: '→',
        onSubmit: (_value, context) => {
          turn('right');
          renderSnake(context);
        }
      }
    ],
    {
      type: 'button',
      id: 'down',
      friendlyName: '↓',
      onSubmit: (_value, context) => {
        turn('down');
        renderSnake(context);
      }
    }
  ],
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
