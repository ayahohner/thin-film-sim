"use client";

import type { PresetName, SimulationParameters } from "./model";

type RangeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
};

function Range({ label, value, min, max, step, unit = "", onChange }: RangeProps) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="control-row">
      <span className="control-heading">
        <span>{label}</span>
        <output>{value.toFixed(decimals)}{unit}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

type ControlPanelProps = {
  parameters: SimulationParameters;
  paused: boolean;
  onParameterChange: (key: keyof SimulationParameters, value: number) => void;
  onPauseToggle: () => void;
  onPreset: (name: PresetName) => void;
  onReset: () => void;
};

export function ControlPanel({
  parameters,
  paused,
  onParameterChange,
  onPauseToggle,
  onPreset,
  onReset,
}: ControlPanelProps) {
  const range = (key: keyof SimulationParameters) => (
    value: number,
  ) => onParameterChange(key, value);

  return (
    <aside className="panel">
      <div className="panel-head">
        <div><p>CONTROL SURFACE</p><h2>Film parameters</h2></div>
        <button
          className="pause-button"
          onClick={onPauseToggle}
          aria-label={paused ? "Resume simulation" : "Pause simulation"}
        >
          {paused ? "▶" : "Ⅱ"}
        </button>
      </div>
      <div className="presets" aria-label="Simulation presets">
        <button onClick={() => onPreset("fresh")}>Fresh film</button>
        <button onClick={() => onPreset("draining")}>Draining</button>
        <button onClick={() => onPreset("aged")}>Aged film</button>
      </div>
      <div className="control-group">
        <h3>Optics</h3>
        <Range label="Mean thickness" value={parameters.thickness} min={20} max={1200} step={1} unit=" nm" onChange={range("thickness")} />
        <Range label="Thickness variation" value={parameters.variation} min={0} max={600} step={1} unit=" nm" onChange={range("variation")} />
        <Range label="Refractive index" value={parameters.refractiveIndex} min={1.05} max={1.8} step={0.01} onChange={range("refractiveIndex")} />
        <Range label="Color response" value={parameters.saturation} min={0} max={1.6} step={0.01} onChange={range("saturation")} />
      </div>
      <div className="control-group">
        <h3>Fluid model</h3>
        <Range label="Tangential gravity" value={parameters.gravity} min={0} max={1.5} step={0.01} onChange={range("gravity")} />
        <Range label="Surface tension" value={parameters.surfaceTension} min={0} max={1.5} step={0.01} onChange={range("surfaceTension")} />
        <Range label="Film viscosity" value={parameters.viscosity} min={0.02} max={1.5} step={0.01} onChange={range("viscosity")} />
        <Range label="Marangoni elasticity" value={parameters.marangoni} min={0} max={2} step={0.01} onChange={range("marangoni")} />
        <Range label="Surfactant diffusion" value={parameters.surfactantDiffusion} min={0} max={1} step={0.01} onChange={range("surfactantDiffusion")} />
        <Range label="Time scale" value={parameters.speed} min={0.1} max={12} step={0.1} unit="×" onChange={range("speed")} />
      </div>
      <button className="reset-button" onClick={onReset}>
        Reset experiment <span>↺</span>
      </button>
      <details className="formula-card">
        <summary>What is being calculated? <span>+</span></summary>
        <p>The GPU evolves <em>h, u, v, Γ</em>: thickness, two intrinsic tangent-velocity components, and insoluble surfactant concentration. Spherical metric terms couple semi-Lagrangian transport to capillary pressure, Marangoni stress, surface viscosity, diffusion, and gravity. Black film appears only when the solved thickness leaves the visible interference range.</p>
      </details>
    </aside>
  );
}
