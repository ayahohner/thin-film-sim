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

export function createInitialState(size: number) {
  const state = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
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
  return state;
}
