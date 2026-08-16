import { FixedStepClock } from "../app/bubble/clock";
import { createIcosphere } from "../app/bubble/icosphere";

/*
 * Deterministic numerical report for CI and tuning notebooks. Runtime visual
 * time series live behind ?diagnostics=1; this script checks the static manifold
 * and clock without requiring a GPU.
 */
const meshes = [3, 4, 5, 6].map((level) => {
  const mesh = createIcosphere(level);
  const area = mesh.dualAreas.reduce((sum, value) => sum + value, 0);
  return {
    level,
    vertices: mesh.vertexCount,
    triangles: mesh.indices.length / 3,
    area,
    relativeAreaError: Math.abs(area - 4 * Math.PI) / (4 * Math.PI),
    stateMiB: mesh.vertexCount * 12 * 4 / (1024 * 1024),
  };
});

const clock = [0.1, 1, 2, 6, 12].map((speed) => {
  const instance = new FixedStepClock();
  let maximumSteps = 0;
  for (let frame = 0; frame < 600; frame += 1) {
    maximumSteps = Math.max(
      maximumSteps,
      instance.advance(1 / 60, speed).steps,
    );
  }
  return { speed, modelSeconds: instance.simulatedTime, maximumSteps };
});

console.log(JSON.stringify({ meshes, clock }, null, 2));
