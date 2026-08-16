export const FULLSCREEN_TRIANGLES = new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1,
]);

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate shader program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Shader linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export function uniformLocations<const T extends readonly string[]>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: T,
) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as {
    [K in T[number]]: WebGLUniformLocation | null;
  };
}

const CHART_EXTENT = 1.22;
const VELOCITY_RANGE = 0.28;

function normalize(vector: readonly number[]) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return vector.map((component) => component / length) as [number, number, number];
}

function cubeDirection(face: number, s: number, t: number) {
  const chartS = s * CHART_EXTENT;
  const chartT = t * CHART_EXTENT;
  const vector = face === 0 ? [1, chartT, -chartS]
    : face === 1 ? [-1, chartT, chartS]
    : face === 2 ? [chartS, 1, -chartT]
    : face === 3 ? [chartS, -1, chartT]
    : face === 4 ? [chartS, chartT, 1]
    : [-chartS, chartT, -1];
  return normalize(vector);
}

function faceBasis(direction: readonly number[], face: number) {
  const derivative = face === 0 ? [0, 0, -1]
    : face === 1 ? [0, 0, 1]
    : face === 5 ? [-1, 0, 0]
    : [1, 0, 0];
  const projection = derivative[0] * direction[0]
    + derivative[1] * direction[1]
    + derivative[2] * direction[2];
  const tangentA = normalize([
    derivative[0] - direction[0] * projection,
    derivative[1] - direction[1] * projection,
    derivative[2] - direction[2] * projection,
  ]);
  const tangentB: [number, number, number] = [
    direction[1] * tangentA[2] - direction[2] * tangentA[1],
    direction[2] * tangentA[0] - direction[0] * tangentA[2],
    direction[0] * tangentA[1] - direction[1] * tangentA[0],
  ];
  return { tangentA, tangentB };
}

export function createInitialState(faceSize: number) {
  const width = faceSize * 3;
  const height = faceSize * 2;
  const state = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const faceColumn = Math.floor(x / faceSize);
      const faceRow = Math.floor(y / faceSize);
      const face = faceColumn + faceRow * 3;
      const s = (((x % faceSize) + 0.5) / faceSize) * 2 - 1;
      const t = (((y % faceSize) + 0.5) / faceSize) * 2 - 1;
      const direction = cubeDirection(face, s, t);
      const [dx, dy, dz] = direction;
      const patchA = Math.exp(-8.5 * (1 - (dx * 0.58 + dy * 0.31 + dz * 0.75)));
      const patchB = Math.exp(-10 * (1 - (-dx * 0.73 + dy * 0.54 + dz * 0.42)));
      state[index] = 0.555 - dy * 0.056
        + dx * dz * 0.038
        + (dx * dx - dz * dz) * 0.022
        + dy * (3 * dz * dz - 1) * 0.018
        + patchA * 0.026 - patchB * 0.021;

      const gravityVelocity = [dx * dy, -1 + dy * dy, dz * dy] as const;
      const { tangentA, tangentB } = faceBasis(direction, face);
      const velocity = gravityVelocity.map((component) => component * 0.018);
      const componentA = velocity[0] * tangentA[0]
        + velocity[1] * tangentA[1]
        + velocity[2] * tangentA[2];
      const componentB = velocity[0] * tangentB[0]
        + velocity[1] * tangentB[1]
        + velocity[2] * tangentB[2];
      state[index + 1] = componentA / VELOCITY_RANGE * 0.5 + 0.5;
      state[index + 2] = componentB / VELOCITY_RANGE * 0.5 + 0.5;
      state[index + 3] = 0.5
        + dx * dz * 0.052
        + dy * (dx * dx - dz * dz) * 0.038
        - patchA * 0.024 + patchB * 0.018;
    }
  }
  return { state, width, height };
}
