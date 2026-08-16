"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CameraOrbit, SimulationParameters, Vector3 } from "./model";
import { screenNormalToWorldDirection } from "./model";
import { createIcosphere } from "./icosphere";
import {
  backgroundShader,
  bubbleFragmentShader,
  bubbleVertexShader,
  fullscreenVertexShader,
  simulationShader,
} from "./shaders";
import {
  createProgram,
  createTexture,
  FULLSCREEN_TRIANGLES,
  stateUploadData,
  uniformLocations,
} from "./webgl";

export type BubbleCanvasHandle = { reset: () => void };

type BubbleCanvasProps = {
  parameters: SimulationParameters;
  paused: boolean;
  onAvailabilityChange: (available: boolean) => void;
};

type FilmPointer = {
  direction: Vector3;
  velocity: Vector3;
  down: number;
  lastTime: number;
};

type Interaction = {
  mode: "film" | "orbit" | null;
  lastClientX: number;
  lastClientY: number;
};

const SIMULATION_UNIFORMS = [
  "u_state0", "u_state1", "u_positions", "u_neighbors", "u_stateSize",
  "u_vertexCount", "u_dt", "u_gravity", "u_surfaceTension", "u_viscosity",
  "u_marangoni", "u_diffusion", "u_evaporation", "u_thermalGradient",
  "u_pointerDirection", "u_pointerVelocity", "u_pointerDown",
] as const;

const BUBBLE_UNIFORMS = [
  "u_state0", "u_resolution", "u_cameraOrbit", "u_thickness", "u_variation",
  "u_ior", "u_saturation",
] as const;

export const BubbleCanvas = forwardRef<BubbleCanvasHandle, BubbleCanvasProps>(
  function BubbleCanvas({ parameters, paused, onAvailabilityChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const parametersRef = useRef(parameters);
    const pausedRef = useRef(paused);
    const resetSimulationRef = useRef<() => void>(() => {});
    const cameraOrbitRef = useRef<CameraOrbit>({ yaw: 0, pitch: 0 });
    const filmPointerRef = useRef<FilmPointer>({
      direction: [0, 0, 1], velocity: [0, 0, 0], down: 0, lastTime: 0,
    });
    const interactionRef = useRef<Interaction>({
      mode: null, lastClientX: 0, lastClientY: 0,
    });

    useEffect(() => { parametersRef.current = parameters; }, [parameters]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useImperativeHandle(ref, () => ({ reset: () => resetSimulationRef.current() }), []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
      if (!gl) {
        queueMicrotask(() => onAvailabilityChange(false));
        return;
      }

      let animation = 0;
      try {
        const simulationProgram = createProgram(gl, fullscreenVertexShader, simulationShader);
        const backgroundProgram = createProgram(gl, fullscreenVertexShader, backgroundShader);
        const bubbleProgram = createProgram(gl, bubbleVertexShader, bubbleFragmentShader);
        const simulationUniforms = uniformLocations(gl, simulationProgram, SIMULATION_UNIFORMS);
        const bubbleUniforms = uniformLocations(gl, bubbleProgram, BUBBLE_UNIFORMS);

        const fullscreenArray = gl.createVertexArray();
        const fullscreenBuffer = gl.createBuffer();
        if (!fullscreenArray || !fullscreenBuffer) {
          throw new Error("Unable to allocate fullscreen geometry");
        }
        gl.bindVertexArray(fullscreenArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLES, gl.STATIC_DRAW);
        for (const program of [simulationProgram, backgroundProgram]) {
          const location = gl.getAttribLocation(program, "a_position");
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
        }

        const mobile = window.innerWidth < 700;
        const mesh = createIcosphere(mobile ? 4 : 5);
        const bubbleArray = gl.createVertexArray();
        const positionBuffer = gl.createBuffer();
        const stateUvBuffer = gl.createBuffer();
        const indexBuffer = gl.createBuffer();
        if (!bubbleArray || !positionBuffer || !stateUvBuffer || !indexBuffer) {
          throw new Error("Unable to allocate manifold geometry");
        }
        gl.bindVertexArray(bubbleArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
        const positionLocation = gl.getAttribLocation(bubbleProgram, "a_position");
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, stateUvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.stateUvs, gl.STATIC_DRAW);
        const stateUvLocation = gl.getAttribLocation(bubbleProgram, "a_stateUv");
        gl.enableVertexAttribArray(stateUvLocation);
        gl.vertexAttribPointer(stateUvLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

        const usesFloatState = Boolean(gl.getExtension("EXT_color_buffer_float"));
        const stateInternalFormat = usesFloatState ? gl.RGBA16F : gl.RGBA8;
        const stateType = usesFloatState ? gl.FLOAT : gl.UNSIGNED_BYTE;
        const initialState0 = stateUploadData(mesh.initialState0, usesFloatState);
        const initialState1 = stateUploadData(mesh.initialState1, usesFloatState);
        const positionTexture = createTexture(
          gl, mesh.textureWidth, mesh.textureHeight,
          gl.RGBA32F, gl.FLOAT, mesh.positionTexels,
        );
        const neighborTexture = createTexture(
          gl, mesh.textureWidth, mesh.textureHeight * 6,
          gl.RGBA32F, gl.FLOAT, mesh.neighborTexels,
        );
        const state0Textures = [0, 1].map(() => createTexture(
          gl, mesh.textureWidth, mesh.textureHeight,
          stateInternalFormat, stateType, initialState0,
        ));
        const state1Textures = [0, 1].map(() => createTexture(
          gl, mesh.textureWidth, mesh.textureHeight,
          stateInternalFormat, stateType, initialState1,
        ));
        const framebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
        if (framebuffers.some((framebuffer) => !framebuffer)) {
          throw new Error("Unable to allocate simulation framebuffer");
        }
        framebuffers.forEach((framebuffer, index) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state0Textures[index], 0,
          );
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, state1Textures[index], 0,
          );
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error("Simulation framebuffer is incomplete");
          }
        });

        let readIndex = 0;
        let timeDebt = 0;
        const uploadState = (
          texture: WebGLTexture,
          data: Float32Array | Uint8Array,
        ) => {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(
            gl.TEXTURE_2D, 0, 0, 0,
            mesh.textureWidth, mesh.textureHeight,
            gl.RGBA, stateType, data,
          );
        };
        resetSimulationRef.current = () => {
          for (const texture of state0Textures) uploadState(texture, initialState0);
          for (const texture of state1Textures) uploadState(texture, initialState1);
          readIndex = 0;
          timeDebt = 0;
        };

        const resize = () => {
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
          const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
        };

        let lastFrame = performance.now();
        const modelSecondsPerRealSecond = 2.25;
        const maxSubsteps = mobile ? 10 : 14;
        const targetStep = 1 / 75;
        const maxStableStep = 1 / 30;

        const bindTexture = (unit: number, texture: WebGLTexture) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        };

        const render = (now: number) => {
          resize();
          const current = parametersRef.current;
          const frameElapsed = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
          lastFrame = now;

          if (!pausedRef.current) {
            timeDebt += frameElapsed * current.speed * modelSecondsPerRealSecond;
            const requestedSubsteps = Math.floor(timeDebt / targetStep);
            const substeps = Math.min(maxSubsteps, requestedSubsteps);
            const stepDuration = requestedSubsteps > maxSubsteps
              ? Math.min(maxStableStep, timeDebt / maxSubsteps)
              : targetStep;
            gl.useProgram(simulationProgram);
            gl.bindVertexArray(fullscreenArray);
            gl.viewport(0, 0, mesh.textureWidth, mesh.textureHeight);
            gl.uniform1i(simulationUniforms.u_state0, 0);
            gl.uniform1i(simulationUniforms.u_state1, 1);
            gl.uniform1i(simulationUniforms.u_positions, 2);
            gl.uniform1i(simulationUniforms.u_neighbors, 3);
            gl.uniform2i(
              simulationUniforms.u_stateSize,
              mesh.textureWidth,
              mesh.textureHeight,
            );
            gl.uniform1i(simulationUniforms.u_vertexCount, mesh.vertexCount);
            gl.uniform1f(simulationUniforms.u_gravity, current.gravity);
            gl.uniform1f(simulationUniforms.u_surfaceTension, current.surfaceTension);
            gl.uniform1f(simulationUniforms.u_viscosity, current.viscosity);
            gl.uniform1f(simulationUniforms.u_marangoni, current.marangoni);
            gl.uniform1f(simulationUniforms.u_diffusion, current.surfactantDiffusion);
            gl.uniform1f(simulationUniforms.u_evaporation, current.evaporation);
            gl.uniform1f(simulationUniforms.u_thermalGradient, current.thermalGradient);
            gl.uniform3f(
              simulationUniforms.u_pointerDirection,
              ...filmPointerRef.current.direction,
            );
            gl.uniform3f(
              simulationUniforms.u_pointerVelocity,
              ...filmPointerRef.current.velocity,
            );
            gl.uniform1f(simulationUniforms.u_pointerDown, filmPointerRef.current.down);
            bindTexture(2, positionTexture);
            bindTexture(3, neighborTexture);

            for (let step = 0; step < substeps; step += 1) {
              gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - readIndex]);
              bindTexture(0, state0Textures[readIndex]);
              bindTexture(1, state1Textures[readIndex]);
              gl.uniform1f(simulationUniforms.u_dt, stepDuration);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              readIndex = 1 - readIndex;
            }
            timeDebt = Math.max(0, timeDebt - stepDuration * substeps);
            timeDebt = Math.min(timeDebt, maxStableStep * maxSubsteps);
            const pointerVelocity = filmPointerRef.current.velocity;
            filmPointerRef.current.velocity = [
              pointerVelocity[0] * 0.72,
              pointerVelocity[1] * 0.72,
              pointerVelocity[2] * 0.72,
            ];
          }

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.disable(gl.DEPTH_TEST);
          gl.useProgram(backgroundProgram);
          gl.bindVertexArray(fullscreenArray);
          gl.drawArrays(gl.TRIANGLES, 0, 6);

          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LESS);
          gl.clearDepth(1);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.useProgram(bubbleProgram);
          gl.bindVertexArray(bubbleArray);
          bindTexture(0, state0Textures[readIndex]);
          gl.uniform1i(bubbleUniforms.u_state0, 0);
          gl.uniform2f(bubbleUniforms.u_resolution, canvas.width, canvas.height);
          gl.uniform2f(
            bubbleUniforms.u_cameraOrbit,
            cameraOrbitRef.current.yaw,
            cameraOrbitRef.current.pitch,
          );
          gl.uniform1f(bubbleUniforms.u_thickness, current.thickness);
          gl.uniform1f(bubbleUniforms.u_variation, current.variation);
          gl.uniform1f(bubbleUniforms.u_ior, current.refractiveIndex);
          gl.uniform1f(bubbleUniforms.u_saturation, current.saturation);
          gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
          animation = requestAnimationFrame(render);
        };

        queueMicrotask(() => onAvailabilityChange(true));
        animation = requestAnimationFrame(render);
        return () => {
          cancelAnimationFrame(animation);
          resetSimulationRef.current = () => {};
          for (const texture of [
            positionTexture, neighborTexture,
            ...state0Textures, ...state1Textures,
          ]) gl.deleteTexture(texture);
          for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
          for (const buffer of [
            fullscreenBuffer, positionBuffer, stateUvBuffer, indexBuffer,
          ]) gl.deleteBuffer(buffer);
          gl.deleteVertexArray(fullscreenArray);
          gl.deleteVertexArray(bubbleArray);
          gl.deleteProgram(simulationProgram);
          gl.deleteProgram(backgroundProgram);
          gl.deleteProgram(bubbleProgram);
        };
      } catch (error) {
        console.error(error);
        queueMicrotask(() => onAvailabilityChange(false));
      }
    }, [onAvailabilityChange]);

    const updateFilmPointer = (event: ReactPointerEvent<HTMLCanvasElement>, down?: number) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const screenU = (event.clientX - rect.left) / rect.width;
      const screenV = 1 - (event.clientY - rect.top) / rect.height;
      const aspect = rect.width / rect.height;
      const qx = (screenU - 0.5) * aspect;
      const qy = screenV - 0.5;
      const radius = Math.min(0.425 * aspect, 0.455);
      const radial = (qx * qx + qy * qy) / (radius * radius);
      if (radial > 1) {
        if (down === 0) filmPointerRef.current.down = 0;
        return;
      }

      const direction = screenNormalToWorldDirection([
        qx / radius,
        qy / radius,
        Math.sqrt(Math.max(0, 1 - radial)),
      ], cameraOrbitRef.current);
      const previous = filmPointerRef.current;
      const eventTime = event.timeStamp / 1000;
      const deltaTime = Math.max(0.008, eventTime - previous.lastTime);
      const active = (down ?? previous.down) > 0 && previous.lastTime > 0;
      const delta: Vector3 = [
        direction[0] - previous.direction[0],
        direction[1] - previous.direction[1],
        direction[2] - previous.direction[2],
      ];
      const radialDelta = delta[0] * direction[0]
        + delta[1] * direction[1]
        + delta[2] * direction[2];
      const tangentDelta: Vector3 = [
        delta[0] - direction[0] * radialDelta,
        delta[1] - direction[1] * radialDelta,
        delta[2] - direction[2] * radialDelta,
      ];
      const rawVelocity: Vector3 = active ? [
        tangentDelta[0] / deltaTime,
        tangentDelta[1] / deltaTime,
        tangentDelta[2] / deltaTime,
      ] : [0, 0, 0];
      const speed = Math.hypot(...rawVelocity);
      const velocityScale = speed > 0.34 ? 0.34 / speed : 1;
      filmPointerRef.current = {
        direction,
        velocity: [
          rawVelocity[0] * velocityScale,
          rawVelocity[1] * velocityScale,
          rawVelocity[2] * velocityScale,
        ],
        down: down ?? previous.down,
        lastTime: eventTime,
      };
    };

    const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = {
        mode: event.shiftKey ? "orbit" : "film",
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      if (event.shiftKey) {
        event.currentTarget.dataset.orbiting = "true";
        filmPointerRef.current.down = 0;
      } else {
        updateFilmPointer(event, 1);
      }
    };

    const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const interaction = interactionRef.current;
      if (interaction.mode === "orbit") {
        const deltaX = event.clientX - interaction.lastClientX;
        const deltaY = event.clientY - interaction.lastClientY;
        cameraOrbitRef.current = {
          yaw: cameraOrbitRef.current.yaw + deltaX * 0.008,
          pitch: Math.max(
            -1.35,
            Math.min(1.35, cameraOrbitRef.current.pitch + deltaY * 0.008),
          ),
        };
        interaction.lastClientX = event.clientX;
        interaction.lastClientY = event.clientY;
      } else if (interaction.mode === "film") {
        updateFilmPointer(event);
      }
    };

    const pointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (interactionRef.current.mode === "film") updateFilmPointer(event, 0);
      filmPointerRef.current.down = 0;
      interactionRef.current.mode = null;
      delete event.currentTarget.dataset.orbiting;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    return (
      <canvas
        ref={canvasRef}
        className="bubble-canvas"
        aria-label="Animated soap bubble thin-film simulation; Shift-drag rotates the scene"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      />
    );
  },
);
