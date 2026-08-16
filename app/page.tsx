"use client";

import { useCallback, useRef, useState } from "react";
import { BubbleCanvas, type BubbleCanvasHandle } from "./bubble/BubbleCanvas";
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

  const setParameter = useCallback((
    key: keyof SimulationParameters,
    value: number,
  ) => {
    setParameters((current) => ({ ...current, [key]: value }));
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    setParameters(parametersForPreset(name));
    bubbleRef.current?.reset();
  }, []);

  const reset = useCallback(() => {
    setParameters(DEFAULT_PARAMETERS);
    bubbleRef.current?.reset();
  }, []);

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
            onAvailabilityChange={setAvailable}
          />
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
