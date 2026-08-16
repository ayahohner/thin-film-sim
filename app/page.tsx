"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Parameters = {
  thickness: number;
  variation: number;
  refractiveIndex: number;
  drainage: number;
  tension: number;
  flow: number;
  convection: number;
  microFilm: number;
  saturation: number;
  speed: number;
};

const DEFAULTS: Parameters = {
  thickness: 520,
  variation: 360,
  refractiveIndex: 1.33,
  drainage: 0.36,
  tension: 0.42,
  flow: 0.9,
  convection: 0.9,
  microFilm: 0.9,
  saturation: 1.08,
  speed: 1,
};

const vertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const simulationShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_time;
uniform float u_dt;
uniform float u_flow;
uniform float u_gravity;
uniform float u_tension;
uniform float u_convection;
uniform float u_microFilm;
uniform vec2 u_pointer;
uniform float u_pointerDown;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float turbulence(vec2 p) {
  return noise(p * 3.1 + vec2(u_time * 0.045, -u_time * 0.028))
       + 0.48 * noise(p * 7.4 - vec2(u_time * 0.075, u_time * 0.04))
       + 0.20 * noise(p * 15.3 + vec2(-u_time * 0.055, u_time * 0.08));
}

vec2 sphereUv(vec2 uv) {
  float x = uv.x;
  float y = uv.y;
  if (y < 0.0) { y = -y; x += 0.5; }
  if (y > 1.0) { y = 2.0 - y; x += 0.5; }
  return vec2(fract(x), clamp(y, 0.0, 1.0));
}

vec4 sampleSphere(vec2 uv) {
  return texture(u_state, sphereUv(uv));
}

float cellularVar(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 2.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 point = vec2(hash(cell + offset + seed), hash(cell + offset + 19.73 + seed));
      point = 0.5 + 0.42 * sin(u_time * (0.08 + 0.05 * point) + 6.2831 * point);
      float radius = 0.48 + 1.45 * hash(cell + offset + vec2(31.7, 83.1) + seed);
      nearest = min(nearest, length(offset + point - local) / radius);
    }
  }
  return nearest;
}

void main() {
  vec2 uv = v_uv;
  vec4 center = sampleSphere(uv);
  vec4 leftState = sampleSphere(uv - vec2(u_texel.x,0));
  vec4 rightState = sampleSphere(uv + vec2(u_texel.x,0));
  vec4 bottomState = sampleSphere(uv - vec2(0,u_texel.y));
  vec4 topState = sampleSphere(uv + vec2(0,u_texel.y));

  float e = 0.009;
  float nx = turbulence(uv + vec2(e, 0.0)) - turbulence(uv - vec2(e, 0.0));
  float ny = turbulence(uv + vec2(0.0, e)) - turbulence(uv - vec2(0.0, e));
  vec2 velocity = vec2(ny, -nx) * (0.42 * u_flow);

  // Incompressible convection rolls from a slowly changing stream function.
  float phase = u_time * 0.11;
  float sx = 6.2831 * uv.x + phase;
  float sy = 3.1416 * uv.y;
  vec2 rolls = vec2(
    3.1416 * sin(sx) * cos(sy),
    -6.2831 * cos(sx) * sin(sy)
  ) * 0.018;
  float sx2 = 12.5662 * uv.x - phase * 0.7 + 1.8;
  float sy2 = 6.2831 * uv.y;
  rolls += vec2(6.2831 * sin(sx2) * cos(sy2), -12.5662 * cos(sx2) * sin(sy2)) * 0.0045;
  velocity += rolls * u_convection;

  // Surfactant/temperature gradients produce Marangoni surface motion.
  vec2 scalarGradient = vec2(rightState.g - leftState.g, topState.g - bottomState.g);
  velocity -= scalarGradient * (1.6 * u_convection);
  velocity.y += (center.g - 0.5) * 0.11 * u_convection;
  velocity.y -= u_gravity * (0.045 + 0.11 * center.r * center.r);
  velocity.x /= max(0.34, sin(3.1416 * uv.y));

  vec2 d = uv - u_pointer;
  float influence = exp(-dot(d, d) * 54.0) * u_pointerDown;
  velocity += vec2(-d.y, d.x) * influence * 7.5;

  vec2 source = sphereUv(uv - velocity * u_dt);
  vec4 state = sampleSphere(source);
  float h = state.r;
  float scalar = state.g;
  float blackFilm = state.b;

  float hL = sampleSphere(source - vec2(u_texel.x,0)).r;
  float hR = sampleSphere(source + vec2(u_texel.x,0)).r;
  float hB = sampleSphere(source - vec2(0,u_texel.y)).r;
  float hT = sampleSphere(source + vec2(0,u_texel.y)).r;
  float lapH = hL + hR + hB + hT - 4.0 * h;
  float sL = sampleSphere(source - vec2(u_texel.x,0)).g;
  float sR = sampleSphere(source + vec2(u_texel.x,0)).g;
  float sB = sampleSphere(source - vec2(0,u_texel.y)).g;
  float sT = sampleSphere(source + vec2(0,u_texel.y)).g;
  float lapScalar = sL + sR + sB + sT - 4.0 * scalar;

  // Capillary leveling, nonlinear gravitational drainage, and lower meniscus.
  h += lapH * (0.08 + 0.18 * u_tension) * (0.55 + h);
  h -= u_gravity * u_dt * (0.002 + 0.012 * h * h) * (0.7 + uv.y);
  h += u_gravity * u_dt * smoothstep(0.24, 0.0, uv.y) * 0.055;
  h += scalarGradient.y * u_dt * 0.06 * u_convection;

  float heatSource = 0.5 + 0.20 * sin(6.2831 * uv.x + u_time * 0.08) * sin(3.1416 * uv.y);
  heatSource += 0.10 * (0.5 - uv.y) + 0.08 * (turbulence(uv * 0.7) - 0.7);
  scalar += lapScalar * (0.07 + 0.08 * u_tension);
  scalar += (heatSource - scalar) * u_dt * 0.035;

  // Ultra-thin common-black-film islands nucleate in drained upper regions.
  vec2 microWarp = vec2(turbulence(uv) * 0.34, -u_time * 0.028);
  float largeIslands = 1.0 - smoothstep(0.075, 0.24, cellularVar(uv * vec2(7.0, 9.0) + microWarp, 3.1));
  float mediumIslands = 1.0 - smoothstep(0.07, 0.22, cellularVar(uv * vec2(14.0, 16.0) - microWarp * 0.7, 11.7));
  float smallIslands = 1.0 - smoothstep(0.065, 0.20, cellularVar(uv * vec2(27.0, 30.0) + microWarp * 1.4, 29.4));
  float cell = max(largeIslands, max(mediumIslands * 0.92, smallIslands * 0.82));
  float thinEnough = 1.0 - smoothstep(0.46, 0.62, h);
  float upperFilm = smoothstep(0.34, 0.92, uv.y);
  float islandDensity = smoothstep(0.0, 3.0, u_microFilm);
  float islandPresence = smoothstep(0.92 - islandDensity * 0.62, 1.0, cell);
  float targetBlack = islandPresence * thinEnough * upperFilm;
  blackFilm += (targetBlack - blackFilm) * u_dt * mix(0.18, 0.78, targetBlack);
  blackFilm = clamp(blackFilm, 0.0, 1.0);
  h -= blackFilm * u_dt * 0.025;
  h += (0.5 - h) * u_dt * 0.0012;

  outColor = vec4(clamp(h, 0.012, 0.988), clamp(scalar, 0.02, 0.98), blackFilm, 1.0);
}`;

const displayShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_thickness;
uniform float u_variation;
uniform float u_ior;
uniform float u_saturation;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.97))) * 9173.21); }

vec4 sphereState(vec2 uv) {
  return texture(u_state, vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0)));
}

float filmReflectance(float lambda, float thickness, float cosTheta, float interfaceR) {
  float beta = 6.2831853 * u_ior * thickness * cosTheta / lambda;
  float s2 = pow(sin(beta), 2.0);
  float numerator = 4.0 * interfaceR * s2;
  float denominator = pow(1.0 - interfaceR, 2.0) + numerator;
  return numerator / max(denominator, 0.0001);
}

vec3 spectrum(float thickness, float cosTheta, float interfaceR) {
  vec3 color = vec3(0.0);
  color += filmReflectance(420.0, thickness, cosTheta, interfaceR) * vec3(0.34, 0.02, 0.90) * 0.74;
  color += filmReflectance(455.0, thickness, cosTheta, interfaceR) * vec3(0.08, 0.18, 1.00) * 0.92;
  color += filmReflectance(490.0, thickness, cosTheta, interfaceR) * vec3(0.00, 0.72, 0.82) * 1.02;
  color += filmReflectance(525.0, thickness, cosTheta, interfaceR) * vec3(0.08, 1.00, 0.25) * 1.05;
  color += filmReflectance(565.0, thickness, cosTheta, interfaceR) * vec3(0.75, 0.95, 0.02) * 1.03;
  color += filmReflectance(600.0, thickness, cosTheta, interfaceR) * vec3(1.00, 0.48, 0.00) * 0.98;
  color += filmReflectance(640.0, thickness, cosTheta, interfaceR) * vec3(1.00, 0.08, 0.01) * 0.91;
  color += filmReflectance(680.0, thickness, cosTheta, interfaceR) * vec3(0.72, 0.00, 0.02) * 0.72;
  return color * 0.42;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 q = uv - 0.5;
  q.x *= aspect;
  float radius = min(0.425 * aspect, 0.455);
  float r2 = dot(q, q) / (radius * radius);
  float grain = hash(gl_FragCoord.xy + floor(u_time * 1.7));

  vec3 backdrop = vec3(0.010, 0.014, 0.021);
  float glow = exp(-dot(q - vec2(-0.22, 0.18), q - vec2(-0.22, 0.18)) * 3.2);
  backdrop += vec3(0.014, 0.026, 0.041) * glow;
  backdrop += (grain - 0.5) * 0.004;

  if (r2 > 1.0) {
    outColor = vec4(backdrop, 1.0);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 normal = normalize(vec3(q / radius, z));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float cosView = max(dot(normal, viewDir), 0.0);
  float sinInternal2 = max(0.0, 1.0 - cosView * cosView) / (u_ior * u_ior);
  float cosInternal = sqrt(max(0.025, 1.0 - sinInternal2));

  vec2 bubbleUv = vec2(
    fract(atan(normal.x, normal.z) / 6.2831853 + 0.5),
    asin(clamp(normal.y, -1.0, 1.0)) / 3.14159265 + 0.5
  );
  vec2 stateTexel = vec2(1.0 / 256.0);
  vec4 state = sphereState(bubbleUv);
  float blackL = sphereState(bubbleUv - vec2(stateTexel.x,0)).b;
  float blackR = sphereState(bubbleUv + vec2(stateTexel.x,0)).b;
  float blackB = sphereState(bubbleUv - vec2(0,stateTexel.y)).b;
  float blackT = sphereState(bubbleUv + vec2(0,stateTexel.y)).b;
  float blackGradient = length(vec2(blackR - blackL, blackT - blackB));
  float blackFilm = smoothstep(0.12, 0.72, state.b);

  float bottomMeniscus = pow(max(0.0, 1.0 - bubbleUv.y), 5.0) * 0.28;
  float thickness = max(7.0, u_thickness + (state.r - 0.5 + bottomMeniscus) * u_variation * 2.0);
  thickness = mix(thickness, 11.0 + 7.0 * state.g, blackFilm);

  float f0 = pow((u_ior - 1.0) / (u_ior + 1.0), 2.0);
  float interfaceR = f0 + (1.0 - f0) * pow(1.0 - cosView, 5.0);
  vec3 spectral = spectrum(thickness, cosInternal, interfaceR);
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  vec3 keyDir = normalize(vec3(-0.46, 0.58, 0.72));
  vec3 fillDir = normalize(vec3(0.58, -0.18, 0.79));
  vec3 keyHalf = normalize(keyDir + viewDir);
  vec3 fillHalf = normalize(fillDir + viewDir);
  float keySpec = pow(max(dot(normal, keyHalf), 0.0), 170.0);
  float fillSpec = pow(max(dot(normal, fillHalf), 0.0), 105.0);
  float broadSpec = pow(max(dot(normal, keyHalf), 0.0), 22.0);
  float diffuse = max(dot(normal, keyDir), 0.0) * 0.62 + max(dot(normal, fillDir), 0.0) * 0.38;
  float studioStrip = pow(max(0.0, 1.0 - abs(normal.x + 0.57) * 2.7), 10.0) * smoothstep(-0.55, 0.8, normal.y);
  float lowerStrip = pow(max(0.0, 1.0 - abs(normal.y + 0.52) * 3.4), 12.0) * smoothstep(-0.1, 0.9, normal.x);

  float edge = smoothstep(0.72, 1.0, sqrt(r2));
  vec3 transmitted = backdrop * (0.88 + 0.08 * z);
  transmitted += vec3(0.025, 0.032, 0.042) * (0.32 + diffuse) * (0.65 + state.g * 0.35);
  vec3 film = spectral * (1.25 + edge * 2.15);
  film += broadSpec * vec3(0.10,0.115,0.13);
  film += keySpec * vec3(1.45, 1.40, 1.28);
  film += fillSpec * vec3(0.55, 0.67, 0.82);
  film += studioStrip * vec3(0.24, 0.28, 0.31) * (0.45 + edge);
  film += lowerStrip * vec3(0.10, 0.15, 0.22) * (0.35 + edge);
  film *= 0.90 + 0.10 * z;
  film *= mix(1.0, 0.08, blackFilm);
  vec3 color = transmitted + film;

  float microRim = smoothstep(0.018, 0.13, blackGradient) * (0.4 + 0.6 * edge);
  color += microRim * vec3(0.22, 0.28, 0.32);
  float rim = smoothstep(0.952, 0.997, sqrt(r2));
  color += rim * vec3(0.23, 0.31, 0.42);
  color += (grain - 0.5) * 0.009;
  outColor = vec4(pow(max(color, 0.0), vec3(0.84)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, fragment: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "Shader linking failed");
  }
  return p;
}

function Range({ label, value, min, max, step, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (value: number) => void;
}) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="control-row">
      <span className="control-heading"><span>{label}</span><output>{value.toFixed(decimals)}{unit}</output></span>
      <input type="range" min={min} max={max} step={step} value={value}
        aria-label={label} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(DEFAULTS);
  const pointerRef = useRef({ x: 0.5, y: 0.5, down: 0 });
  const resetRef = useRef<() => void>(() => {});
  const [params, setParams] = useState(DEFAULTS);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const set = useCallback((key: keyof Parameters, value: number) => {
    setParams((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) { queueMicrotask(() => setAvailable(false)); return; }

    try {
      const simProgram = program(gl, simulationShader);
      const drawProgram = program(gl, displayShader);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      for (const p of [simProgram, drawProgram]) {
        const loc = gl.getAttribLocation(p, "a_position");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }

      const simSize = 256;
      const textures = [gl.createTexture()!, gl.createTexture()!];
      const frames = [gl.createFramebuffer()!, gl.createFramebuffer()!];
      const seed = new Uint8Array(simSize * simSize * 4);
      for (let y = 0; y < simSize; y++) for (let x = 0; x < simSize; x++) {
        const i = (y * simSize + x) * 4;
        const waves = Math.sin(x * 0.071) * Math.cos(y * 0.053) + Math.sin((x+y) * 0.026);
        const value = Math.max(8, Math.min(247, 126 + waves * 23 + Math.random() * 11 + (1-y/simSize) * 18));
        const thermal = Math.max(12, Math.min(243, 126 + Math.sin(x * 0.028 + y * 0.017) * 34 + (0.5-y/simSize) * 24 + Math.random() * 9));
        seed[i] = value; seed[i+1] = thermal; seed[i+2] = 0; seed[i+3] = 255;
      }
      textures.forEach((texture, index) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, simSize, simSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
        gl.bindFramebuffer(gl.FRAMEBUFFER, frames[index]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      });

      let read = 0;
      resetRef.current = () => {
        textures.forEach((texture) => {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simSize, simSize, gl.RGBA, gl.UNSIGNED_BYTE, seed);
        });
      };
      const uniform = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
      let last = performance.now();
      let simTime = 0;
      let animation = 0;

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      };

      const render = (now: number) => {
        resize();
        const p = paramsRef.current;
        const frameElapsed = Math.min(0.033, (now - last) / 1000);
        last = now;
        if (!pausedRef.current) {
          const acceleratedElapsed = frameElapsed * p.speed;
          const substeps = Math.max(1, Math.ceil(acceleratedElapsed / 0.04));
          const stepDt = acceleratedElapsed / substeps;
          gl.useProgram(simProgram);
          gl.viewport(0, 0, simSize, simSize);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(uniform(simProgram, "u_state"), 0);
          gl.uniform2f(uniform(simProgram, "u_texel"), 1/simSize, 1/simSize);
          gl.uniform1f(uniform(simProgram, "u_flow"), p.flow);
          gl.uniform1f(uniform(simProgram, "u_gravity"), p.drainage);
          gl.uniform1f(uniform(simProgram, "u_tension"), p.tension);
          gl.uniform1f(uniform(simProgram, "u_convection"), p.convection);
          gl.uniform1f(uniform(simProgram, "u_microFilm"), p.microFilm);
          gl.uniform2f(uniform(simProgram, "u_pointer"), pointerRef.current.x, pointerRef.current.y);
          gl.uniform1f(uniform(simProgram, "u_pointerDown"), pointerRef.current.down);
          for (let step = 0; step < substeps; step++) {
            simTime += stepDt;
            gl.bindFramebuffer(gl.FRAMEBUFFER, frames[1-read]);
            gl.bindTexture(gl.TEXTURE_2D, textures[read]);
            gl.uniform1f(uniform(simProgram, "u_time"), simTime);
            gl.uniform1f(uniform(simProgram, "u_dt"), stepDt);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            read = 1-read;
          }
        }

        gl.useProgram(drawProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[read]);
        gl.uniform1i(uniform(drawProgram, "u_state"), 0);
        gl.uniform2f(uniform(drawProgram, "u_resolution"), canvas.width, canvas.height);
        gl.uniform1f(uniform(drawProgram, "u_time"), simTime);
        gl.uniform1f(uniform(drawProgram, "u_thickness"), p.thickness);
        gl.uniform1f(uniform(drawProgram, "u_variation"), p.variation);
        gl.uniform1f(uniform(drawProgram, "u_ior"), p.refractiveIndex);
        gl.uniform1f(uniform(drawProgram, "u_saturation"), p.saturation);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animation = requestAnimationFrame(render);
      };
      animation = requestAnimationFrame(render);
      return () => cancelAnimationFrame(animation);
    } catch (error) {
      console.error(error);
      queueMicrotask(() => setAvailable(false));
    }
  }, []);

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>, down?: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const screenU = (event.clientX - rect.left) / rect.width;
    const screenV = 1 - (event.clientY - rect.top) / rect.height;
    const aspect = rect.width / rect.height;
    const qx = (screenU - 0.5) * aspect;
    const qy = screenV - 0.5;
    const radius = Math.min(0.425 * aspect, 0.455);
    const radial = (qx * qx + qy * qy) / (radius * radius);
    if (radial > 1) {
      pointerRef.current = { ...pointerRef.current, down: down === 0 ? 0 : pointerRef.current.down };
      return;
    }
    const nx = qx / radius;
    const ny = qy / radius;
    const nz = Math.sqrt(Math.max(0, 1 - radial));
    pointerRef.current = {
      x: Math.atan2(nx, nz) / (Math.PI * 2) + 0.5,
      y: Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI + 0.5,
      down: down ?? pointerRef.current.down,
    };
  };

  const preset = (name: "fresh" | "draining" | "black") => {
    const next = name === "fresh" ? { ...DEFAULTS, thickness: 740, variation: 410, drainage: 0.18, microFilm: 0.18 }
      : name === "draining" ? { ...DEFAULTS, thickness: 350, variation: 330, drainage: 0.82, flow: 1.65, convection: 1.8, microFilm: 1.5 }
      : { ...DEFAULTS, thickness: 68, variation: 52, drainage: 0.2, flow: 0.55, convection: 0.72, microFilm: 2.7, saturation: 0.92 };
    setParams(next);
    resetRef.current();
  };

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span>BUBBLE FILM LAB</span></div>
        <div className="status"><span className="status-dot" /> LIVE GPU SIMULATION</div>
      </header>

      <section className="workspace">
        <div className="stage">
          <canvas ref={canvasRef} className="bubble-canvas"
            aria-label="Animated soap bubble thin-film interference simulation"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pointer(e, 1); }}
            onPointerMove={(e) => pointer(e)}
            onPointerUp={(e) => pointer(e, 0)} onPointerCancel={(e) => pointer(e, 0)} />
          {!available && <div className="webgl-fallback">This simulation needs a browser with WebGL 2 enabled.</div>}
        </div>

        <aside className="panel">
          <div className="panel-head"><div><p>CONTROL SURFACE</p><h2>Film parameters</h2></div><button className="pause-button" onClick={() => setPaused(v => !v)} aria-label={paused ? "Resume simulation" : "Pause simulation"}>{paused ? "▶" : "Ⅱ"}</button></div>
          <div className="presets" aria-label="Simulation presets">
            <button onClick={() => preset("fresh")}>Fresh film</button>
            <button onClick={() => preset("draining")}>Draining</button>
            <button onClick={() => preset("black")}>Black film</button>
          </div>
          <div className="control-group">
            <h3>Optics</h3>
            <Range label="Mean thickness" value={params.thickness} min={20} max={1200} step={1} unit=" nm" onChange={v => set("thickness", v)} />
            <Range label="Thickness variation" value={params.variation} min={0} max={600} step={1} unit=" nm" onChange={v => set("variation", v)} />
            <Range label="Refractive index" value={params.refractiveIndex} min={1.05} max={1.8} step={0.01} onChange={v => set("refractiveIndex", v)} />
            <Range label="Color response" value={params.saturation} min={0} max={1.6} step={0.01} onChange={v => set("saturation", v)} />
          </div>
          <div className="control-group">
            <h3>Fluid model</h3>
            <Range label="Gravity drainage" value={params.drainage} min={0} max={1.2} step={0.01} onChange={v => set("drainage", v)} />
            <Range label="Surface tension" value={params.tension} min={0} max={1} step={0.01} onChange={v => set("tension", v)} />
            <Range label="Turbulent flow" value={params.flow} min={0} max={4} step={0.01} onChange={v => set("flow", v)} />
            <Range label="Thermal convection" value={params.convection} min={0} max={4} step={0.01} onChange={v => set("convection", v)} />
            <Range label="Black-film islands" value={params.microFilm} min={0} max={3} step={0.01} onChange={v => set("microFilm", v)} />
            <Range label="Time scale" value={params.speed} min={0.1} max={12} step={0.1} unit="×" onChange={v => set("speed", v)} />
          </div>
          <button className="reset-button" onClick={() => { setParams(DEFAULTS); resetRef.current(); }}>Reset experiment <span>↺</span></button>
          <details className="formula-card">
            <summary>What is being calculated? <span>+</span></summary>
            <p>Eight visible wavelengths use the symmetric thin-film Airy reflectance. The local optical phase is <em>β = 2πnt cos θ / λ</em>; drained patches below roughly 20 nm become nearly transparent common black film.</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
