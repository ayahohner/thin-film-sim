import assert from "node:assert/strict";
import test from "node:test";
import { FixedStepClock } from "../app/bubble/clock";
import { createIcosphere } from "../app/bubble/icosphere";
import {
  FIXED_STEP_SECONDS,
  MODEL_SECONDS_PER_REAL_SECOND,
} from "../app/bubble/physics";

/*
 * Acceptance tests target invariants rather than screenshots:
 * - wall/model time identity at 1x;
 * - one closed genus-zero manifold with no exceptional pole vertices;
 * - convergence of area and the Laplace-Beltrami eigenvalue Delta(x)=-2x;
 * - area-weighted cancellation of every symmetric edge flux.
 *
 * These catch the earlier hidden time multiplier, atlas seams/poles, and
 * non-conservative stencils before visual tuning can disguise them.
 */

test("1x maps one wall second to one model second", () => {
  assert.equal(MODEL_SECONDS_PER_REAL_SECOND, 1);
  const clock = new FixedStepClock();
  for (let frame = 0; frame < 60; frame += 1) {
    clock.advance(1 / 60, 1);
  }
  assert.ok(Math.abs(clock.simulatedTime - 1) <= FIXED_STEP_SECONDS);
});

test("12x uses fixed 1/120 s substeps without a large variable step", () => {
  const clock = new FixedStepClock();
  const batch = clock.advance(1 / 60, 12);
  assert.equal(batch.steps, 24);
  assert.equal(batch.stepSeconds, 1 / 120);
  assert.ok(Math.abs(batch.simulatedSeconds - 0.2) < 1e-12);
});

function stencil(mesh: ReturnType<typeof createIcosphere>, vertex: number) {
  const x = vertex % mesh.textureWidth;
  const y = Math.floor(vertex / mesh.textureWidth);
  return Array.from({ length: 6 }, (_, slot) => {
    const offset = ((slot * mesh.textureHeight + y) * mesh.textureWidth + x) * 4;
    return {
      vertex: Math.round(mesh.neighborTexels[offset]),
      laplace: mesh.neighborTexels[offset + 1],
      flux: mesh.neighborTexels[offset + 2],
      distance: mesh.neighborTexels[offset + 3],
    };
  }).filter((neighbor) => neighbor.vertex >= 0);
}

test("icosphere is one closed manifold with Euler characteristic two", () => {
  const mesh = createIcosphere(4);
  const edges = new Set<string>();
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const triangle = [
      mesh.indices[face], mesh.indices[face + 1], mesh.indices[face + 2],
    ];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  const faces = mesh.indices.length / 3;
  assert.equal(mesh.vertexCount - edges.size + faces, 2);
  const degrees = Array.from(
    { length: mesh.vertexCount }, (_, vertex) => stencil(mesh, vertex).length,
  );
  assert.equal(degrees.filter((degree) => degree === 5).length, 12);
  assert.equal(degrees.filter((degree) => degree === 6).length, mesh.vertexCount - 12);
});

test("cotangent geometry converges to unit-sphere area and spectrum", () => {
  const mesh = createIcosphere(4);
  const area = mesh.dualAreas.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(area - 4 * Math.PI) / (4 * Math.PI) < 0.002);

  let errorSquare = 0;
  let signalSquare = 0;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const center = mesh.positions[vertex * 3];
    let laplacian = 0;
    for (const neighbor of stencil(mesh, vertex)) {
      const value = mesh.positions[neighbor.vertex * 3];
      laplacian += neighbor.laplace * (value - center);
    }
    const error = laplacian + 2 * center;
    errorSquare += mesh.dualAreas[vertex] * error * error;
    signalSquare += mesh.dualAreas[vertex] * 4 * center * center;
  }
  assert.ok(Math.sqrt(errorSquare / signalSquare) < 0.015);
});

test("symmetric dual-edge flux conserves area-weighted mass", () => {
  const mesh = createIcosphere(3);
  const values = Array.from(
    { length: mesh.vertexCount },
    (_, vertex) => Math.sin(vertex * 1.61803398875),
  );
  let integratedRate = 0;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    let rate = 0;
    for (const neighbor of stencil(mesh, vertex)) {
      const edgeGradient = (values[neighbor.vertex] - values[vertex])
        / neighbor.distance;
      rate += neighbor.flux * edgeGradient;
    }
    integratedRate += mesh.dualAreas[vertex] * rate;
  }
  assert.ok(Math.abs(integratedRate) < 2e-5);
});
