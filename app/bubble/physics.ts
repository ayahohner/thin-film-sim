/*
 * Physical scales and reduced-order closures
 * ------------------------------------------
 * State is stored on a unit icosphere, but every rate below is expressed in SI
 * seconds and converted with a 15 mm physical radius. Thickness is absolute,
 * not a display phase. A 20 nm lower bound prevents division by zero; it is
 * below a typical common-black-film equilibrium (~45 nm) and is not itself a
 * claim that DLVO forces are resolved at molecular scale.
 *
 * The PDE is a real-time surface-transport model, not a depth-resolved DNS.
 * `DRAINAGE_SPEED_AT_STANDARD_GRAVITY` and `INTERFACIAL_RELAXATION_RATE` are
 * deliberately named reduced-order closures: unresolved cross-film shear,
 * surface viscosity and air coupling collapse into a terminal interfacial
 * mobility. They are calibrated to the observed mm/s order of partially mobile
 * centimetre-scale soap films. Gravity still enters linearly in SI m/s^2 and
 * 9.81 means standard Earth gravity; these constants do not secretly rescale
 * model time.
 * The buoyancy/Marangoni response constants share that same status: they retain
 * the derived gradient directions and SI parameter scaling, but encode the
 * unresolved mobility multiplying those stresses. Keep them here (never hidden
 * in shader arithmetic) so calibration changes are reviewable and testable.
 *
 * Primary model references:
 * - Lalli & Giusti, JFM 986 A7 (2024), especially (2.28), (2.52-2.63),
 *   and Appendix C: https://doi.org/10.1017/jfm.2024.335
 * - Seychelles et al., PRL 100, 144501 (2008), thermal convection on a
 *   hemispherical soap bubble: https://doi.org/10.1103/PhysRevLett.100.144501
 */
export const BUBBLE_RADIUS_METERS = 0.015;
export const WATER_DENSITY = 997;
export const FILM_THICKNESS_RANGE_MICRONS = 3;
export const MIN_FILM_THICKNESS_MICRONS = 0.020;
export const VELOCITY_RANGE = 0.36;
export const TEMPERATURE_RANGE = 8;

export const MODEL_SECONDS_PER_REAL_SECOND = 1;
export const FIXED_STEP_SECONDS = 1 / 120;
export const MAX_SUBSTEPS_PER_FRAME = 32;
export const TARGET_FRAME_RATE = 60;

export const DRAINAGE_SPEED_AT_STANDARD_GRAVITY = 0.055;
export const INTERFACIAL_RELAXATION_RATE = 1.15;
export const THICKNESS_BUOYANCY_RESPONSE = 1.35;
export const SURFACTANT_MARANGONI_RESPONSE = 0.32;
export const THERMAL_MARANGONI_RESPONSE = 0.028;
export const THERMAL_DIFFUSIVITY = 1.4e-7;
export const WATER_SURFACE_TENSION_TEMPERATURE_SLOPE = 0.00015;

/*
 * Representative DLVO closure for an aqueous ionic surfactant film.
 * Pi(h) = -A/(6*pi*h^3) + B*exp(-h/lambda_D).
 * These chemistry-dependent values give a common-black-film scale of tens of
 * nanometres. They replace the previous arbitrary "black-film repulsion".
 * See Lalli & Giusti (2024), eq. 2.63 and its limitations: DLVO alone is not
 * generally sufficient for Newton black films, where steric/solvation forces
 * can matter.
 */
export const HAMAKER_CONSTANT_JOULES = 1e-20;
export const DOUBLE_LAYER_PRESSURE_PASCALS = 350;
export const DEBYE_LENGTH_METERS = 10e-9;

export function encodeThicknessMicrons(thicknessMicrons: number) {
  return Math.max(
    MIN_FILM_THICKNESS_MICRONS,
    Math.min(FILM_THICKNESS_RANGE_MICRONS, thicknessMicrons),
  ) / FILM_THICKNESS_RANGE_MICRONS;
}

export function decodeThicknessMicrons(encoded: number) {
  return encoded * FILM_THICKNESS_RANGE_MICRONS;
}

export function encodedEvaporationRate(evaporationNanometersPerSecond: number) {
  return evaporationNanometersPerSecond * 1e-3
    / FILM_THICKNESS_RANGE_MICRONS;
}

export function physicalSurfaceSpeed(angularSpeed: number) {
  return angularSpeed * BUBBLE_RADIUS_METERS;
}
