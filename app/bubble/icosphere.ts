export const VELOCITY_RANGE = 0.34;
export const TEMPERATURE_RANGE = 4;

type Vector = [number, number, number];
type Face = [number, number, number];

export type Icosphere = {
  positions: Float32Array;
  indices: Uint32Array;
  stateUvs: Float32Array;
  positionTexels: Float32Array;
  neighborTexels: Float32Array;
  initialState0: Float32Array;
  initialState1: Float32Array;
  textureWidth: number;
  textureHeight: number;
  vertexCount: number;
};

function normalize([x, y, z]: Vector): Vector {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(vector: Vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function addWeighted(target: Vector, vector: Vector, weight: number) {
  target[0] += vector[0] * weight;
  target[1] += vector[1] * weight;
  target[2] += vector[2] * weight;
}

function createBaseIcosahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices: Vector[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map((vertex) => normalize(vertex as Vector));
  const faces: Face[] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices, faces };
}

function subdivide(vertices: Vector[], faces: Face[]) {
  const midpointCache = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const vertex = normalize([
      (vertices[a][0] + vertices[b][0]) * 0.5,
      (vertices[a][1] + vertices[b][1]) * 0.5,
      (vertices[a][2] + vertices[b][2]) * 0.5,
    ]);
    const index = vertices.length;
    vertices.push(vertex);
    midpointCache.set(key, index);
    return index;
  };

  const nextFaces: Face[] = [];
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return nextFaces;
}

function cotangent(a: Vector, b: Vector, c: Vector) {
  const u = subtract(b, a);
  const v = subtract(c, a);
  return dot(u, v) / Math.max(length(cross(u, v)), 1e-9);
}

function initialFields(normal: Vector) {
  const [x, y, z] = normal;
  const modeA = Math.sin(5.2 * (0.74 * x - 0.21 * y + 0.64 * z));
  const modeB = Math.sin(8.1 * (-0.31 * x + 0.82 * y + 0.47 * z) + 0.8);
  const modeC = Math.sin(11.7 * (0.58 * x + 0.72 * y - 0.38 * z) - 0.4);
  const height = 0.565 - 0.052 * y + 0.014 * modeA + 0.008 * modeB + 0.004 * modeC;
  const surfactant = 0.5 + 0.018 * modeA - 0.012 * modeB + 0.007 * modeC;
  const temperature = 0.16 * y - 0.08 * modeA + 0.045 * modeB;

  const velocity: Vector = [0, 0, 0];
  const streamModes: Array<[Vector, number, number, number]> = [
    [[0.74, -0.21, 0.64], 5.2, 0.0062, 0],
    [[-0.31, 0.82, 0.47], 8.1, 0.0036, 0.8],
    [[0.58, 0.72, -0.38], 11.7, 0.0021, -0.4],
  ];
  for (const [axis, frequency, amplitude, phase] of streamModes) {
    const coefficient = amplitude * frequency
      * Math.cos(frequency * dot(normal, axis) + phase);
    addWeighted(velocity, cross(normal, axis), coefficient);
  }
  return { height, surfactant, temperature, velocity };
}

export function createIcosphere(subdivisions: number): Icosphere {
  const base = createBaseIcosahedron();
  const vertices = base.vertices;
  let faces = base.faces;
  for (let level = 0; level < subdivisions; level += 1) {
    faces = subdivide(vertices, faces);
  }

  const vertexCount = vertices.length;
  const textureWidth = 2 ** Math.ceil(Math.log2(Math.sqrt(vertexCount)));
  const textureHeight = Math.ceil(vertexCount / textureWidth);
  const texelCount = textureWidth * textureHeight;
  const dualAreas = new Float64Array(vertexCount);
  const cotangentWeights = Array.from(
    { length: vertexCount },
    () => new Map<number, number>(),
  );

  const addEdgeWeight = (a: number, b: number, weight: number) => {
    cotangentWeights[a].set(b, (cotangentWeights[a].get(b) ?? 0) + weight);
    cotangentWeights[b].set(a, (cotangentWeights[b].get(a) ?? 0) + weight);
  };

  for (const [a, b, c] of faces) {
    const ab = subtract(vertices[b], vertices[a]);
    const ac = subtract(vertices[c], vertices[a]);
    const area = 0.5 * length(cross(ab, ac));
    dualAreas[a] += area / 3;
    dualAreas[b] += area / 3;
    dualAreas[c] += area / 3;
    addEdgeWeight(b, c, 0.5 * cotangent(vertices[a], vertices[b], vertices[c]));
    addEdgeWeight(c, a, 0.5 * cotangent(vertices[b], vertices[c], vertices[a]));
    addEdgeWeight(a, b, 0.5 * cotangent(vertices[c], vertices[a], vertices[b]));
  }

  const positions = new Float32Array(vertexCount * 3);
  const stateUvs = new Float32Array(vertexCount * 2);
  const positionTexels = new Float32Array(texelCount * 4);
  const neighborTexels = new Float32Array(texelCount * 6 * 4);
  const initialState0 = new Float32Array(texelCount * 4);
  const initialState1 = new Float32Array(texelCount * 4);
  neighborTexels.fill(-1);

  for (let index = 0; index < texelCount; index += 1) {
    initialState0[index * 4] = 0.55;
    initialState0[index * 4 + 1] = 0.5;
    initialState0[index * 4 + 2] = 0.5;
    initialState0[index * 4 + 3] = 0.5;
    initialState1[index * 4] = 0.5;
    initialState1[index * 4 + 1] = 0.5;
    initialState1[index * 4 + 3] = 1;
  }

  for (let index = 0; index < vertexCount; index += 1) {
    const normal = vertices[index];
    positions.set(normal, index * 3);
    const texelX = index % textureWidth;
    const texelY = Math.floor(index / textureWidth);
    stateUvs[index * 2] = (texelX + 0.5) / textureWidth;
    stateUvs[index * 2 + 1] = (texelY + 0.5) / textureHeight;
    positionTexels.set([...normal, dualAreas[index]], index * 4);

    const fields = initialFields(normal);
    initialState0[index * 4] = fields.height;
    initialState0[index * 4 + 1] = fields.velocity[0] / VELOCITY_RANGE * 0.5 + 0.5;
    initialState0[index * 4 + 2] = fields.velocity[1] / VELOCITY_RANGE * 0.5 + 0.5;
    initialState0[index * 4 + 3] = fields.velocity[2] / VELOCITY_RANGE * 0.5 + 0.5;
    initialState1[index * 4] = fields.surfactant;
    initialState1[index * 4 + 1] = fields.temperature / TEMPERATURE_RANGE * 0.5 + 0.5;

    const neighbors = [...cotangentWeights[index].entries()];
    if (neighbors.length > 6) throw new Error("Icosphere vertex degree exceeds six");
    neighbors.forEach(([neighbor, cotWeight], slot) => {
      const cosine = Math.max(-1, Math.min(1, dot(normal, vertices[neighbor])));
      const distance = Math.acos(cosine);
      const laplacianWeight = cotWeight / dualAreas[index];
      const fluxWeight = cotWeight * distance / dualAreas[index];
      const texelOffset = ((slot * textureHeight + texelY) * textureWidth + texelX) * 4;
      neighborTexels[texelOffset] = neighbor;
      neighborTexels[texelOffset + 1] = laplacianWeight;
      neighborTexels[texelOffset + 2] = fluxWeight;
      neighborTexels[texelOffset + 3] = distance;
    });
  }

  return {
    positions,
    indices: new Uint32Array(faces.flat()),
    stateUvs,
    positionTexels,
    neighborTexels,
    initialState0,
    initialState1,
    textureWidth,
    textureHeight,
    vertexCount,
  };
}
