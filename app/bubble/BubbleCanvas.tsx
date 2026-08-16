"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  CameraOrbit,
  ColorGrade,
  SimulationParameters,
  Vector3,
} from "./model";
import { screenNormalToWorldDirection } from "./model";
import { createIcosphere, initializeIcosphereState } from "./icosphere";
import {
  geometryShader,
  backgroundShader,
  bubbleFragmentShader,
  bubbleVertexShader,
  fullscreenVertexShader,
  simulationShader,
} from "./shaders";
import { FixedStepClock } from "./clock";
import {
  captureTimesFromUrl,
  diagnosticsEnabled,
  GpuTimer,
  readDynamicsSample,
  type DynamicsReport,
} from "./diagnostics";
import {
  createProgram,
  createTexture,
  FULLSCREEN_TRIANGLES,
  stateUploadData,
  uniformLocations,
} from "./webgl";

export type BubbleCanvasHandle = {
  reset: () => void;
  capture: () => string | null;
  diagnostics: () => DynamicsReport | null;
};

export type InteractionMode = "perturb" | "rotate";

type BubbleCanvasProps = {
  parameters: SimulationParameters;
  paused: boolean;
  interactionMode: InteractionMode;
  colorGrade: ColorGrade;
  contrast: number;
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
  "u_pointerDirection", "u_pointerVelocity", "u_pointerDown", "u_geometry",
  "u_time",
] as const;

const BUBBLE_UNIFORMS = [
  "u_state0", "u_resolution", "u_cameraOrbit", "u_ior", "u_saturation",
  "u_colorGrade", "u_contrast",
] as const;

const COLOR_GRADE_INDEX: Record<ColorGrade, number> = {
  default: 0,
  filmic: 1,
  neutral: 2,
  vivid: 3,
};

const GEOMETRY_UNIFORMS = [
  "u_state0", "u_neighbors", "u_stateSize", "u_vertexCount",
] as const;

export const BubbleCanvas = forwardRef<BubbleCanvasHandle, BubbleCanvasProps>(
  function BubbleCanvas({
    parameters,
    paused,
    interactionMode,
    colorGrade,
    contrast,
    onAvailabilityChange,
  }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const parametersRef = useRef(parameters);
    const pausedRef = useRef(paused);
    const colorGradeRef = useRef(colorGrade);
    const contrastRef = useRef(contrast);
    const resetSimulationRef = useRef<() => void>(() => {});
    const captureRef = useRef<() => string | null>(() => null);
    const diagnosticsRef = useRef<() => DynamicsReport | null>(() => null);
    const cameraOrbitRef = useRef<CameraOrbit>({ yaw: 0, pitch: 0 });
    const filmPointerRef = useRef<FilmPointer>({
      direction: [0, 0, 1], velocity: [0, 0, 0], down: 0, lastTime: 0,
    });
    const interactionRef = useRef<Interaction>({
      mode: null, lastClientX: 0, lastClientY: 0,
    });

    useEffect(() => { parametersRef.current = parameters; }, [parameters]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { colorGradeRef.current = colorGrade; }, [colorGrade]);
    useEffect(() => { contrastRef.current = contrast; }, [contrast]);
    useEffect(() => {
      resetSimulationRef.current();
    }, [parameters.thickness, parameters.variation]);
    useImperativeHandle(ref, () => ({
      reset: () => resetSimulationRef.current(),
      capture: () => captureRef.current(),
      diagnostics: () => diagnosticsRef.current(),
    }), []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const collectDiagnostics = diagnosticsEnabled();
      const gl = canvas.getContext("webgl2", {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: collectDiagnostics,
        powerPreference: "high-performance",
      });
      if (!gl) {
        queueMicrotask(() => onAvailabilityChange(false));
        return;
      }

      let animation = 0;
      try {
        const geometryProgram = createProgram(
          gl, fullscreenVertexShader, geometryShader,
        );
        const simulationProgram = createProgram(gl, fullscreenVertexShader, simulationShader);
        const backgroundProgram = createProgram(gl, fullscreenVertexShader, backgroundShader);
        const bubbleProgram = createProgram(gl, bubbleVertexShader, bubbleFragmentShader);
        const geometryUniforms = uniformLocations(
          gl, geometryProgram, GEOMETRY_UNIFORMS,
        );
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
        for (const program of [
          geometryProgram, simulationProgram, backgroundProgram,
        ]) {
          const location = gl.getAttribLocation(program, "a_position");
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
        }

        /*
         * One subdivision step quadruples triangle count. Level 5 on phones is
         * 10,242 vertices (4x the old grid); level 6 on desktop is 40,962.
         * State is vertex-centred, so this raises physical resolution without
         * changing the one-manifold topology or adding display-only tessellation.
         */
        const mobile = window.innerWidth < 700;
        const mesh = createIcosphere(mobile ? 5 : 6);
        initializeIcosphereState(mesh, parametersRef.current);
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

        /*
         * RGBA32F is required for conservative long-time transport. UNORM8 stored
         * only 256 thickness/velocity levels and was the source of high-speed
         * vibration and visible quantisation. No packed fallback silently changes
         * the equations; unsupported devices receive the existing static fallback.
         */
        const usesFloatState = Boolean(gl.getExtension("EXT_color_buffer_float"));
        if (!usesFloatState) {
          throw new Error("The physical solver requires floating-point render targets");
        }
        const stateInternalFormat = gl.RGBA32F;
        const stateType = gl.FLOAT;
        let initialState0 = stateUploadData(mesh.initialState0, true);
        let initialState1 = stateUploadData(mesh.initialState1, true);
        const positionTexture = createTexture(
          gl, mesh.textureWidth, mesh.textureHeight,
          gl.RGBA32F, gl.FLOAT, mesh.positionTexels,
        );
        const neighborTexture = createTexture(
          gl, mesh.textureWidth, mesh.textureHeight * 6,
          gl.RGBA32F, gl.FLOAT, mesh.neighborTexels,
        );
        const geometryTexture = createTexture(
          gl, mesh.textureWidth, mesh.textureHeight,
          gl.RGBA32F, gl.FLOAT, null,
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
        const geometryFramebuffer = gl.createFramebuffer();
        if (
          framebuffers.some((framebuffer) => !framebuffer)
          || !geometryFramebuffer
        ) {
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
        gl.bindFramebuffer(gl.FRAMEBUFFER, geometryFramebuffer);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D, geometryTexture, 0,
        );
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error("Geometry framebuffer is incomplete");
        }

        let readIndex = 0;
        const clock = new FixedStepClock();
        const gpuTimer = new GpuTimer(gl);
        const samples: DynamicsReport["samples"] = [];
        const frames: DynamicsReport["frames"] = [];
        const captureTimes = collectDiagnostics ? captureTimesFromUrl() : [];
        let nextCapture = 0;
        let nextSampleTime = 0;
        let diagnosticsStartedAt = performance.now();
        let recentFrameSeconds: number[] = [];
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
          initializeIcosphereState(mesh, parametersRef.current);
          initialState0 = stateUploadData(mesh.initialState0, true);
          initialState1 = stateUploadData(mesh.initialState1, true);
          for (const texture of state0Textures) uploadState(texture, initialState0);
          for (const texture of state1Textures) uploadState(texture, initialState1);
          readIndex = 0;
          clock.reset();
          samples.length = 0;
          frames.length = 0;
          nextCapture = 0;
          nextSampleTime = 0;
          diagnosticsStartedAt = performance.now();
          recentFrameSeconds = [];
        };
        captureRef.current = () => (
          collectDiagnostics ? canvas.toDataURL("image/png") : null
        );
        diagnosticsRef.current = () => collectDiagnostics ? {
          generatedAt: new Date().toISOString(),
          meshVertices: mesh.vertexCount,
          meshTriangles: mesh.indices.length / 3,
          parameters: { ...parametersRef.current },
          samples: [...samples],
          frames: [...frames],
        } : null;

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
        let frameCount = 0;
        let droppedModelSeconds = 0;

        const bindTexture = (unit: number, texture: WebGLTexture) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        };

        const render = (now: number) => {
          resize();
          const current = parametersRef.current;
          const frameElapsed = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
          lastFrame = now;
          recentFrameSeconds.push(frameElapsed);
          if (recentFrameSeconds.length > 120) recentFrameSeconds.shift();
          const measureGpu = frameCount % 90 === 0;
          if (measureGpu) gpuTimer.begin();

          if (!pausedRef.current) {
            const batch = clock.advance(frameElapsed, current.speed);
            droppedModelSeconds = batch.droppedSeconds;
            const stepStartTime = clock.simulatedTime - batch.simulatedSeconds;
            gl.bindVertexArray(fullscreenArray);
            gl.viewport(0, 0, mesh.textureWidth, mesh.textureHeight);
            gl.useProgram(geometryProgram);
            gl.uniform1i(geometryUniforms.u_state0, 0);
            gl.uniform1i(geometryUniforms.u_neighbors, 3);
            gl.uniform2i(
              geometryUniforms.u_stateSize,
              mesh.textureWidth,
              mesh.textureHeight,
            );
            gl.uniform1i(geometryUniforms.u_vertexCount, mesh.vertexCount);
            bindTexture(3, neighborTexture);

            gl.useProgram(simulationProgram);
            gl.uniform1i(simulationUniforms.u_state0, 0);
            gl.uniform1i(simulationUniforms.u_state1, 1);
            gl.uniform1i(simulationUniforms.u_positions, 2);
            gl.uniform1i(simulationUniforms.u_neighbors, 3);
            gl.uniform1i(simulationUniforms.u_geometry, 4);
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
            bindTexture(4, geometryTexture);

            /*
             * Mixed fourth-order update: pass A computes Delta(h) once, pass B
             * computes Delta^2(h) with one neighbor gather. The previous nested
             * stencil repeated up to 36 state fetches per vertex per substep.
             */
            for (let step = 0; step < batch.steps; step += 1) {
              gl.useProgram(geometryProgram);
              gl.bindFramebuffer(gl.FRAMEBUFFER, geometryFramebuffer);
              bindTexture(0, state0Textures[readIndex]);
              gl.drawArrays(gl.TRIANGLES, 0, 6);

              gl.useProgram(simulationProgram);
              gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - readIndex]);
              bindTexture(0, state0Textures[readIndex]);
              bindTexture(1, state1Textures[readIndex]);
              gl.uniform1f(simulationUniforms.u_dt, batch.stepSeconds);
              gl.uniform1f(
                simulationUniforms.u_time,
                stepStartTime + (step + 1) * batch.stepSeconds,
              );
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              readIndex = 1 - readIndex;
            }
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
          gl.uniform1f(bubbleUniforms.u_ior, current.refractiveIndex);
          gl.uniform1f(bubbleUniforms.u_saturation, current.saturation);
          gl.uniform1i(
            bubbleUniforms.u_colorGrade,
            COLOR_GRADE_INDEX[colorGradeRef.current],
          );
          gl.uniform1f(bubbleUniforms.u_contrast, contrastRef.current);
          gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

          if (measureGpu) gpuTimer.end();
          const gpuMilliseconds = gpuTimer.poll();
          frameCount += 1;
          canvas.dataset.simulationSeconds = clock.simulatedTime.toFixed(3);

          /* GPU readback and PNG encoding intentionally exist only in diagnostic
             mode: both can stall the render pipeline and would invalidate FPS. */
          if (collectDiagnostics) {
            while (
              nextCapture < captureTimes.length
              && clock.simulatedTime >= captureTimes[nextCapture]
            ) {
              frames.push({
                modelSeconds: captureTimes[nextCapture],
                image: canvas.toDataURL("image/png"),
              });
              nextCapture += 1;
            }

            if (clock.simulatedTime >= nextSampleTime) {
              const frameMean = recentFrameSeconds.reduce(
                (sum, seconds) => sum + seconds, 0,
              ) / Math.max(1, recentFrameSeconds.length);
              samples.push(readDynamicsSample({
                gl,
                framebuffer: framebuffers[readIndex]!,
                floatingPoint: usesFloatState,
                width: mesh.textureWidth,
                height: mesh.textureHeight,
                vertexCount: mesh.vertexCount,
                dualAreas: mesh.dualAreas,
                modelSeconds: clock.simulatedTime,
                wallSeconds: (now - diagnosticsStartedAt) / 1000,
                fps: frameMean > 0 ? 1 / frameMean : 0,
                gpuMilliseconds,
                droppedSeconds: droppedModelSeconds,
              }));
              nextSampleTime = Math.floor(clock.simulatedTime) + 1;
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
          }
          animation = requestAnimationFrame(render);
        };

        queueMicrotask(() => onAvailabilityChange(true));
        animation = requestAnimationFrame(render);
        return () => {
          cancelAnimationFrame(animation);
          resetSimulationRef.current = () => {};
          captureRef.current = () => null;
          diagnosticsRef.current = () => null;
          gpuTimer.dispose();
          for (const texture of [
            positionTexture, neighborTexture, geometryTexture,
            ...state0Textures, ...state1Textures,
          ]) gl.deleteTexture(texture);
          for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
          gl.deleteFramebuffer(geometryFramebuffer);
          for (const buffer of [
            fullscreenBuffer, positionBuffer, stateUvBuffer, indexBuffer,
          ]) gl.deleteBuffer(buffer);
          gl.deleteVertexArray(fullscreenArray);
          gl.deleteVertexArray(bubbleArray);
          gl.deleteProgram(geometryProgram);
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
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rotates = event.shiftKey || interactionMode === "rotate";
      interactionRef.current = {
        mode: rotates ? "orbit" : "film",
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      if (rotates) {
        event.currentTarget.dataset.orbiting = "true";
        filmPointerRef.current.down = 0;
      } else {
        updateFilmPointer(event, 1);
      }
    };

    const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (interactionRef.current.mode) event.preventDefault();
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
        data-interaction-mode={interactionMode}
        aria-label={`Animated soap bubble thin-film simulation; drag to ${
          interactionMode === "rotate" ? "rotate the scene" : "perturb the film"
        }`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      />
    );
  },
);
