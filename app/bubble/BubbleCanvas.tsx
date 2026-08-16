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
import { displayShader, simulationShader, vertexShader } from "./shaders";
import {
  createInitialState,
  createProgram,
  FULLSCREEN_TRIANGLES,
  uniformLocations,
} from "./webgl";

export type BubbleCanvasHandle = {
  reset: () => void;
};

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
  "u_state", "u_faceTexel", "u_angularStep", "u_dt", "u_gravity",
  "u_surfaceTension", "u_viscosity", "u_marangoni", "u_diffusion",
  "u_pointerDirection", "u_pointerVelocity", "u_pointerDown",
] as const;

const DISPLAY_UNIFORMS = [
  "u_state", "u_faceTexel", "u_angularStep", "u_resolution", "u_time",
  "u_cameraOrbit", "u_thickness", "u_variation", "u_ior", "u_saturation",
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
        const simulationProgram = createProgram(gl, vertexShader, simulationShader);
        const displayProgram = createProgram(gl, vertexShader, displayShader);
        const simulationUniforms = uniformLocations(gl, simulationProgram, SIMULATION_UNIFORMS);
        const displayUniforms = uniformLocations(gl, displayProgram, DISPLAY_UNIFORMS);
        const vertexArray = gl.createVertexArray();
        const vertexBuffer = gl.createBuffer();
        if (!vertexArray || !vertexBuffer) throw new Error("Unable to allocate WebGL geometry");
        gl.bindVertexArray(vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLES, gl.STATIC_DRAW);
        for (const shaderProgram of [simulationProgram, displayProgram]) {
          const location = gl.getAttribLocation(shaderProgram, "a_position");
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
        }

        const mobile = window.innerWidth < 700;
        const faceSize = mobile ? 56 : 80;
        const angularStep = 2.35 / faceSize;
        const usesFloatState = Boolean(gl.getExtension("EXT_color_buffer_float"));
        const initial = createInitialState(faceSize);
        const initialByteState = new Uint8Array(initial.state.length);
        for (let index = 0; index < initial.state.length; index += 1) {
          initialByteState[index] = Math.round(Math.max(0, Math.min(1, initial.state[index])) * 255);
        }
        const initialState = usesFloatState ? initial.state : initialByteState;
        const internalFormat = usesFloatState ? gl.RGBA16F : gl.RGBA8;
        const stateType = usesFloatState ? gl.FLOAT : gl.UNSIGNED_BYTE;
        const textures = [gl.createTexture(), gl.createTexture()];
        const framebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
        if (textures.some((texture) => !texture) || framebuffers.some((buffer) => !buffer)) {
          throw new Error("Unable to allocate simulation state");
        }

        textures.forEach((texture, index) => {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(
            gl.TEXTURE_2D, 0, internalFormat, initial.width, initial.height,
            0, gl.RGBA, stateType, initialState,
          );
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[index]);
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
          );
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error("Simulation framebuffer is incomplete");
          }
        });

        let readIndex = 0;
        let timeDebt = 0;
        resetSimulationRef.current = () => {
          for (const texture of textures) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texSubImage2D(
              gl.TEXTURE_2D, 0, 0, 0, initial.width, initial.height,
              gl.RGBA, stateType, initialState,
            );
          }
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
        let simulationTime = 0;
        const modelSecondsPerRealSecond = 2.25;
        const maxSubsteps = mobile ? 10 : 14;
        const targetStep = 1 / 75;
        const maxStableStep = 1 / 30;

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
            gl.bindVertexArray(vertexArray);
            gl.viewport(0, 0, initial.width, initial.height);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(simulationUniforms.u_state, 0);
            gl.uniform1f(simulationUniforms.u_faceTexel, 1 / faceSize);
            gl.uniform1f(simulationUniforms.u_angularStep, angularStep);
            gl.uniform1f(simulationUniforms.u_gravity, current.gravity);
            gl.uniform1f(simulationUniforms.u_surfaceTension, current.surfaceTension);
            gl.uniform1f(simulationUniforms.u_viscosity, current.viscosity);
            gl.uniform1f(simulationUniforms.u_marangoni, current.marangoni);
            gl.uniform1f(simulationUniforms.u_diffusion, current.surfactantDiffusion);
            gl.uniform3f(
              simulationUniforms.u_pointerDirection,
              filmPointerRef.current.direction[0],
              filmPointerRef.current.direction[1],
              filmPointerRef.current.direction[2],
            );
            gl.uniform3f(
              simulationUniforms.u_pointerVelocity,
              filmPointerRef.current.velocity[0],
              filmPointerRef.current.velocity[1],
              filmPointerRef.current.velocity[2],
            );
            gl.uniform1f(simulationUniforms.u_pointerDown, filmPointerRef.current.down);

            for (let step = 0; step < substeps; step += 1) {
              simulationTime += stepDuration;
              gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - readIndex]);
              gl.bindTexture(gl.TEXTURE_2D, textures[readIndex]);
              gl.uniform1f(simulationUniforms.u_dt, stepDuration);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              readIndex = 1 - readIndex;
            }
            timeDebt = Math.max(0, timeDebt - stepDuration * substeps);
            timeDebt = Math.min(timeDebt, maxStableStep * maxSubsteps);
            const velocity = filmPointerRef.current.velocity;
            filmPointerRef.current.velocity = [
              velocity[0] * 0.72,
              velocity[1] * 0.72,
              velocity[2] * 0.72,
            ];
          }

          gl.useProgram(displayProgram);
          gl.bindVertexArray(vertexArray);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, textures[readIndex]);
          gl.uniform1i(displayUniforms.u_state, 0);
          gl.uniform1f(displayUniforms.u_faceTexel, 1 / faceSize);
          gl.uniform1f(displayUniforms.u_angularStep, angularStep);
          gl.uniform2f(displayUniforms.u_resolution, canvas.width, canvas.height);
          gl.uniform1f(displayUniforms.u_time, simulationTime);
          gl.uniform2f(
            displayUniforms.u_cameraOrbit,
            cameraOrbitRef.current.yaw,
            cameraOrbitRef.current.pitch,
          );
          gl.uniform1f(displayUniforms.u_thickness, current.thickness);
          gl.uniform1f(displayUniforms.u_variation, current.variation);
          gl.uniform1f(displayUniforms.u_ior, current.refractiveIndex);
          gl.uniform1f(displayUniforms.u_saturation, current.saturation);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          animation = requestAnimationFrame(render);
        };

        queueMicrotask(() => onAvailabilityChange(true));
        animation = requestAnimationFrame(render);
        return () => {
          cancelAnimationFrame(animation);
          resetSimulationRef.current = () => {};
          for (const texture of textures) gl.deleteTexture(texture);
          for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
          gl.deleteBuffer(vertexBuffer);
          gl.deleteVertexArray(vertexArray);
          gl.deleteProgram(simulationProgram);
          gl.deleteProgram(displayProgram);
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

      const normalX = qx / radius;
      const normalY = qy / radius;
      const normalZ = Math.sqrt(Math.max(0, 1 - radial));
      const direction = screenNormalToWorldDirection(
        [normalX, normalY, normalZ],
        cameraOrbitRef.current,
      );
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
      const speed = Math.hypot(rawVelocity[0], rawVelocity[1], rawVelocity[2]);
      const velocityScale = speed > 0.28 ? 0.28 / speed : 1;
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
        filmPointerRef.current.down = 0;
        event.currentTarget.dataset.orbiting = "true";
      } else {
        updateFilmPointer(event, 1);
      }
    };

    const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const interaction = interactionRef.current;
      if (interaction.mode === "orbit") {
        const deltaX = event.clientX - interaction.lastClientX;
        const deltaY = event.clientY - interaction.lastClientY;
        cameraOrbitRef.current.yaw = (
          cameraOrbitRef.current.yaw + deltaX * 0.006
        ) % (Math.PI * 2);
        cameraOrbitRef.current.pitch = Math.max(
          -1.25,
          Math.min(1.25, cameraOrbitRef.current.pitch + deltaY * 0.006),
        );
        interaction.lastClientX = event.clientX;
        interaction.lastClientY = event.clientY;
        return;
      }
      if (interaction.mode === "film") updateFilmPointer(event);
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
        aria-label="Animated soap bubble thin-film interference simulation; Shift-drag rotates the scene"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      />
    );
  },
);
