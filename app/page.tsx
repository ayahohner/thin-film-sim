"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Parameters = {
  thickness: number;
  variation: number;
  refractiveIndex: number;
  drainage: number;
  tension: number;
  flow: number;
  lightAngle: number;
  saturation: number;
  speed: number;
};

const DEFAULTS: Parameters = {
  thickness: 520,
  variation: 360,
  refractiveIndex: 1.33,
  drainage: 0.36,
  tension: 0.42,
  flow: 0.68,
  lightAngle: -28,
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

float field(vec2 p) {
  return noise(p * 3.1 + vec2(u_time * 0.055, -u_time * 0.035))
       + 0.46 * noise(p * 7.3 - vec2(u_time * 0.10, u_time * 0.045));
}

void main() {
  vec2 uv = v_uv;
  float e = 0.012;
  float nx = field(uv + vec2(e, 0.0)) - field(uv - vec2(e, 0.0));
  float ny = field(uv + vec2(0.0, e)) - field(uv - vec2(0.0, e));
  vec2 velocity = vec2(ny, -nx) * (0.64 * u_flow);
  velocity.y -= u_gravity * (0.075 + 0.075 * (1.0 - uv.y));

  vec2 d = uv - u_pointer;
  float influence = exp(-dot(d, d) * 56.0) * u_pointerDown;
  velocity += vec2(-d.y, d.x) * influence * 7.0;

  vec2 source = clamp(uv - velocity * u_dt, u_texel, 1.0 - u_texel);
  float h = texture(u_state, source).r;
  float l = texture(u_state, clamp(source - vec2(u_texel.x,0),0.0,1.0)).r;
  float r = texture(u_state, clamp(source + vec2(u_texel.x,0),0.0,1.0)).r;
  float b = texture(u_state, clamp(source - vec2(0,u_texel.y),0.0,1.0)).r;
  float t = texture(u_state, clamp(source + vec2(0,u_texel.y),0.0,1.0)).r;
  float laplacian = l + r + b + t - 4.0 * h;

  h += laplacian * u_tension * 0.15;
  h -= u_gravity * u_dt * (0.003 + 0.005 * uv.y);
  h += u_gravity * u_dt * smoothstep(0.22, 0.0, uv.y) * 0.028;
  h += (0.5 - h) * u_dt * 0.003;
  outColor = vec4(clamp(h, 0.015, 0.985), 0.0, 0.0, 1.0);
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
uniform float u_lightAngle;
uniform float u_saturation;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.97))) * 9173.21); }

float interference(float lambda, float thickness, float cosTheta) {
  float phase = 12.5663706 * u_ior * thickness * cosTheta / lambda + 3.14159265;
  return 0.5 + 0.5 * cos(phase);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 q = uv - 0.5;
  q.x *= aspect;
  float radius = min(0.425 * aspect, 0.455);
  float r2 = dot(q, q) / (radius * radius);
  float grain = hash(gl_FragCoord.xy + floor(u_time * 2.0));

  vec3 backdrop = vec3(0.012, 0.017, 0.026);
  float glow = exp(-dot(q - vec2(-0.22, 0.18), q - vec2(-0.22, 0.18)) * 3.2);
  backdrop += vec3(0.016, 0.029, 0.045) * glow;
  backdrop += (grain - 0.5) * 0.006;

  if (r2 > 1.0) {
    float halo = exp(-abs(sqrt(r2) - 1.0) * 28.0) * 0.07;
    outColor = vec4(backdrop + halo * vec3(0.2, 0.5, 0.8), 1.0);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 normal = normalize(vec3(q / radius, z));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float cosView = max(dot(normal, viewDir), 0.0);
  float sinInternal2 = max(0.0, 1.0 - cosView * cosView) / (u_ior * u_ior);
  float cosInternal = sqrt(max(0.04, 1.0 - sinInternal2));

  vec2 bubbleUv = q / (2.0 * radius) + 0.5;
  float state = texture(u_state, clamp(bubbleUv, 0.0, 1.0)).r;
  float bottomMeniscus = pow(max(0.0, 1.0 - bubbleUv.y), 5.0) * 0.24;
  float thickness = max(8.0, u_thickness + (state - 0.5 + bottomMeniscus) * u_variation * 2.0);

  vec3 spectral = vec3(
    interference(650.0, thickness, cosInternal),
    interference(535.0, thickness, cosInternal),
    interference(455.0, thickness, cosInternal)
  );
  spectral = pow(spectral, vec3(1.35));
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  float f0 = pow((u_ior - 1.0) / (u_ior + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosView, 5.0);
  float angle = radians(u_lightAngle);
  vec3 lightDir = normalize(vec3(sin(angle), 0.42, cos(angle)));
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 180.0);
  float broadSpec = pow(max(dot(normal, halfDir), 0.0), 24.0);

  float edge = smoothstep(0.72, 1.0, sqrt(r2));
  vec3 transmitted = backdrop * (0.76 + 0.18 * z);
  vec3 film = spectral * (0.18 + fresnel * 1.35) + broadSpec * vec3(0.08,0.10,0.12);
  film += spec * vec3(1.25, 1.20, 1.08);
  film += edge * vec3(0.08, 0.11, 0.15);
  film *= 0.78 + 0.22 * z;
  vec3 color = transmitted + film;

  float rim = smoothstep(0.955, 0.995, sqrt(r2));
  color += rim * vec3(0.24, 0.34, 0.46);
  color += (grain - 0.5) * 0.012;
  outColor = vec4(pow(max(color, 0.0), vec3(0.86)), 1.0);
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
    if (!gl) { setAvailable(false); return; }

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

      const simSize = 320;
      const textures = [gl.createTexture()!, gl.createTexture()!];
      const frames = [gl.createFramebuffer()!, gl.createFramebuffer()!];
      const seed = new Uint8Array(simSize * simSize * 4);
      for (let y = 0; y < simSize; y++) for (let x = 0; x < simSize; x++) {
        const i = (y * simSize + x) * 4;
        const waves = Math.sin(x * 0.071) * Math.cos(y * 0.053) + Math.sin((x+y) * 0.026);
        const value = Math.max(8, Math.min(247, 126 + waves * 23 + Math.random() * 11 + (1-y/simSize) * 18));
        seed[i] = value; seed[i+1] = 0; seed[i+2] = 0; seed[i+3] = 255;
      }
      textures.forEach((texture, index) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
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
        const elapsed = Math.min(0.033, (now - last) / 1000) * p.speed;
        last = now;
        if (!pausedRef.current) {
          simTime += elapsed;
          gl.useProgram(simProgram);
          gl.bindFramebuffer(gl.FRAMEBUFFER, frames[1-read]);
          gl.viewport(0, 0, simSize, simSize);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, textures[read]);
          gl.uniform1i(uniform(simProgram, "u_state"), 0);
          gl.uniform2f(uniform(simProgram, "u_texel"), 1/simSize, 1/simSize);
          gl.uniform1f(uniform(simProgram, "u_time"), simTime);
          gl.uniform1f(uniform(simProgram, "u_dt"), elapsed);
          gl.uniform1f(uniform(simProgram, "u_flow"), p.flow);
          gl.uniform1f(uniform(simProgram, "u_gravity"), p.drainage);
          gl.uniform1f(uniform(simProgram, "u_tension"), p.tension);
          gl.uniform2f(uniform(simProgram, "u_pointer"), pointerRef.current.x, pointerRef.current.y);
          gl.uniform1f(uniform(simProgram, "u_pointerDown"), pointerRef.current.down);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          read = 1-read;
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
        gl.uniform1f(uniform(drawProgram, "u_lightAngle"), p.lightAngle);
        gl.uniform1f(uniform(drawProgram, "u_saturation"), p.saturation);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animation = requestAnimationFrame(render);
      };
      animation = requestAnimationFrame(render);
      return () => cancelAnimationFrame(animation);
    } catch (error) {
      console.error(error);
      setAvailable(false);
    }
  }, []);

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>, down?: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: (event.clientX - rect.left) / rect.width,
      y: 1 - (event.clientY - rect.top) / rect.height,
      down: down ?? pointerRef.current.down,
    };
  };

  const preset = (name: "fresh" | "draining" | "black") => {
    const next = name === "fresh" ? { ...DEFAULTS, thickness: 740, variation: 410, drainage: 0.18 }
      : name === "draining" ? { ...DEFAULTS, thickness: 370, variation: 300, drainage: 0.78, flow: 0.82 }
      : { ...DEFAULTS, thickness: 72, variation: 58, drainage: 0.18, flow: 0.24, saturation: 0.9 };
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
          <div className="stage-copy">
            <p className="eyebrow">THIN-FILM INTERFERENCE / ADVECTION-DIFFUSION</p>
            <h1>Light, flowing<br />over a surface.</h1>
            <p className="intro">A living model of a soap film: thickness is advected by a curl field, drained by gravity, smoothed by surface tension, then translated into color wavelength by wavelength.</p>
          </div>
          <div className="drag-hint"><span>↗</span> DRAG THE FILM TO STIR</div>
          <div className="readout thickness-readout"><span>MEAN FILM</span><strong>{params.thickness.toFixed(0)} nm</strong></div>
          <div className="readout order-readout"><span>OPTICAL PATH</span><strong>{(2 * params.refractiveIndex * params.thickness).toFixed(0)} nm</strong></div>
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
            <Range label="Light angle" value={params.lightAngle} min={-70} max={70} step={1} unit="°" onChange={v => set("lightAngle", v)} />
            <Range label="Color response" value={params.saturation} min={0} max={1.6} step={0.01} onChange={v => set("saturation", v)} />
          </div>
          <div className="control-group">
            <h3>Fluid model</h3>
            <Range label="Gravity drainage" value={params.drainage} min={0} max={1.2} step={0.01} onChange={v => set("drainage", v)} />
            <Range label="Surface tension" value={params.tension} min={0} max={1} step={0.01} onChange={v => set("tension", v)} />
            <Range label="Flow energy" value={params.flow} min={0} max={1.4} step={0.01} onChange={v => set("flow", v)} />
            <Range label="Time scale" value={params.speed} min={0.1} max={2.5} step={0.1} unit="×" onChange={v => set("speed", v)} />
          </div>
          <button className="reset-button" onClick={() => { setParams(DEFAULTS); resetRef.current(); }}>Reset experiment <span>↺</span></button>
          <details className="formula-card">
            <summary>What is being calculated? <span>+</span></summary>
            <p>For each RGB wavelength, reflected intensity follows <em>I ∝ 1 + cos(4πnt cos θ / λ + π)</em>. The extra π is the phase reversal at the first air–film boundary.</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
