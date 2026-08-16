import type { SimulationParameters } from "./model";
import {
  BUBBLE_RADIUS_METERS,
  decodeThicknessMicrons,
  physicalSurfaceSpeed,
  TEMPERATURE_RANGE,
  VELOCITY_RANGE,
} from "./physics";

export type DynamicsSample = {
  modelSeconds: number;
  wallSeconds: number;
  fps: number;
  gpuMilliseconds: number | null;
  meanThicknessNanometers: number;
  minimumThicknessNanometers: number;
  maximumThicknessNanometers: number;
  thicknessDeviationNanometers: number;
  thinAreaFraction: number;
  rmsSurfaceSpeedMillimetersPerSecond: number;
  maximumSurfaceSpeedMillimetersPerSecond: number;
  meanSurfactant: number;
  surfactantDeviation: number;
  minimumTemperatureKelvin: number;
  maximumTemperatureKelvin: number;
  cumulativeDroppedModelSeconds: number;
};

export type DynamicsFrame = {
  modelSeconds: number;
  image: string;
};

export type DynamicsReport = {
  generatedAt: string;
  meshVertices: number;
  meshTriangles: number;
  parameters: SimulationParameters;
  samples: DynamicsSample[];
  frames: DynamicsFrame[];
};

export type BubbleDiagnosticsApi = {
  ready: boolean;
  reset: () => void;
  pause: () => void;
  resume: () => void;
  setParameters: (parameters: Partial<SimulationParameters>) => void;
  setPreset: (name: "fresh" | "draining" | "aged") => void;
  capture: () => string | null;
  report: () => DynamicsReport | null;
};

declare global {
  interface Window {
    __bubbleFilmLab?: BubbleDiagnosticsApi;
  }
}

export function diagnosticsEnabled() {
  return new URLSearchParams(window.location.search).get("diagnostics") === "1";
}

export function captureTimesFromUrl() {
  const value = new URLSearchParams(window.location.search).get("captures");
  const parsed = (value ?? "0,2,5,10,20,40")
    .split(",")
    .map(Number)
    .filter((time) => Number.isFinite(time) && time >= 0)
    .sort((a, b) => a - b);
  return [...new Set(parsed)];
}

type ReadbackOptions = {
  gl: WebGL2RenderingContext;
  framebuffer: WebGLFramebuffer;
  floatingPoint: boolean;
  width: number;
  height: number;
  vertexCount: number;
  dualAreas: Float32Array;
  modelSeconds: number;
  wallSeconds: number;
  fps: number;
  gpuMilliseconds: number | null;
  droppedSeconds: number;
};

/*
 * Full-state readback is deliberately diagnostic-only. Area weighting uses the
 * manifold dual cells, so reported mass and RMS statistics are independent of
 * the twelve valence-five icosahedron vertices. Calling readPixels in the normal
 * render loop would introduce a CPU/GPU synchronization stall.
 */
function readAttachment(
  gl: WebGL2RenderingContext,
  attachment: number,
  floatingPoint: boolean,
  width: number,
  height: number,
) {
  gl.readBuffer(attachment);
  const values = floatingPoint
    ? new Float32Array(width * height * 4)
    : new Uint8Array(width * height * 4);
  gl.readPixels(
    0, 0, width, height, gl.RGBA,
    floatingPoint ? gl.FLOAT : gl.UNSIGNED_BYTE,
    values,
  );
  if (floatingPoint) return values as Float32Array;
  const normalized = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = values[index] / 255;
  }
  return normalized;
}

export function readDynamicsSample(options: ReadbackOptions): DynamicsSample {
  const {
    gl, framebuffer, floatingPoint, width, height, vertexCount, dualAreas,
    modelSeconds, wallSeconds, fps, gpuMilliseconds, droppedSeconds,
  } = options;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const state0 = readAttachment(
    gl, gl.COLOR_ATTACHMENT0, floatingPoint, width, height,
  );
  const state1 = readAttachment(
    gl, gl.COLOR_ATTACHMENT1, floatingPoint, width, height,
  );

  let area = 0;
  let thicknessMoment = 0;
  let thicknessSquareMoment = 0;
  let minimumThickness = Number.POSITIVE_INFINITY;
  let maximumThickness = 0;
  let thinArea = 0;
  let speedSquareMoment = 0;
  let maximumSpeed = 0;
  let surfactantMoment = 0;
  let surfactantSquareMoment = 0;
  let minimumTemperature = Number.POSITIVE_INFINITY;
  let maximumTemperature = Number.NEGATIVE_INFINITY;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 4;
    const weight = dualAreas[vertex];
    const thickness = decodeThicknessMicrons(state0[offset]);
    const velocityX = (state0[offset + 1] * 2 - 1) * VELOCITY_RANGE;
    const velocityY = (state0[offset + 2] * 2 - 1) * VELOCITY_RANGE;
    const velocityZ = (state0[offset + 3] * 2 - 1) * VELOCITY_RANGE;
    const angularSpeed = Math.hypot(velocityX, velocityY, velocityZ);
    const speed = physicalSurfaceSpeed(angularSpeed);
    const surfactant = state1[offset];
    const temperature = (state1[offset + 1] * 2 - 1) * TEMPERATURE_RANGE;

    area += weight;
    thicknessMoment += thickness * weight;
    thicknessSquareMoment += thickness * thickness * weight;
    minimumThickness = Math.min(minimumThickness, thickness);
    maximumThickness = Math.max(maximumThickness, thickness);
    if (thickness < 0.1) thinArea += weight;
    speedSquareMoment += speed * speed * weight;
    maximumSpeed = Math.max(maximumSpeed, speed);
    surfactantMoment += surfactant * weight;
    surfactantSquareMoment += surfactant * surfactant * weight;
    minimumTemperature = Math.min(minimumTemperature, temperature);
    maximumTemperature = Math.max(maximumTemperature, temperature);
  }

  const meanThickness = thicknessMoment / area;
  const meanSurfactant = surfactantMoment / area;
  return {
    modelSeconds,
    wallSeconds,
    fps,
    gpuMilliseconds,
    meanThicknessNanometers: meanThickness * 1000,
    minimumThicknessNanometers: minimumThickness * 1000,
    maximumThicknessNanometers: maximumThickness * 1000,
    thicknessDeviationNanometers: Math.sqrt(Math.max(
      0, thicknessSquareMoment / area - meanThickness * meanThickness,
    )) * 1000,
    thinAreaFraction: thinArea / area,
    rmsSurfaceSpeedMillimetersPerSecond: Math.sqrt(speedSquareMoment / area) * 1000,
    maximumSurfaceSpeedMillimetersPerSecond: maximumSpeed * 1000,
    meanSurfactant,
    surfactantDeviation: Math.sqrt(Math.max(
      0, surfactantSquareMoment / area - meanSurfactant * meanSurfactant,
    )),
    minimumTemperatureKelvin: minimumTemperature,
    maximumTemperatureKelvin: maximumTemperature,
    cumulativeDroppedModelSeconds: droppedSeconds,
  };
}

/*
 * Asynchronous GPU timing follows EXT_disjoint_timer_query_webgl2. Results are
 * discarded whenever the GPU reports a disjoint event, as required by the
 * Khronos specification:
 * https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/
 */
export class GpuTimer {
  private readonly extension: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  private latest: number | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  begin() {
    if (!this.extension || this.active) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.extension || !this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll() {
    if (!this.extension || this.pending.length === 0) return this.latest;
    const query = this.pending[0];
    const available = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE);
    const disjoint = this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    if (available) {
      this.pending.shift();
      if (!disjoint) {
        this.latest = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6;
      }
      this.gl.deleteQuery(query);
    }
    return this.latest;
  }

  dispose() {
    if (this.active) this.gl.deleteQuery(this.active);
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.active = null;
    this.pending = [];
  }
}

export { BUBBLE_RADIUS_METERS };
