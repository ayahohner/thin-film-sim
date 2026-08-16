import {
  FIXED_STEP_SECONDS,
  MAX_SUBSTEPS_PER_FRAME,
  MODEL_SECONDS_PER_REAL_SECOND,
} from "./physics";

export type StepBatch = {
  steps: number;
  stepSeconds: number;
  simulatedSeconds: number;
  droppedSeconds: number;
};

/*
 * Real-time integration contract
 * ------------------------------
 * One wall-clock second adds exactly one model second at 1x. The fixed 1/120 s
 * step makes solver stability independent of display refresh rate and removes
 * the variable-step quantisation that previously appeared near the top of the
 * sphere. At 60 Hz, 12x requests 24 substeps; the 32-step ceiling leaves room
 * for normal frame jitter. If a tab stalls, old debt is dropped and reported
 * instead of taking one large, unstable step.
 *
 * This is the standard fixed-step accumulator pattern used for explicit PDE
 * integration; it changes numerical sampling, never the physical coefficients.
 */
export class FixedStepClock {
  private accumulator = 0;
  private elapsed = 0;
  private dropped = 0;

  reset() {
    this.accumulator = 0;
    this.elapsed = 0;
    this.dropped = 0;
  }

  advance(frameSeconds: number, speed: number): StepBatch {
    const added = Math.min(0.1, Math.max(0, frameSeconds))
      * Math.max(0, speed)
      * MODEL_SECONDS_PER_REAL_SECOND;
    this.accumulator += added;

    const requested = Math.floor(this.accumulator / FIXED_STEP_SECONDS);
    const steps = Math.min(MAX_SUBSTEPS_PER_FRAME, requested);
    const simulatedSeconds = steps * FIXED_STEP_SECONDS;
    this.accumulator -= simulatedSeconds;
    this.elapsed += simulatedSeconds;

    const maximumDebt = FIXED_STEP_SECONDS * MAX_SUBSTEPS_PER_FRAME;
    if (this.accumulator > maximumDebt) {
      const discarded = this.accumulator - maximumDebt;
      this.accumulator = maximumDebt;
      this.dropped += discarded;
    }

    return {
      steps,
      stepSeconds: FIXED_STEP_SECONDS,
      simulatedSeconds,
      droppedSeconds: this.dropped,
    };
  }

  get simulatedTime() {
    return this.elapsed;
  }
}
