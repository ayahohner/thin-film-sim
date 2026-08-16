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

function cubeDirection(face: number, s: number, t: number) {
  const vector = face === 0 ? [1, t, -s]
    : face === 1 ? [-1, t, s]
    : face === 2 ? [s, 1, -t]
    : face === 3 ? [s, -1, t]
    : face === 4 ? [s, t, 1]
    : [-s, t, -1];
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return vector.map((component) => component / length) as [number, number, number];
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
      const u = Math.atan2(direction[0], direction[2]) / (Math.PI * 2) + 0.5;
      const v = Math.asin(direction[1]) / Math.PI + 0.5;
      state[index] = 0.54 + (0.5 - v) * 0.11
        + Math.sin(u * Math.PI * 4 + 0.7) * Math.sin(v * Math.PI) * 0.032
        + Math.sin((u * 7 - v * 3) * Math.PI) * 0.014;
      state[index + 1] = 0.5;
      state[index + 2] = 0.5;
      state[index + 3] = 0.5
        + Math.sin(u * Math.PI * 6 + v * Math.PI * 2) * 0.028
        + Math.cos(u * Math.PI * 2 - v * Math.PI * 5) * 0.016;
    }
  }
  return { state, width, height };
}
