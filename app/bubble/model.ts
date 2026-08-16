export type SimulationParameters = {
  thickness: number;
  variation: number;
  refractiveIndex: number;
  gravity: number;
  surfaceTension: number;
  viscosity: number;
  marangoni: number;
  surfactantDiffusion: number;
  evaporation: number;
  thermalGradient: number;
  saturation: number;
  speed: number;
};

export type PresetName = "fresh" | "draining" | "aged";

export type ColorGrade = "default" | "filmic" | "neutral" | "vivid";

export type CameraOrbit = {
  yaw: number;
  pitch: number;
};

export type Vector3 = readonly [number, number, number];

export const DEFAULT_PARAMETERS: SimulationParameters = {
  thickness: 620,
  variation: 520,
  refractiveIndex: 1.335,
  gravity: 9.81,
  surfaceTension: 32,
  viscosity: 1.6,
  marangoni: 18,
  surfactantDiffusion: 100,
  evaporation: 1.8,
  thermalGradient: 0.7,
  saturation: 1.06,
  speed: 1,
};

export function parametersForPreset(name: PresetName): SimulationParameters {
  if (name === "fresh") {
    return {
      ...DEFAULT_PARAMETERS,
      thickness: 950,
      variation: 380,
      viscosity: 2.2,
      evaporation: 0.8,
      thermalGradient: 0.35,
    };
  }
  if (name === "draining") {
    return {
      ...DEFAULT_PARAMETERS,
      thickness: 430,
      variation: 650,
      gravity: 9.81,
      viscosity: 1.3,
      marangoni: 14,
      evaporation: 2.8,
      thermalGradient: 1.1,
    };
  }
  return {
    ...DEFAULT_PARAMETERS,
    thickness: 120,
    variation: 300,
    gravity: 9.81,
    viscosity: 3.5,
    marangoni: 28,
    evaporation: 0.5,
    thermalGradient: 0.25,
    speed: 2.2,
    saturation: 0.94,
  };
}

export function screenNormalToWorldDirection(
  normal: Vector3,
  orbit: CameraOrbit,
): Vector3 {
  const [x, y, z] = normal;
  const cosPitch = Math.cos(orbit.pitch);
  const sinPitch = Math.sin(orbit.pitch);
  const pitchedY = cosPitch * y - sinPitch * z;
  const pitchedZ = sinPitch * y + cosPitch * z;
  const cosYaw = Math.cos(orbit.yaw);
  const sinYaw = Math.sin(orbit.yaw);
  const worldX = cosYaw * x + sinYaw * pitchedZ;
  const worldZ = -sinYaw * x + cosYaw * pitchedZ;
  return [worldX, pitchedY, worldZ];
}
