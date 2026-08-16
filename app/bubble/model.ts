export type SimulationParameters = {
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

export type PresetName = "fresh" | "draining" | "aged";

export type CameraOrbit = {
  yaw: number;
  pitch: number;
};

export type Vector3 = readonly [number, number, number];

export const DEFAULT_PARAMETERS: SimulationParameters = {
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

export function parametersForPreset(name: PresetName): SimulationParameters {
  if (name === "fresh") {
    return { ...DEFAULT_PARAMETERS, thickness: 760, variation: 310, gravity: 0.18, viscosity: 0.42 };
  }
  if (name === "draining") {
    return {
      ...DEFAULT_PARAMETERS,
      thickness: 360,
      variation: 420,
      gravity: 0.92,
      viscosity: 0.28,
      marangoni: 0.64,
    };
  }
  return {
    ...DEFAULT_PARAMETERS,
    thickness: 110,
    variation: 220,
    gravity: 0.66,
    viscosity: 0.48,
    marangoni: 0.58,
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
