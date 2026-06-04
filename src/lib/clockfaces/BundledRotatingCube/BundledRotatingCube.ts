import {
  defineClockface,
  data,
  input,
  color,
  type ClockfaceContext,
  type ClockfacePixel
} from '@pixoopal/clockface';

const RESOLUTION = 32;
const UPDATE_INTERVAL_MS = 100;
const DEFAULT_DATA = {
  cubeColor: '#6ee7d8',
  borderColor: '#ecfcff',
  displayResolution: '64'
};
const BACKGROUND_TOP: ClockfacePixel = [4, 8, 16];
const BACKGROUND_BOTTOM: ClockfacePixel = [1, 2, 5];
const CAMERA_DISTANCE = 4.4;
const PERSPECTIVE = 31;
const CUBE_SCALE = 1.15;
const EDGE_FILL_TOLERANCE = 0.7;

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type ProjectedPoint = Vec3 & {
  screenX: number;
  screenY: number;
};

type Face = {
  points: ProjectedPoint[];
  color: ClockfacePixel;
  depth: number;
};

const VERTICES: Vec3[] = [
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 }
];

const FACES = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [3, 2, 6, 7],
  [1, 5, 6, 2],
  [0, 3, 7, 4]
];

const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
];

let angle = 0;

export default defineClockface({
  resolution: (context) => getDisplayResolution(context.data.displayResolution),
  frameQueueSize: 0,
  data: {
    cubeColor: data.color(DEFAULT_DATA.cubeColor),
    borderColor: data.color(DEFAULT_DATA.borderColor),
    displayResolution: data.select(DEFAULT_DATA.displayResolution)
  },
  inputs: [
    input.select(
      'displayResolution',
      'Resolution',
      [
        { value: '32', label: '32x32' },
        { value: '64', label: '64x64' }
      ],
      {
        isSetting: true
      }
    ),
    input.color('cubeColor', 'Cube color', {
      onSubmit: (value, context) => {
        context.data.cubeColor = String(value);
        renderCube(context);
      }
    }),
    input.color('borderColor', 'Border color', {
      onSubmit: (value, context) => {
        context.data.borderColor = String(value);
        renderCube(context);
      }
    })
  ],
  interval: UPDATE_INTERVAL_MS,
  setup: renderCube,
  render: (context) => {
    angle += 0.07;
    renderCube(context);
  }
});

function renderCube(context: ClockfaceContext) {
  const cubeColor = parseHexColor(context.data.cubeColor, DEFAULT_DATA.cubeColor);
  const borderColor = parseHexColor(context.data.borderColor, DEFAULT_DATA.borderColor);
  const rotated = VERTICES.map((vertex) => rotateVertex(scaleVertex(vertex, CUBE_SCALE), angle));
  const projected = rotated.map((vertex) => projectVertex(vertex, context.resolution));
  const faces = FACES.map((face) => createFace(face, rotated, projected, cubeColor)).sort(
    (left, right) => left.depth - right.depth
  );

  drawBackground(context);
  drawShadow(context, projected);

  for (const face of faces) {
    drawFace(context, face);
  }

  for (const [start, end] of EDGES) {
    drawLine(context, projected[start], projected[end], borderColor, 0.46);
  }
}

function createFace(
  indexes: number[],
  rotated: Vec3[],
  projected: ProjectedPoint[],
  baseColor: ClockfacePixel
): Face {
  const points = indexes.map((index) => projected[index]);
  const normal = normalize(cross(subtract(rotated[indexes[1]], rotated[indexes[0]]), subtract(rotated[indexes[2]], rotated[indexes[0]])));
  const light = normalize({ x: -0.45, y: -0.7, z: 0.95 });
  const lightAmount = Math.max(0, dot(normal, light));
  const viewAmount = Math.max(0, normal.z) * 0.18;
  const shade = 0.34 + lightAmount * 0.48 + viewAmount;

  return {
    points,
    color: shadePixel(baseColor, shade),
    depth: indexes.reduce((sum, index) => sum + rotated[index].z, 0) / indexes.length
  };
}

function drawBackground(context: ClockfaceContext) {
  for (let y = 0; y < context.resolution; y += 1) {
    const amount = y / Math.max(1, context.resolution - 1);

    for (let x = 0; x < context.resolution; x += 1) {
      setPixel(context, x, y, mixPixel(BACKGROUND_TOP, BACKGROUND_BOTTOM, amount));
    }
  }
}

function drawShadow(context: ClockfaceContext, points: ProjectedPoint[]) {
  const scale = context.resolution / RESOLUTION;
  const centerX = points.reduce((sum, point) => sum + point.screenX, 0) / points.length;
  const lowestY = Math.max(...points.map((point) => point.screenY));
  const radiusX = 17 * scale;
  const radiusY = 5 * scale;
  const shadowY = Math.min(context.resolution - 7 * scale, lowestY + 6 * scale);

  for (let y = Math.floor(shadowY - radiusY); y <= Math.ceil(shadowY + radiusY); y += 1) {
    for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - shadowY) / radiusY;
      const distance = dx * dx + dy * dy;

      if (distance <= 1) {
        blendPixel(context, x, y, [0, 0, 0], (1 - distance) * 0.38);
      }
    }
  }
}

function drawFace(context: ClockfaceContext, face: Face) {
  fillPolygon(context, face.points, face.color);
}

function fillPolygon(context: ClockfaceContext, points: ProjectedPoint[], color: ClockfacePixel) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.screenX)) - 1));
  const maxX = Math.min(
    context.resolution - 1,
    Math.ceil(Math.max(...points.map((point) => point.screenX)) + 1)
  );
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.screenY)) - 1));
  const maxY = Math.min(
    context.resolution - 1,
    Math.ceil(Math.max(...points.map((point) => point.screenY)) + 1)
  );

  if (points.length < 3) {
    return;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;

      if (isInsideConvexPolygon(points, sampleX, sampleY) || isNearPolygonEdge(points, sampleX, sampleY)) {
        setPixel(context, x, y, color);
      }
    }
  }
}

function drawLine(
  context: ClockfaceContext,
  start: ProjectedPoint,
  end: ProjectedPoint,
  color: ClockfacePixel,
  opacity: number
) {
  const dx = end.screenX - start.screenX;
  const dy = end.screenY - start.screenY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const x = Math.round(start.screenX + dx * amount);
    const y = Math.round(start.screenY + dy * amount);
    blendPixel(context, x, y, color, opacity);
  }
}

function projectVertex(vertex: Vec3, resolution: number): ProjectedPoint {
  const depth = CAMERA_DISTANCE - vertex.z;
  const scale = (PERSPECTIVE * resolution) / RESOLUTION / depth;

  return {
    ...vertex,
    screenX: resolution / 2 + vertex.x * scale,
    screenY: resolution / 2 + vertex.y * scale
  };
}

function rotateVertex(vertex: Vec3, rotation: number): Vec3 {
  const yRotation = rotation;
  const xRotation = rotation * 0.68;
  const zRotation = rotation * 0.22;
  const cosY = Math.cos(yRotation);
  const sinY = Math.sin(yRotation);
  const yRotated = {
    x: vertex.x * cosY + vertex.z * sinY,
    y: vertex.y,
    z: -vertex.x * sinY + vertex.z * cosY
  };
  const cosX = Math.cos(xRotation);
  const sinX = Math.sin(xRotation);
  const xRotated = {
    x: yRotated.x,
    y: yRotated.y * cosX - yRotated.z * sinX,
    z: yRotated.y * sinX + yRotated.z * cosX
  };
  const cosZ = Math.cos(zRotation);
  const sinZ = Math.sin(zRotation);

  return {
    x: xRotated.x * cosZ - xRotated.y * sinZ,
    y: xRotated.x * sinZ + xRotated.y * cosZ,
    z: xRotated.z
  };
}

function scaleVertex(vertex: Vec3, scale: number): Vec3 {
  return {
    x: vertex.x * scale,
    y: vertex.y * scale,
    z: vertex.z * scale
  };
}

function edge(a: ProjectedPoint, b: ProjectedPoint, x: number, y: number) {
  return (x - a.screenX) * (b.screenY - a.screenY) - (y - a.screenY) * (b.screenX - a.screenX);
}

function isInsideConvexPolygon(points: ProjectedPoint[], x: number, y: number) {
  let sign = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const value = edge(current, next, x, y);

    if (Math.abs(value) <= Number.EPSILON) {
      continue;
    }

    const nextSign = Math.sign(value);

    if (sign !== 0 && nextSign !== sign) {
      return false;
    }

    sign = nextSign;
  }

  return true;
}

function isNearPolygonEdge(points: ProjectedPoint[], x: number, y: number) {
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];

    if (distanceToSegment(start, end, x, y) <= EDGE_FILL_TOLERANCE) {
      return true;
    }
  }

  return false;
}

function distanceToSegment(start: ProjectedPoint, end: ProjectedPoint, x: number, y: number) {
  const dx = end.screenX - start.screenX;
  const dy = end.screenY - start.screenY;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(x - start.screenX, y - start.screenY);
  }

  const amount = Math.max(
    0,
    Math.min(1, ((x - start.screenX) * dx + (y - start.screenY) * dy) / lengthSquared)
  );
  const projectionX = start.screenX + dx * amount;
  const projectionY = start.screenY + dy * amount;

  return Math.hypot(x - projectionX, y - projectionY);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function shadePixel(color: ClockfacePixel, shade: number): ClockfacePixel {
  return color.map((channel) => clampColor(channel * shade)) as ClockfacePixel;
}

function mixPixel(start: ClockfacePixel, end: ClockfacePixel, amount: number): ClockfacePixel {
  const clamped = Math.max(0, Math.min(1, amount));

  return [
    Math.round(start[0] + (end[0] - start[0]) * clamped),
    Math.round(start[1] + (end[1] - start[1]) * clamped),
    Math.round(start[2] + (end[2] - start[2]) * clamped)
  ];
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

  const current = context.canvas.buffer[x + y * context.resolution];
  context.canvas.pixel(x, y, mixPixel(current, color, opacity));
}

function setPixel(context: ClockfaceContext, x: number, y: number, color: ClockfacePixel) {
  context.canvas.pixel(x, y, color);
}

function parseHexColor(value: string | undefined, fallback: string): ClockfacePixel {
  try {
    return color.parse(String(value ?? fallback));
  } catch {
    return color.parse(fallback);
  }
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getDisplayResolution(value: string | undefined) {
  return value === '32' ? 32 : 64;
}
