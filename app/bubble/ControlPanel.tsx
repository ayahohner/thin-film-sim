"use client";

import type {
  ColorGrade,
  PresetName,
  SimulationParameters,
} from "./model";

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
  const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
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
  colorGrade: ColorGrade;
  contrast: number;
  onParameterChange: (key: keyof SimulationParameters, value: number) => void;
  onColorGradeChange: (grade: ColorGrade) => void;
  onContrastChange: (contrast: number) => void;
  onPauseToggle: () => void;
  onPreset: (name: PresetName) => void;
  onReset: () => void;
};

export function ControlPanel({
  parameters,
  paused,
  colorGrade,
  contrast,
  onParameterChange,
  onColorGradeChange,
  onContrastChange,
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
        <Range label="Mean thickness" value={parameters.thickness} min={20} max={2500} step={1} unit=" nm" onChange={range("thickness")} />
        <Range label="Thickness variation" value={parameters.variation} min={0} max={1500} step={1} unit=" nm" onChange={range("variation")} />
        <Range label="Refractive index" value={parameters.refractiveIndex} min={1.28} max={1.45} step={0.001} onChange={range("refractiveIndex")} />
        <Range label="Color response" value={parameters.saturation} min={0} max={1.6} step={0.01} onChange={range("saturation")} />
      </div>
      <div className="control-group">
        <h3>Fluid model</h3>
        <Range label="Gravity" value={parameters.gravity} min={0} max={20} step={0.1} unit=" m/s²" onChange={range("gravity")} />
        <Range label="Surface tension" value={parameters.surfaceTension} min={10} max={80} step={0.5} unit=" mN/m" onChange={range("surfaceTension")} />
        <Range label="Bulk viscosity" value={parameters.viscosity} min={0.5} max={40} step={0.1} unit=" mPa·s" onChange={range("viscosity")} />
        <Range label="Gibbs elasticity" value={parameters.marangoni} min={0} max={120} step={1} unit=" mN/m" onChange={range("marangoni")} />
        <Range label="Surface diffusivity" value={parameters.surfactantDiffusion} min={0} max={2000} step={10} unit=" µm²/s" onChange={range("surfactantDiffusion")} />
        <Range label="Evaporation" value={parameters.evaporation} min={0} max={40} step={0.1} unit=" nm/s" onChange={range("evaporation")} />
        <Range label="Ambient ΔT" value={parameters.thermalGradient} min={0} max={12} step={0.05} unit=" K" onChange={range("thermalGradient")} />
        <Range label="Time scale" value={parameters.speed} min={0.1} max={12} step={0.1} unit="×" onChange={range("speed")} />
      </div>
      <button className="reset-button" onClick={onReset}>
        Reset experiment <span>↺</span>
      </button>
      <details className="formula-card">
        <summary>What is being calculated? <span>+</span></summary>
        <p>The GPU evolves physical thickness, tangential momentum, insoluble surfactant, and temperature on one closed icosahedral manifold. Cotangent operators, conservative dual-edge fluxes, and spherical parallel transport avoid an atlas, seam, or pole. Lubrication capillarity, SI gravity, Langmuir Marangoni stress, evaporation, and DLVO pressure use published forms; unresolved cross-film and air coupling use an explicitly documented partially-mobile-interface closure. At 1×, one model second is exactly one wall-clock second.</p>
      </details>
      <div className="display-controls">
        <h3>Display grade</h3>
        <div
          className="grade-toggle"
          role="radiogroup"
          aria-label="Lighting color grade"
        >
          {(["default", "filmic", "neutral", "vivid"] as const).map(
            (grade) => (
              <button
                key={grade}
                type="button"
                role="radio"
                aria-checked={colorGrade === grade}
                onClick={() => onColorGradeChange(grade)}
              >
                {grade}
              </button>
            ),
          )}
        </div>
        <Range
          label="Contrast"
          value={contrast}
          min={0.5}
          max={1.8}
          step={0.01}
          unit="×"
          onChange={onContrastChange}
        />
      </div>
    </aside>
  );
}
