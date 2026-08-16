"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BubbleCanvas,
  type BubbleCanvasHandle,
  type InteractionMode,
} from "./bubble/BubbleCanvas";
import { ControlPanel } from "./bubble/ControlPanel";
import {
  DEFAULT_PARAMETERS,
  parametersForPreset,
  type PresetName,
  type SimulationParameters,
} from "./bubble/model";

export default function Home() {
  const bubbleRef = useRef<BubbleCanvasHandle>(null);
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [paused, setPaused] = useState(false);
  const [available, setAvailable] = useState(true);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    "perturb",
  );
  const resetAfterStateUpdate = useCallback(() => {
    requestAnimationFrame(() => bubbleRef.current?.reset());
  }, []);

  const setParameter = useCallback((
    key: keyof SimulationParameters,
    value: number,
  ) => {
    setParameters((current) => ({ ...current, [key]: value }));
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    setParameters(parametersForPreset(name));
    resetAfterStateUpdate();
  }, [resetAfterStateUpdate]);

  const reset = useCallback(() => {
    setParameters(DEFAULT_PARAMETERS);
    resetAfterStateUpdate();
  }, [resetAfterStateUpdate]);

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("diagnostics") !== "1"
    ) return;
    const api = {
      ready: true,
      reset,
      pause: () => setPaused(true),
      resume: () => setPaused(false),
      setParameters: (next: Partial<SimulationParameters>) => {
        setParameters((current) => ({ ...current, ...next }));
        resetAfterStateUpdate();
      },
      setPreset: applyPreset,
      capture: () => bubbleRef.current?.capture() ?? null,
      report: () => bubbleRef.current?.diagnostics() ?? null,
    };
    window.__bubbleFilmLab = api;
    return () => {
      if (window.__bubbleFilmLab === api) delete window.__bubbleFilmLab;
    };
  }, [applyPreset, reset, resetAfterStateUpdate]);

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>BUBBLE FILM LAB</span>
        </div>
        <div className="status">
          <span className="status-dot" /> COUPLED THIN-FILM SOLVER
        </div>
      </header>

      <section className="workspace">
        <div className="stage">
          <BubbleCanvas
            ref={bubbleRef}
            parameters={parameters}
            paused={paused}
            interactionMode={interactionMode}
            onAvailabilityChange={setAvailable}
          />
          <div
            className="interaction-toggle"
            role="group"
            aria-label="Bubble drag behavior"
          >
            <button
              type="button"
              aria-pressed={interactionMode === "perturb"}
              onClick={() => setInteractionMode("perturb")}
            >
              Perturb
            </button>
            <button
              type="button"
              aria-pressed={interactionMode === "rotate"}
              onClick={() => setInteractionMode("rotate")}
            >
              Rotate
            </button>
          </div>
          {!available && (
            <div className="webgl-fallback">
              This simulation needs a browser with WebGL 2 enabled.
            </div>
          )}
        </div>
        <ControlPanel
          parameters={parameters}
          paused={paused}
          onParameterChange={setParameter}
          onPauseToggle={() => setPaused((current) => !current)}
          onPreset={applyPreset}
          onReset={reset}
        />
      </section>
    </main>
  );
}
