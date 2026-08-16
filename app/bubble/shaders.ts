import {
  BUBBLE_RADIUS_METERS,
  DEBYE_LENGTH_METERS,
  DOUBLE_LAYER_PRESSURE_PASCALS,
  DRAINAGE_SPEED_AT_STANDARD_GRAVITY,
  FILM_THICKNESS_RANGE_MICRONS,
  HAMAKER_CONSTANT_JOULES,
  INTERFACIAL_RELAXATION_RATE,
  MIN_FILM_THICKNESS_MICRONS,
  SURFACTANT_MARANGONI_RESPONSE,
  TEMPERATURE_RANGE,
  THERMAL_MARANGONI_RESPONSE,
  THERMAL_DIFFUSIVITY,
  THICKNESS_BUOYANCY_RESPONSE,
  VELOCITY_RANGE,
  WATER_DENSITY,
} from "./physics";

export const fullscreenVertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/*
 * Mixed fourth-order solve, pass 1 of 2.
 *
 * The lubrication pressure contains a Laplace-Beltrami thickness term, making
 * capillary drainage fourth order. Computing Delta(h) once avoids the previous
 * nested six-by-six stencil in every simulation pass. This follows the mixed
 * second-order treatment recommended for thin-film PDEs by Lalli & Giusti,
 * JFM 986 A7 (2024), section 2.7: https://doi.org/10.1017/jfm.2024.335
 */
export const geometryShader = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 outGeometry;

uniform sampler2D u_state0;
uniform sampler2D u_neighbors;
uniform ivec2 u_stateSize;
uniform int u_vertexCount;

ivec2 indexCoord(int index) {
  return ivec2(index % u_stateSize.x, index / u_stateSize.x);
}

vec4 neighborAt(int index, int slot) {
  ivec2 coordinate = indexCoord(index);
  coordinate.y += slot * u_stateSize.y;
  return texelFetch(u_neighbors, coordinate, 0);
}

void main() {
  ivec2 coordinate = ivec2(gl_FragCoord.xy);
  int index = coordinate.y * u_stateSize.x + coordinate.x;
  if (index >= u_vertexCount) {
    outGeometry = vec4(0.0);
    return;
  }
  float center = texelFetch(u_state0, coordinate, 0).r;
  float laplacian = 0.0;
  for (int slot = 0; slot < 6; slot += 1) {
    vec4 neighbor = neighborAt(index, slot);
    if (neighbor.r >= 0.0) {
      int neighborIndex = int(neighbor.r + 0.5);
      float neighborHeight = texelFetch(
        u_state0, indexCoord(neighborIndex), 0
      ).r;
      laplacian += neighbor.g * (neighborHeight - center);
    }
  }
  outGeometry = vec4(laplacian, 0.0, 0.0, 1.0);
}`;

/*
 * Intrinsic reduced-order thin-film solver
 * ----------------------------------------
 * This is a vertex-centred finite-volume/DEC-inspired discretisation on one
 * closed simplicial sphere. It evolves conservative thickness, tangential
 * momentum, insoluble surfactant, and temperature. It is not a full 3-D DNS:
 * cross-film shear, surface rheology and air coupling are collapsed into the
 * explicitly named interfacial-mobility closure below.
 *
 * Research-backed terms:
 * - mass/evaporation, lubrication pressure, gravity flux, Langmuir surfactant
 *   transport and DLVO pressure: Lalli & Giusti, JFM 986 A7 (2024), equations
 *   2.28, 2.52-2.63 and C1: https://doi.org/10.1017/jfm.2024.335
 * - covariant vector viscosity and curvature correction on a sphere:
 *   Nitschke, Reuther & Voigt (2017): https://arxiv.org/abs/1611.04392
 * - symmetric conservative edge operators and parallel transport:
 *   Jagad et al. (2020): https://arxiv.org/abs/2010.15520
 * - thermally driven bubble convection as the physical forcing regime:
 *   Seychelles et al., PRL 100, 144501 (2008):
 *   https://doi.org/10.1103/PhysRevLett.100.144501
 *
 * Numerical-only term: the local Rusanov flux is an entropy stabiliser for
 * transport. Its diffusion is proportional to the actual edge speed and is
 * exactly zero at rest; it is not presented as film physics.
 */
export const simulationShader = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 outState0;
layout(location = 1) out vec4 outState1;

uniform sampler2D u_state0;
uniform sampler2D u_state1;
uniform sampler2D u_positions;
uniform sampler2D u_neighbors;
uniform sampler2D u_geometry;
uniform ivec2 u_stateSize;
uniform int u_vertexCount;
uniform float u_dt;
uniform float u_time;
uniform float u_gravity;
uniform float u_surfaceTension;
uniform float u_viscosity;
uniform float u_marangoni;
uniform float u_diffusion;
uniform float u_evaporation;
uniform float u_thermalGradient;
uniform vec3 u_pointerDirection;
uniform vec3 u_pointerVelocity;
uniform float u_pointerDown;

const float VELOCITY_RANGE = ${VELOCITY_RANGE.toFixed(8)};
const float TEMPERATURE_RANGE = ${TEMPERATURE_RANGE.toFixed(8)};
const float THICKNESS_RANGE_UM = ${FILM_THICKNESS_RANGE_MICRONS.toFixed(8)};
const float MIN_THICKNESS_UM = ${MIN_FILM_THICKNESS_MICRONS.toFixed(8)};
const float BUBBLE_RADIUS = ${BUBBLE_RADIUS_METERS.toFixed(8)};
const float WATER_DENSITY = ${WATER_DENSITY.toFixed(4)};
const float DRAINAGE_SPEED_AT_G = ${DRAINAGE_SPEED_AT_STANDARD_GRAVITY.toFixed(8)};
const float INTERFACIAL_RELAXATION = ${INTERFACIAL_RELAXATION_RATE.toFixed(8)};
const float THICKNESS_BUOYANCY_RESPONSE = ${THICKNESS_BUOYANCY_RESPONSE.toFixed(8)};
const float SURFACTANT_MARANGONI_RESPONSE = ${SURFACTANT_MARANGONI_RESPONSE.toFixed(8)};
const float THERMAL_MARANGONI_RESPONSE = ${THERMAL_MARANGONI_RESPONSE.toFixed(8)};
const float THERMAL_DIFFUSIVITY = ${THERMAL_DIFFUSIVITY.toExponential(8)};
const float HAMAKER_CONSTANT = ${HAMAKER_CONSTANT_JOULES.toExponential(8)};
const float DOUBLE_LAYER_PRESSURE = ${DOUBLE_LAYER_PRESSURE_PASCALS.toFixed(8)};
const float DEBYE_LENGTH = ${DEBYE_LENGTH_METERS.toExponential(8)};
const float WATER_HEAT_CAPACITY = 4180.0;
const float WATER_LATENT_HEAT = 2.40e6;

ivec2 indexCoord(int index) {
  return ivec2(index % u_stateSize.x, index / u_stateSize.x);
}

vec4 state0At(int index) { return texelFetch(u_state0, indexCoord(index), 0); }
vec4 state1At(int index) { return texelFetch(u_state1, indexCoord(index), 0); }
vec3 positionAt(int index) { return texelFetch(u_positions, indexCoord(index), 0).xyz; }
float laplaceHeightAt(int index) {
  return texelFetch(u_geometry, indexCoord(index), 0).r;
}

vec4 neighborAt(int index, int slot) {
  ivec2 coordinate = indexCoord(index);
  coordinate.y += slot * u_stateSize.y;
  return texelFetch(u_neighbors, coordinate, 0);
}

vec3 decodeVelocity(vec4 state) {
  return (state.gba * 2.0 - 1.0) * VELOCITY_RANGE;
}

vec3 parallelTransport(vec3 vector, vec3 from, vec3 to) {
  return vector - (dot(vector, to) / max(1.0 + dot(from, to), 0.0001))
    * (from + to);
}

vec3 clampMagnitude(vec3 vector, float limit) {
  float magnitude = length(vector);
  return magnitude > limit ? vector * (limit / magnitude) : vector;
}

/* DLVO pressure for the full physical film thickness, in pascals. */
float disjoiningPressure(float thicknessMeters) {
  float h = max(thicknessMeters, MIN_THICKNESS_UM * 1.0e-6);
  return -HAMAKER_CONSTANT / (6.0 * 3.14159265359 * h * h * h)
    + DOUBLE_LAYER_PRESSURE * exp(-h / DEBYE_LENGTH);
}

void tangentFrame(vec3 normal, out vec3 tangentA, out vec3 tangentB) {
  vec3 reference = abs(normal.z) < 0.88
    ? vec3(0.0, 0.0, 1.0)
    : vec3(0.0, 1.0, 0.0);
  tangentA = normalize(cross(reference, normal));
  tangentB = normalize(cross(normal, tangentA));
}

vec2 solveGradient(float rhsX, float rhsY, float mxx, float mxy, float myy) {
  float determinant = max(mxx * myy - mxy * mxy, 0.000001);
  return vec2(
    (rhsX * myy - rhsY * mxy) / determinant,
    (rhsY * mxx - rhsX * mxy) / determinant
  );
}

void main() {
  ivec2 coordinate = ivec2(gl_FragCoord.xy);
  int index = coordinate.y * u_stateSize.x + coordinate.x;
  if (index >= u_vertexCount) {
    outState0 = vec4(0.2, 0.5, 0.5, 0.5);
    outState1 = vec4(0.5, 0.5, 0.0, 1.0);
    return;
  }

  vec3 normal = normalize(positionAt(index));
  vec4 center0 = state0At(index);
  vec4 center1 = state1At(index);
  float height = center0.r;
  float surfactant = center1.r;
  float temperature = (center1.g * 2.0 - 1.0) * TEMPERATURE_RANGE;
  float thicknessScaleMeters = THICKNESS_RANGE_UM * 1.0e-6;
  float physicalThickness = max(
    height * thicknessScaleMeters,
    MIN_THICKNESS_UM * 1.0e-6
  );
  float viscosityPascalSeconds = max(u_viscosity * 1.0e-3, 1.0e-6);
  float centerDisjoiningPressure = disjoiningPressure(physicalThickness);
  vec3 velocity = decodeVelocity(center0);
  velocity -= normal * dot(velocity, normal);
  float laplaceHeight = laplaceHeightAt(index);

  vec3 tangentA;
  vec3 tangentB;
  tangentFrame(normal, tangentA, tangentB);
  float mxx = 0.0;
  float mxy = 0.0;
  float myy = 0.0;
  float rhsHeightX = 0.0;
  float rhsHeightY = 0.0;
  float rhsSurfactantX = 0.0;
  float rhsSurfactantY = 0.0;
  float rhsTemperatureX = 0.0;
  float rhsTemperatureY = 0.0;
  float laplaceSurfactantPotential = 0.0;
  float laplaceTemperature = 0.0;
  float biLaplacianHeight = 0.0;
  vec3 laplaceVelocity = vec3(0.0);
  float neighborHeightSum = 0.0;
  float neighborCount = 0.0;
  float heightRate = 0.0;
  float surfactantRate = 0.0;
  float temperatureRate = 0.0;
  vec3 momentumRate = vec3(0.0);
  vec3 gravityTangent = vec3(0.0, -1.0, 0.0) + normal * normal.y;

  for (int slot = 0; slot < 6; slot += 1) {
    vec4 neighbor = neighborAt(index, slot);
    if (neighbor.r < 0.0) continue;
    int neighborIndex = int(neighbor.r + 0.5);
    vec3 neighborNormal = normalize(positionAt(neighborIndex));
    vec4 neighbor0 = state0At(neighborIndex);
    vec4 neighbor1 = state1At(neighborIndex);
    float neighborHeight = neighbor0.r;
    float neighborSurfactant = neighbor1.r;
    float neighborTemperature = (neighbor1.g * 2.0 - 1.0)
      * TEMPERATURE_RANGE;
    float neighborLaplace = laplaceHeightAt(neighborIndex);
    float neighborPhysicalThickness = max(
      neighborHeight * thicknessScaleMeters,
      MIN_THICKNESS_UM * 1.0e-6
    );
    float neighborDisjoiningPressure = disjoiningPressure(
      neighborPhysicalThickness
    );
    vec3 neighborVelocity = parallelTransport(
      decodeVelocity(neighbor0), neighborNormal, normal
    );

    float cosine = clamp(dot(normal, neighborNormal), -1.0, 1.0);
    float distance = max(acos(cosine), 0.0001);
    vec3 edgeDirection = normalize(neighborNormal - normal * cosine);
    float x = distance * dot(edgeDirection, tangentA);
    float y = distance * dot(edgeDirection, tangentB);
    float leastSquaresWeight = 1.0 / (distance * distance);
    mxx += leastSquaresWeight * x * x;
    mxy += leastSquaresWeight * x * y;
    myy += leastSquaresWeight * y * y;
    rhsHeightX += leastSquaresWeight * x * (neighborHeight - height);
    rhsHeightY += leastSquaresWeight * y * (neighborHeight - height);
    rhsSurfactantX += leastSquaresWeight * x
      * (neighborSurfactant - surfactant);
    rhsSurfactantY += leastSquaresWeight * y
      * (neighborSurfactant - surfactant);
    rhsTemperatureX += leastSquaresWeight * x
      * (neighborTemperature - temperature);
    rhsTemperatureY += leastSquaresWeight * y
      * (neighborTemperature - temperature);

    float centerSurfactantPotential = -log(max(1.0 - surfactant, 0.001));
    float neighborSurfactantPotential = -log(
      max(1.0 - neighborSurfactant, 0.001)
    );
    laplaceSurfactantPotential += neighbor.g
      * (neighborSurfactantPotential - centerSurfactantPotential);
    laplaceTemperature += neighbor.g * (neighborTemperature - temperature);
    biLaplacianHeight += neighbor.g * (neighborLaplace - laplaceHeight);
    laplaceVelocity += neighbor.g * (neighborVelocity - velocity);
    neighborHeightSum += neighborHeight;
    neighborCount += 1.0;

    vec3 edgeVelocity = (velocity + neighborVelocity) * 0.5;
    float normalFlow = dot(edgeVelocity, edgeDirection);
    float entropySpeed = min(abs(normalFlow), 0.030);
    float fluxWeight = neighbor.b;
    float heightFlux = normalFlow * (height + neighborHeight) * 0.5
      - 0.5 * entropySpeed * (neighborHeight - height);

    /*
     * Depth-averaged lubrication fluxes in physical SI units. The gravity term
     * is rho*g*h^3/(3*mu); the DLVO term is h^3 grad(Pi)/(3*mu).
     * Division by H_range*R converts m^2/s to encoded angular flux, while the
     * symmetric dual-edge divergence supplies the remaining 1/radian.
     */
    float faceThickness = 0.5
      * (physicalThickness + neighborPhysicalThickness);
    float cubicMobility = faceThickness * faceThickness * faceThickness
      / (3.0 * viscosityPascalSeconds);
    float gravityFilmFlux = cubicMobility * WATER_DENSITY * u_gravity
      / (thicknessScaleMeters * BUBBLE_RADIUS)
      * dot(gravityTangent, edgeDirection);
    float disjoiningFilmFlux = cubicMobility
      / (thicknessScaleMeters * BUBBLE_RADIUS * BUBBLE_RADIUS)
      * (neighborDisjoiningPressure - centerDisjoiningPressure) / distance;
    heightFlux += gravityFilmFlux + disjoiningFilmFlux;
    float surfactantFlux = normalFlow
      * (surfactant + neighborSurfactant) * 0.5
      - 0.5 * entropySpeed * (neighborSurfactant - surfactant);
    float temperatureFlux = normalFlow
      * (temperature + neighborTemperature) * 0.5
      - 0.5 * entropySpeed * (neighborTemperature - temperature);
    vec3 centerMomentum = height * velocity;
    vec3 neighborMomentum = neighborHeight * neighborVelocity;
    vec3 momentumFlux = normalFlow
      * (centerMomentum + neighborMomentum) * 0.5
      - 0.5 * entropySpeed * (neighborMomentum - centerMomentum);
    heightRate -= fluxWeight * heightFlux;
    surfactantRate -= fluxWeight * surfactantFlux;
    temperatureRate -= fluxWeight * temperatureFlux;
    momentumRate -= fluxWeight * momentumFlux;
  }

  vec2 gradHeightComponents = solveGradient(
    rhsHeightX, rhsHeightY, mxx, mxy, myy
  );
  vec2 gradSurfactantComponents = solveGradient(
    rhsSurfactantX, rhsSurfactantY, mxx, mxy, myy
  );
  vec2 gradTemperatureComponents = solveGradient(
    rhsTemperatureX, rhsTemperatureY, mxx, mxy, myy
  );
  vec3 gradHeight = tangentA * gradHeightComponents.x
    + tangentB * gradHeightComponents.y;
  vec3 gradSurfactant = tangentA * gradSurfactantComponents.x
    + tangentB * gradSurfactantComponents.y;
  vec3 gradTemperature = tangentA * gradTemperatureComponents.x
    + tangentB * gradTemperatureComponents.y;

  float localMeanHeight = neighborHeightSum / max(neighborCount, 1.0);
  float relativeThickness = (height - localMeanHeight)
    / max(localMeanHeight, 0.002);
  float gravityRatio = u_gravity / 9.81;
  /*
   * Partially-mobile interface closure.
   *
   * A depth-resolved free film does not have a universal no-slip terminal law.
   * We therefore relax toward a measured-order (sub-mm/s physical) drainage
   * velocity instead of pretending that an arbitrary coefficient is g. The UI
   * gravity remains an SI input and scales this target linearly. Thickness
   * contrast supplies the observed two-dimensional buoyancy of thin patches
   * (Adami & Caps 2014, https://doi.org/10.1209/0295-5075/106/46001).
   */
  float mobilityContrast = clamp(
    1.0 + THICKNESS_BUOYANCY_RESPONSE * relativeThickness, -0.35, 2.4
  );
  vec3 targetDrainageVelocity = gravityTangent
    * DRAINAGE_SPEED_AT_G * gravityRatio * mobilityContrast;
  vec3 acceleration = INTERFACIAL_RELAXATION
    * (targetDrainageVelocity - velocity);

  /* Langmuir equation of state: grad(sigma) is proportional to
     -grad(Gamma)/(1-Gamma), rather than an arbitrary coloured-noise force. */
  acceleration -= SURFACTANT_MARANGONI_RESPONSE * (u_marangoni / 18.0)
    * gradSurfactant / max(1.0 - surfactant, 0.08);
  acceleration -= THERMAL_MARANGONI_RESPONSE * gradTemperature;

  float angularViscosity = (u_viscosity * 1.0e-6)
    / (BUBBLE_RADIUS * BUBBLE_RADIUS);
  acceleration += angularViscosity * (laplaceVelocity + 2.0 * velocity);

  float pointerInfluence = exp(
    -(1.0 - dot(normal, u_pointerDirection)) * 48.0
  ) * u_pointerDown;
  acceleration += parallelTransport(
    u_pointerVelocity, u_pointerDirection, normal
  ) * pointerInfluence * 1.8;
  acceleration = clampMagnitude(
    acceleration - normal * dot(acceleration, normal), 0.45
  );

  float surfaceDiffusion = u_diffusion * 1.0e-12
    / (BUBBLE_RADIUS * BUBBLE_RADIUS);
  /* Thermodynamically consistent Langmuir surface diffusion,
     J_D = -D grad(Gamma)/(1-Gamma), Lalli & Giusti eq. 2.56. */
  surfactantRate += surfaceDiffusion * laplaceSurfactantPotential;
  temperatureRate += THERMAL_DIFFUSIVITY
    / (BUBBLE_RADIUS * BUBBLE_RADIUS) * laplaceTemperature;

  /*
   * Air-side thermal boundary closure.
   * The browser cannot resolve 3-D air convection at 60 fps. These two
   * lowest-order, slowly varying ambient modes prescribe heat/mass-transfer
   * coefficients only; they do not add momentum or paint thickness. The film
   * responds through the energy equation, evaporation, and Marangoni stress.
   */
  float slowModeA = sin(
    4.3 * dot(normal, normalize(vec3(0.72, 0.28, 0.63)))
    + 0.075 * u_time
  );
  float slowModeB = sin(
    6.1 * dot(normal, normalize(vec3(-0.26, 0.91, 0.32)))
    - 0.052 * u_time + 1.4
  );
  float ambientShape = 0.44 * (1.0 - abs(normal.y))
    - 0.26 * normal.y + 0.15 * normal.x * normal.z
    + 0.12 * slowModeA + 0.08 * slowModeB;
  float targetTemperature = u_thermalGradient * ambientShape;
  float evaporationFlux = u_evaporation * (
    1.0 + 0.22 * normal.y + 0.12 * slowModeA + 0.08 * slowModeB
  );
  float evaporationMetersPerSecond = evaporationFlux * 1.0e-9;
  float evaporativeCoolingRate = WATER_LATENT_HEAT
    * evaporationMetersPerSecond
    / (max(physicalThickness, 40.0e-9) * WATER_HEAT_CAPACITY);
  temperatureRate += 0.70 * (targetTemperature - temperature);
  temperatureRate -= evaporativeCoolingRate;

  /* Lubrication capillarity: -gamma*h^3*Delta^2(h)/(3*mu*R^4). */
  float capillaryMobility = (
    u_surfaceTension * 1.0e-3
    * physicalThickness * physicalThickness * physicalThickness
  ) / (
    3.0 * viscosityPascalSeconds
    * pow(BUBBLE_RADIUS, 4.0)
  );
  heightRate -= capillaryMobility * biLaplacianHeight;
  heightRate -= evaporationFlux * 1.0e-3 / THICKNESS_RANGE_UM;

  float minimumHeight = MIN_THICKNESS_UM / THICKNESS_RANGE_UM;
  float newHeight = clamp(
    height + u_dt * heightRate,
    minimumHeight,
    1.0
  );
  vec3 newMomentum = height * velocity
    + u_dt * (momentumRate + height * acceleration);
  vec3 newVelocity = newMomentum / max(newHeight, minimumHeight);
  newVelocity -= normal * dot(newVelocity, normal);
  newVelocity = clampMagnitude(newVelocity, VELOCITY_RANGE);
  float newSurfactant = clamp(
    surfactant + u_dt * surfactantRate, 0.15, 0.85
  );
  float newTemperature = clamp(
    temperature + u_dt * temperatureRate,
    -TEMPERATURE_RANGE,
    TEMPERATURE_RANGE
  );

  outState0 = vec4(
    newHeight,
    newVelocity / VELOCITY_RANGE * 0.5 + 0.5
  );
  outState1 = vec4(
    newSurfactant,
    newTemperature / TEMPERATURE_RANGE * 0.5 + 0.5,
    clamp(length(gradHeight) * 0.08, 0.0, 1.0),
    1.0
  );
}`;

export const bubbleVertexShader = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_stateUv;
uniform sampler2D u_state0;
uniform vec2 u_resolution;
uniform vec2 u_cameraOrbit;
out float v_height;
out vec3 v_viewNormal;

vec3 rotateX(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 worldNormal = normalize(a_position);
  vec3 viewNormal = rotateX(
    rotateY(worldNormal, -u_cameraOrbit.x),
    -u_cameraOrbit.y
  );
  float aspect = u_resolution.x / u_resolution.y;
  float radius = min(0.425 * aspect, 0.455);
  gl_Position = vec4(
    viewNormal.x * 2.0 * radius / aspect,
    viewNormal.y * 2.0 * radius,
    -viewNormal.z * 0.55,
    1.0
  );
  v_height = texture(u_state0, a_stateUv).r;
  v_viewNormal = viewNormal;
}`;

export const bubbleFragmentShader = `#version 300 es
precision highp float;
in float v_height;
in vec3 v_viewNormal;
out vec4 outColor;

uniform float u_ior;
uniform float u_saturation;
uniform vec2 u_cameraOrbit;
uniform int u_colorGrade;
uniform float u_contrast;

const float TWO_PI = 6.28318530718;
const float THICKNESS_RANGE_NM = ${(FILM_THICKNESS_RANGE_MICRONS * 1000).toFixed(4)};

float airyReflectance(float interfaceR, float beta) {
  float sinBeta2 = pow(sin(beta), 2.0);
  float numerator = 4.0 * interfaceR * sinBeta2;
  return numerator / max(pow(1.0 - interfaceR, 2.0) + numerator, 0.000001);
}

float filmReflectance(float lambda, float thickness, float cosIncident) {
  float sinTransmitted2 = max(0.0, 1.0 - cosIncident * cosIncident)
    / (u_ior * u_ior);
  float cosTransmitted = sqrt(max(0.0001, 1.0 - sinTransmitted2));
  float rs = (cosIncident - u_ior * cosTransmitted)
    / max(cosIncident + u_ior * cosTransmitted, 0.0001);
  float rp = (u_ior * cosIncident - cosTransmitted)
    / max(u_ior * cosIncident + cosTransmitted, 0.0001);
  float beta = TWO_PI * u_ior * thickness * cosTransmitted / lambda;
  return 0.5 * (
    airyReflectance(rs * rs, beta) + airyReflectance(rp * rp, beta)
  );
}

vec3 spectrum(float thickness, float cosIncident) {
  vec3 color = vec3(0.0);
  color += filmReflectance(420.0, thickness, cosIncident) * vec3(0.34, 0.02, 0.90) * 0.74;
  color += filmReflectance(455.0, thickness, cosIncident) * vec3(0.08, 0.18, 1.00) * 0.92;
  color += filmReflectance(490.0, thickness, cosIncident) * vec3(0.00, 0.72, 0.82) * 1.02;
  color += filmReflectance(525.0, thickness, cosIncident) * vec3(0.08, 1.00, 0.25) * 1.05;
  color += filmReflectance(565.0, thickness, cosIncident) * vec3(0.75, 0.95, 0.02) * 1.03;
  color += filmReflectance(600.0, thickness, cosIncident) * vec3(1.00, 0.48, 0.00) * 0.98;
  color += filmReflectance(640.0, thickness, cosIncident) * vec3(1.00, 0.08, 0.01) * 0.91;
  color += filmReflectance(680.0, thickness, cosIncident) * vec3(0.72, 0.00, 0.02) * 0.72;
  return color * 0.42;
}

vec3 rotateX(vec3 direction, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(
    direction.x,
    c * direction.y - s * direction.z,
    s * direction.y + c * direction.z
  );
}

vec3 rotateY(vec3 direction, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(
    c * direction.x + s * direction.z,
    direction.y,
    -s * direction.x + c * direction.z
  );
}

/*
 * World-fixed illumination under a camera orbit.
 *
 * The vertex shader applies this same inverse yaw/pitch transform to surface
 * normals. Applying it to world-space light directions expresses the lights
 * in view space without moving them with the camera. This is the directional
 * part of the standard world -> view change of basis; directions do not need
 * translation. The specular lobe then moves across the sphere as the camera
 * orbits, while the simulated film remains attached to the spherical surface.
 *
 * At the mirror direction, the view and light incidence angles are equal, so
 * the already evaluated Airy thin-film spectrum is reused to tint the source
 * reflection. Reuse avoids another wavelength quadrature per light and keeps
 * the fragment cost essentially unchanged for the 60 fps target.
 */
vec3 worldToViewDirection(vec3 worldDirection) {
  return rotateX(
    rotateY(worldDirection, -u_cameraOrbit.x),
    -u_cameraOrbit.y
  );
}

/*
 * Display-referred looks, applied only after the physical Airy reflectance and
 * world-space lighting have been evaluated. They cannot feed energy back into
 * the thin-film solver. "Filmic" uses the inexpensive ACES fitted curve from
 * Narkowicz (2015); "Neutral" uses the global Reinhard (2002) luminance
 * operator; "Vivid" combines the ACES shoulder with a restrained chroma lift.
 * The default branch remains bit-for-bit equivalent at contrast 1.0.
 *
 * Contrast is a luminance-domain power curve around photographic middle gray
 * (18%). Scaling RGB by the luminance ratio preserves the interference hue and
 * avoids independent-channel clipping before the selected tone curve.
 */
vec3 applyContrast(vec3 color, float contrast) {
  if (abs(contrast - 1.0) < 0.0001) {
    return color;
  }
  float luminance = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.00001);
  float adjusted = 0.18 * pow(luminance / 0.18, contrast);
  return color * (adjusted / luminance);
}

vec3 acesFitted(vec3 color) {
  return clamp(
    color * (2.51 * color + 0.03)
      / (color * (2.43 * color + 0.59) + 0.14),
    0.0,
    1.0
  );
}

vec3 applyColorGrade(vec3 color) {
  if (u_colorGrade == 1) {
    return acesFitted(color);
  }
  if (u_colorGrade == 2) {
    float luminance = max(
      dot(color, vec3(0.2126, 0.7152, 0.0722)),
      0.00001
    );
    float mapped = luminance / (1.0 + luminance);
    return color * (mapped / luminance);
  }
  if (u_colorGrade == 3) {
    vec3 filmic = acesFitted(color);
    float luminance = dot(filmic, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luminance), filmic, 1.18), 0.0, 1.0);
  }
  return color;
}

void main() {
  vec3 normal = normalize(v_viewNormal);
  float cosView = max(normal.z, 0.001);
  float thickness = max(4.0, v_height * THICKNESS_RANGE_NM);
  vec3 spectral = spectrum(thickness, cosView);
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  vec3 keyWorldDir = normalize(vec3(-0.46, 0.58, 0.72));
  vec3 fillWorldDir = normalize(vec3(0.58, -0.18, 0.79));
  vec3 keyDir = normalize(worldToViewDirection(keyWorldDir));
  vec3 fillDir = normalize(worldToViewDirection(fillWorldDir));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float keyIllumination = smoothstep(
    0.0, 0.08, max(dot(normal, keyDir), 0.0)
  );
  float fillIllumination = smoothstep(
    0.0, 0.08, max(dot(normal, fillDir), 0.0)
  );
  float keySpec = keyIllumination
    * pow(max(dot(normalize(keyDir + viewDir), normal), 0.0), 180.0);
  float fillSpec = fillIllumination
    * pow(max(dot(normalize(fillDir + viewDir), normal), 0.0), 120.0);
  float edge = pow(clamp(1.0 - cosView, 0.0, 1.0), 1.5);
  vec3 backdrop = vec3(0.010, 0.014, 0.021);
  vec3 transmitted = backdrop + vec3(0.030, 0.038, 0.050)
    * (0.7 + 0.3 * cosView);
  vec3 film = spectral * (1.3 + edge * 2.1);
  film += keySpec * (vec3(0.96, 0.93, 0.87) + spectral * 0.72);
  film += fillSpec * (vec3(0.32, 0.39, 0.52) + spectral * 0.40);
  film += smoothstep(0.72, 0.99, edge) * vec3(0.12, 0.17, 0.24);
  vec3 litColor = max(transmitted + film, 0.0);
  vec3 gradedColor = applyColorGrade(
    applyContrast(litColor, u_contrast)
  );
  outColor = vec4(pow(max(gradedColor, 0.0), vec3(0.84)), 1.0);
}`;

export const backgroundShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.31, 289.97))) * 9173.21);
}

void main() {
  vec2 q = v_uv - 0.5;
  float glow = exp(-dot(
    q - vec2(-0.18, 0.16),
    q - vec2(-0.18, 0.16)
  ) * 4.2);
  vec3 color = vec3(0.010, 0.014, 0.021)
    + vec3(0.012, 0.023, 0.037) * glow;
  color += (hash(gl_FragCoord.xy) - 0.5) * 0.003;
  outColor = vec4(color, 1.0);
}`;
