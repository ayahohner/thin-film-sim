"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Parameters = {
  thickness: number;
  variation: number;
  refractiveIndex: number;
  gravity: number;
  surfaceTension: number;
  viscosity: number;
  marangoni: number;
  surfactantDiffusion: number;
  saturation: number;
  speed: number;
};

const DEFAULTS: Parameters = {
  thickness: 520,
  variation: 360,
  refractiveIndex: 1.33,
  gravity: 0.42,
  surfaceTension: 0.62,
  viscosity: 0.34,
  marangoni: 0.78,
  surfactantDiffusion: 0.18,
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
uniform float u_dt;
uniform float u_gravity;
uniform float u_surfaceTension;
uniform float u_viscosity;
uniform float u_marangoni;
uniform float u_diffusion;
uniform vec2 u_pointer;
uniform vec2 u_pointerVelocity;
uniform float u_pointerDown;

const float PI = 3.14159265359;
const float VMAX = 0.32;

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

vec2 decodeVelocity(vec4 state) {
  return (state.gb * 2.0 - 1.0) * VMAX;
}

vec2 encodeVelocity(vec2 velocity) {
  return clamp(velocity / VMAX * 0.5 + 0.5, 0.0, 1.0);
}

float metric(vec2 uv) {
  return max(0.22, sin(PI * clamp(uv.y, 0.0, 1.0)));
}

vec2 coordinateVelocity(vec2 physicalVelocity, vec2 uv) {
  return vec2(physicalVelocity.x / metric(uv), physicalVelocity.y);
}

float heightAt(vec2 uv) { return sampleSphere(uv).r; }
float gammaAt(vec2 uv) { return sampleSphere(uv).a; }
vec2 velocityAt(vec2 uv) { return decodeVelocity(sampleSphere(uv)); }

float lapHeight(vec2 uv) {
  float m = metric(uv);
  float h = heightAt(uv);
  float lon = (heightAt(uv + vec2(u_texel.x,0)) + heightAt(uv - vec2(u_texel.x,0)) - 2.0 * h) / (m * m);
  float lat = heightAt(uv + vec2(0,u_texel.y)) + heightAt(uv - vec2(0,u_texel.y)) - 2.0 * h;
  return lon + lat;
}

void main() {
  vec2 uv = v_uv;
  vec4 center = sampleSphere(uv);
  vec4 stateL = sampleSphere(uv - vec2(u_texel.x,0));
  vec4 stateR = sampleSphere(uv + vec2(u_texel.x,0));
  vec4 stateB = sampleSphere(uv - vec2(0,u_texel.y));
  vec4 stateT = sampleSphere(uv + vec2(0,u_texel.y));

  float h = center.r;
  vec2 velocity = decodeVelocity(center);
  vec2 velocityL = decodeVelocity(stateL);
  vec2 velocityR = decodeVelocity(stateR);
  vec2 velocityB = decodeVelocity(stateB);
  vec2 velocityT = decodeVelocity(stateT);
  float m = metric(uv);
  float mB = metric(uv - vec2(0,u_texel.y));
  float mT = metric(uv + vec2(0,u_texel.y));

  // Conservative surface mass equation: d_t h + div_s(h u) = 0.
  float divMass = (stateR.r * velocityR.x - stateL.r * velocityL.x) / (2.0 * u_texel.x * m);
  divMass += (mT * stateT.r * velocityT.y - mB * stateB.r * velocityB.y) / (2.0 * u_texel.y * m);
  float newHeight = h - u_dt * divMass;

  // Surface divergence couples stretching to the surfactant/tension field.
  float divVelocity = (velocityR.x - velocityL.x) / (2.0 * u_texel.x * m);
  divVelocity += (mT * velocityT.y - mB * velocityB.y) / (2.0 * u_texel.y * m);

  vec2 gradGamma = vec2(
    (stateR.a - stateL.a) / (2.0 * u_texel.x * m),
    (stateT.a - stateB.a) / (2.0 * u_texel.y)
  );
  vec2 gradLapH = vec2(
    (lapHeight(uv + vec2(u_texel.x,0)) - lapHeight(uv - vec2(u_texel.x,0))) / (2.0 * u_texel.x * m),
    (lapHeight(uv + vec2(0,u_texel.y)) - lapHeight(uv - vec2(0,u_texel.y))) / (2.0 * u_texel.y)
  );
  vec2 lapVelocity = velocityL + velocityR + velocityB + velocityT - 4.0 * velocity;

  // Reduced thin-film momentum: Marangoni stress + capillary pressure +
  // Trouton viscosity + tangential gravity on the spherical shell.
  vec2 force = u_marangoni * 0.0045 * gradGamma / max(h, 0.045);
  force += u_surfaceTension * 0.0016 * h * gradLapH;
  force += u_viscosity * 2.8 * lapVelocity;
  force.y -= u_gravity * 0.055 * cos(PI * (uv.y - 0.5));

  vec2 pointerDelta = uv - u_pointer;
  pointerDelta.x = mod(pointerDelta.x + 0.5, 1.0) - 0.5;
  float pointerInfluence = exp(-dot(pointerDelta, pointerDelta) * 82.0) * u_pointerDown;
  force += u_pointerVelocity * pointerInfluence * 2.4;

  // Midpoint characteristic backtrace: a compact flow-map-style transport
  // step that reduces first-order semi-Lagrangian dissipation.
  vec2 halfVelocity = velocity + 0.5 * u_dt * force;
  vec2 midpoint = sphereUv(uv - 0.5 * u_dt * coordinateVelocity(halfVelocity, uv));
  vec2 midpointVelocity = velocityAt(midpoint);
  vec2 source = sphereUv(uv - u_dt * coordinateVelocity(midpointVelocity, midpoint));
  vec4 advected = sampleSphere(source);
  vec2 newVelocity = decodeVelocity(advected) + u_dt * force;

  float viscousDrag = exp(-u_viscosity * u_dt * (0.12 + 0.018 / max(h*h, 0.01)));
  newVelocity *= viscousDrag;
  newVelocity = clamp(newVelocity, vec2(-VMAX), vec2(VMAX));

  float gammaL = stateL.a;
  float gammaR = stateR.a;
  float gammaB = stateB.a;
  float gammaT = stateT.a;
  float lapGamma = gammaL + gammaR + gammaB + gammaT - 4.0 * center.a;
  float newGamma = advected.a + u_dt * 0.012 * u_marangoni * divVelocity / max(h, 0.05);
  newGamma += u_dt * u_diffusion * 2.5 * lapGamma;

  // A small positive floor represents the stable common-black-film scale;
  // no separate island mask exists anywhere in the state.
  newHeight = clamp(newHeight, 0.018, 0.98);
  newGamma = clamp(newGamma, 0.08, 0.92);
  outColor = vec4(newHeight, encodeVelocity(newVelocity), newGamma);
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
  vec4 state = sphereState(bubbleUv);
  float bottomMeniscus = pow(max(0.0, 1.0 - bubbleUv.y), 5.0) * 0.12;
  float relativeHeight = state.r - 0.54 + bottomMeniscus;
  float thickness = max(7.0, u_thickness + relativeHeight * u_variation * 3.1);

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
  transmitted += vec3(0.025, 0.032, 0.042) * (0.32 + diffuse) * (0.72 + state.a * 0.28);
  vec3 film = spectral * (1.25 + edge * 2.15);
  film += broadSpec * vec3(0.10,0.115,0.13);
  film += keySpec * vec3(1.45, 1.40, 1.28);
  film += fillSpec * vec3(0.55, 0.67, 0.82);
  film += studioStrip * vec3(0.24, 0.28, 0.31) * (0.45 + edge);
  film += lowerStrip * vec3(0.10, 0.15, 0.22) * (0.35 + edge);
  film *= 0.90 + 0.10 * z;
  vec3 color = transmitted + film;

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
  const pointerRef = useRef({ x: 0.5, y: 0.5, vx: 0, vy: 0, down: 0, lastTime: 0 });
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

      const simSize = window.innerWidth < 700 ? 144 : 192;
      const floatState = Boolean(gl.getExtension("EXT_color_buffer_float") && gl.getExtension("OES_texture_float_linear"));
      const textures = [gl.createTexture()!, gl.createTexture()!];
      const frames = [gl.createFramebuffer()!, gl.createFramebuffer()!];
      const seedFloat = new Float32Array(simSize * simSize * 4);
      for (let y = 0; y < simSize; y++) for (let x = 0; x < simSize; x++) {
        const i = (y * simSize + x) * 4;
        const u = x / simSize;
        const v = y / simSize;
        const depositedFilm = 0.54 + (0.5 - v) * 0.11
          + Math.sin(u * Math.PI * 4 + 0.7) * Math.sin(v * Math.PI) * 0.032
          + Math.sin((u * 7 - v * 3) * Math.PI) * 0.014;
        const surfaceTension = 0.5
          + Math.sin(u * Math.PI * 6 + v * Math.PI * 2) * 0.028
          + Math.cos(u * Math.PI * 2 - v * Math.PI * 5) * 0.016;
        seedFloat[i] = depositedFilm;
        seedFloat[i+1] = 0.5;
        seedFloat[i+2] = 0.5;
        seedFloat[i+3] = surfaceTension;
      }
      const seedBytes = new Uint8Array(seedFloat.length);
      for (let i = 0; i < seedFloat.length; i++) seedBytes[i] = Math.round(Math.max(0, Math.min(1, seedFloat[i])) * 255);
      const seed = floatState ? seedFloat : seedBytes;
      const internalFormat = floatState ? gl.RGBA16F : gl.RGBA;
      const stateType = floatState ? gl.FLOAT : gl.UNSIGNED_BYTE;
      textures.forEach((texture, index) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, simSize, simSize, 0, gl.RGBA, stateType, seed);
        gl.bindFramebuffer(gl.FRAMEBUFFER, frames[index]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      });

      let read = 0;
      resetRef.current = () => {
        textures.forEach((texture) => {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simSize, simSize, gl.RGBA, stateType, seed);
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
          const substeps = Math.max(1, Math.ceil(acceleratedElapsed / 0.022));
          const stepDt = acceleratedElapsed / substeps;
          gl.useProgram(simProgram);
          gl.viewport(0, 0, simSize, simSize);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(uniform(simProgram, "u_state"), 0);
          gl.uniform2f(uniform(simProgram, "u_texel"), 1/simSize, 1/simSize);
          gl.uniform1f(uniform(simProgram, "u_gravity"), p.gravity);
          gl.uniform1f(uniform(simProgram, "u_surfaceTension"), p.surfaceTension);
          gl.uniform1f(uniform(simProgram, "u_viscosity"), p.viscosity);
          gl.uniform1f(uniform(simProgram, "u_marangoni"), p.marangoni);
          gl.uniform1f(uniform(simProgram, "u_diffusion"), p.surfactantDiffusion);
          gl.uniform2f(uniform(simProgram, "u_pointer"), pointerRef.current.x, pointerRef.current.y);
          gl.uniform2f(uniform(simProgram, "u_pointerVelocity"), pointerRef.current.vx, pointerRef.current.vy);
          gl.uniform1f(uniform(simProgram, "u_pointerDown"), pointerRef.current.down);
          for (let step = 0; step < substeps; step++) {
            simTime += stepDt;
            gl.bindFramebuffer(gl.FRAMEBUFFER, frames[1-read]);
            gl.bindTexture(gl.TEXTURE_2D, textures[read]);
            gl.uniform1f(uniform(simProgram, "u_dt"), stepDt);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            read = 1-read;
          }
          pointerRef.current.vx *= 0.72;
          pointerRef.current.vy *= 0.72;
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
    const x = Math.atan2(nx, nz) / (Math.PI * 2) + 0.5;
    const y = Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI + 0.5;
    const previous = pointerRef.current;
    const eventTime = event.timeStamp / 1000;
    const deltaTime = Math.max(0.008, eventTime - previous.lastTime);
    let deltaX = x - previous.x;
    if (deltaX > 0.5) deltaX -= 1;
    if (deltaX < -0.5) deltaX += 1;
    const active = (down ?? previous.down) > 0 && previous.lastTime > 0;
    pointerRef.current = {
      x,
      y,
      vx: active ? Math.max(-0.28, Math.min(0.28, deltaX / deltaTime)) : 0,
      vy: active ? Math.max(-0.28, Math.min(0.28, (y - previous.y) / deltaTime)) : 0,
      down: down ?? previous.down,
      lastTime: eventTime,
    };
  };

  const preset = (name: "fresh" | "draining" | "black") => {
    const next = name === "fresh" ? { ...DEFAULTS, thickness: 760, variation: 310, gravity: 0.18, viscosity: 0.42 }
      : name === "draining" ? { ...DEFAULTS, thickness: 360, variation: 420, gravity: 0.92, viscosity: 0.28, marangoni: 0.64 }
      : { ...DEFAULTS, thickness: 110, variation: 220, gravity: 0.66, viscosity: 0.48, marangoni: 0.58, speed: 2.2, saturation: 0.94 };
    setParams(next);
    resetRef.current();
  };

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span>BUBBLE FILM LAB</span></div>
        <div className="status"><span className="status-dot" /> COUPLED THIN-FILM SOLVER</div>
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
            <button onClick={() => preset("black")}>Aged film</button>
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
            <Range label="Tangential gravity" value={params.gravity} min={0} max={1.5} step={0.01} onChange={v => set("gravity", v)} />
            <Range label="Surface tension" value={params.surfaceTension} min={0} max={1.5} step={0.01} onChange={v => set("surfaceTension", v)} />
            <Range label="Film viscosity" value={params.viscosity} min={0.02} max={1.5} step={0.01} onChange={v => set("viscosity", v)} />
            <Range label="Marangoni elasticity" value={params.marangoni} min={0} max={2} step={0.01} onChange={v => set("marangoni", v)} />
            <Range label="Surfactant diffusion" value={params.surfactantDiffusion} min={0} max={1} step={0.01} onChange={v => set("surfactantDiffusion", v)} />
            <Range label="Time scale" value={params.speed} min={0.1} max={12} step={0.1} unit="×" onChange={v => set("speed", v)} />
          </div>
          <button className="reset-button" onClick={() => { setParams(DEFAULTS); resetRef.current(); }}>Reset experiment <span>↺</span></button>
          <details className="formula-card">
            <summary>What is being calculated? <span>+</span></summary>
            <p>The GPU evolves <em>h, u, v, γ</em>: thickness, two tangent-velocity components, and surface tension. Conservative mass flux couples to capillary pressure, Marangoni stress, viscosity, and gravity. Black film is not a separate effect—it appears only when the solved thickness falls below the visible interference range.</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
