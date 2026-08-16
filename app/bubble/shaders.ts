const cubeSphereMapping = `
const float CHART_EXTENT = 1.22;

vec3 cubeVector(int face, vec2 st) {
  if (face == 0) return vec3(1.0, st.y, -st.x);
  if (face == 1) return vec3(-1.0, st.y, st.x);
  if (face == 2) return vec3(st.x, 1.0, -st.y);
  if (face == 3) return vec3(st.x, -1.0, st.y);
  if (face == 4) return vec3(st.x, st.y, 1.0);
  return vec3(-st.x, st.y, -1.0);
}

int directionFace(vec3 direction) {
  vec3 magnitude = abs(direction);
  if (magnitude.x >= magnitude.y && magnitude.x >= magnitude.z) {
    return direction.x >= 0.0 ? 0 : 1;
  }
  if (magnitude.y >= magnitude.z) return direction.y >= 0.0 ? 2 : 3;
  return direction.z >= 0.0 ? 4 : 5;
}

vec2 faceTile(int face) {
  return vec2(float(face % 3), float(face / 3));
}

vec3 atlasDirection(vec2 atlasUv, out int face) {
  vec2 tiled = atlasUv * vec2(3.0, 2.0);
  ivec2 tile = ivec2(floor(tiled));
  face = tile.x + tile.y * 3;
  vec2 localUv = fract(tiled);
  return normalize(cubeVector(face, (localUv * 2.0 - 1.0) * CHART_EXTENT));
}

vec2 directionChartUv(vec3 direction, int face, out float weight) {
  direction = normalize(direction);
  float denominator = face == 0 ? direction.x
    : face == 1 ? -direction.x
    : face == 2 ? direction.y
    : face == 3 ? -direction.y
    : face == 4 ? direction.z
    : -direction.z;
  float safeDenominator = max(denominator, 0.000001);
  vec2 st;
  if (face == 0) st = vec2(-direction.z, direction.y) / safeDenominator;
  else if (face == 1) st = vec2(direction.z, direction.y) / safeDenominator;
  else if (face == 2) st = vec2(direction.x, -direction.z) / safeDenominator;
  else if (face == 3) st = vec2(direction.x, direction.z) / safeDenominator;
  else if (face == 4) st = vec2(direction.x, direction.y) / safeDenominator;
  else st = vec2(-direction.x, direction.y) / safeDenominator;
  float chartRadius = max(abs(st.x), abs(st.y));
  float support = 1.0 - smoothstep(CHART_EXTENT * 0.76, CHART_EXTENT, chartRadius);
  weight = denominator > 0.0 ? support * denominator * denominator : 0.0;
  vec2 localUv = clamp(
    st / (2.0 * CHART_EXTENT) + 0.5,
    vec2(0.5 * u_faceTexel),
    vec2(1.0 - 0.5 * u_faceTexel)
  );
  return (faceTile(face) + localUv) / vec2(3.0, 2.0);
}

vec4 chartState(vec3 direction, int face, out float weight) {
  vec2 uv = directionChartUv(direction, face, weight);
  return weight > 0.000001 ? texture(u_state, uv) : vec4(0.0);
}

vec4 stateAtDirection(vec3 direction) {
  direction = normalize(direction);
  int faceX = direction.x >= 0.0 ? 0 : 1;
  int faceY = direction.y >= 0.0 ? 2 : 3;
  int faceZ = direction.z >= 0.0 ? 4 : 5;
  float weightX;
  float weightY;
  float weightZ;
  vec4 stateX = chartState(direction, faceX, weightX);
  vec4 stateY = chartState(direction, faceY, weightY);
  vec4 stateZ = chartState(direction, faceZ, weightZ);
  float totalWeight = max(weightX + weightY + weightZ, 0.000001);
  vec4 state = (stateX * weightX + stateY * weightY + stateZ * weightZ)
    / totalWeight;
  return vec4(state.r, 0.5, 0.5, state.a);
}

void faceBasis(vec3 normal, int face, out vec3 tangentA, out vec3 tangentB) {
  vec3 faceDerivative = face == 0 ? vec3(0.0, 0.0, -1.0)
    : face == 1 ? vec3(0.0, 0.0, 1.0)
    : face == 5 ? vec3(-1.0, 0.0, 0.0)
    : vec3(1.0, 0.0, 0.0);
  tangentA = normalize(faceDerivative - normal * dot(faceDerivative, normal));
  tangentB = normalize(cross(normal, tangentA));
}

vec3 sphereOffset(vec3 normal, vec3 tangent, float distance) {
  return normalize(normal * cos(distance) + normalize(tangent) * sin(distance));
}
`;

export const vertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const simulationShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_state;
uniform float u_faceTexel;
uniform float u_angularStep;
uniform float u_dt;
uniform float u_gravity;
uniform float u_surfaceTension;
uniform float u_viscosity;
uniform float u_marangoni;
uniform float u_diffusion;
uniform vec3 u_pointerDirection;
uniform vec3 u_pointerVelocity;
uniform float u_pointerDown;

const float VMAX = 0.28;

${cubeSphereMapping}

vec2 decodeVelocityComponents(vec4 state) {
  return (state.gb * 2.0 - 1.0) * VMAX;
}

vec3 velocityAtDirection(vec3 direction) {
  direction = normalize(direction);
  int faces[3] = int[3](
    direction.x >= 0.0 ? 0 : 1,
    direction.y >= 0.0 ? 2 : 3,
    direction.z >= 0.0 ? 4 : 5
  );
  vec3 velocity = vec3(0.0);
  float totalWeight = 0.0;
  for (int index = 0; index < 3; index += 1) {
    float weight;
    vec4 state = chartState(direction, faces[index], weight);
    if (weight > 0.000001) {
      vec3 tangentA;
      vec3 tangentB;
      faceBasis(direction, faces[index], tangentA, tangentB);
      vec2 components = decodeVelocityComponents(state);
      velocity += (tangentA * components.x + tangentB * components.y) * weight;
      totalWeight += weight;
    }
  }
  velocity /= max(totalWeight, 0.000001);
  return velocity - direction * dot(velocity, direction);
}

vec3 parallelTransport(vec3 vector, vec3 from, vec3 to) {
  return vector - (dot(vector, to) / max(1.0 + dot(from, to), 0.0001)) * (from + to);
}

vec2 encodeVelocity(vec3 velocity, vec3 normal, int face) {
  vec3 tangentA;
  vec3 tangentB;
  faceBasis(normal, face, tangentA, tangentB);
  vec2 components = vec2(dot(velocity, tangentA), dot(velocity, tangentB));
  return clamp(components / VMAX * 0.5 + 0.5, 0.0, 1.0);
}

float heightAt(vec3 direction) { return stateAtDirection(direction).r; }
float surfactantAt(vec3 direction) { return stateAtDirection(direction).a; }

float laplaceHeight(vec3 normal) {
  int face = directionFace(normal);
  vec3 tangentA;
  vec3 tangentB;
  faceBasis(normal, face, tangentA, tangentB);
  float center = heightAt(normal);
  float neighbors = heightAt(sphereOffset(normal, tangentA, u_angularStep));
  neighbors += heightAt(sphereOffset(normal, -tangentA, u_angularStep));
  neighbors += heightAt(sphereOffset(normal, tangentB, u_angularStep));
  neighbors += heightAt(sphereOffset(normal, -tangentB, u_angularStep));
  return (neighbors - 4.0 * center) / (u_angularStep * u_angularStep);
}

float laplaceSurfactant(
  vec3 normal,
  vec3 tangentA,
  vec3 tangentB,
  vec3 directionL,
  vec3 directionR,
  vec3 directionB,
  vec3 directionT
) {
  float neighbors = surfactantAt(directionL) + surfactantAt(directionR)
    + surfactantAt(directionB) + surfactantAt(directionT);
  return (neighbors - 4.0 * surfactantAt(normal))
    / (u_angularStep * u_angularStep);
}

vec3 clampMagnitude(vec3 vector, float limit) {
  float magnitude = length(vector);
  return magnitude > limit ? vector * (limit / magnitude) : vector;
}

vec3 backtrace(vec3 normal, vec3 velocity, float duration) {
  float speed = length(velocity);
  if (speed < 0.000001) return normal;
  return sphereOffset(normal, -velocity / speed, duration * speed);
}

void main() {
  int currentFace;
  vec3 normal = atlasDirection(v_uv, currentFace);
  vec3 tangentA;
  vec3 tangentB;
  faceBasis(normal, currentFace, tangentA, tangentB);

  vec3 directionL = sphereOffset(normal, -tangentA, u_angularStep);
  vec3 directionR = sphereOffset(normal, tangentA, u_angularStep);
  vec3 directionB = sphereOffset(normal, -tangentB, u_angularStep);
  vec3 directionT = sphereOffset(normal, tangentB, u_angularStep);
  vec4 center = stateAtDirection(normal);
  vec4 stateL = stateAtDirection(directionL);
  vec4 stateR = stateAtDirection(directionR);
  vec4 stateB = stateAtDirection(directionB);
  vec4 stateT = stateAtDirection(directionT);

  vec3 velocity = velocityAtDirection(normal);
  vec3 velocityL = parallelTransport(velocityAtDirection(directionL), directionL, normal);
  vec3 velocityR = parallelTransport(velocityAtDirection(directionR), directionR, normal);
  vec3 velocityB = parallelTransport(velocityAtDirection(directionB), directionB, normal);
  vec3 velocityT = parallelTransport(velocityAtDirection(directionT), directionT, normal);
  float inverseDiameter = 0.5 / u_angularStep;
  float divergence = dot(velocityR - velocityL, tangentA) * inverseDiameter
    + dot(velocityT - velocityB, tangentB) * inverseDiameter;

  vec3 gradSurfactant = tangentA * (stateR.a - stateL.a) * inverseDiameter
    + tangentB * (stateT.a - stateB.a) * inverseDiameter;
  vec3 gradLapHeight = tangentA
    * (laplaceHeight(directionR) - laplaceHeight(directionL)) * inverseDiameter;
  gradLapHeight += tangentB
    * (laplaceHeight(directionT) - laplaceHeight(directionB)) * inverseDiameter;
  vec3 lapVelocity = (velocityL + velocityR + velocityB + velocityT - 4.0 * velocity)
    / (u_angularStep * u_angularStep);

  float height = center.r;
  float mobility = height * height
    / max(height * height + 0.08 + 0.22 * u_viscosity, 0.001);
  vec3 force = -u_marangoni * 0.105 * gradSurfactant / max(height, 0.05);
  force += u_surfaceTension * 0.0022 * height * height * gradLapHeight;
  force += u_viscosity * 0.00048 * lapVelocity;
  force += u_gravity * 0.118 * (vec3(0.0, -1.0, 0.0) + normal * normal.y);
  force *= mix(0.52, 1.32, mobility);

  float pointerInfluence = exp(-(1.0 - dot(normal, u_pointerDirection)) * 42.0)
    * u_pointerDown;
  force += parallelTransport(u_pointerVelocity, u_pointerDirection, normal)
    * pointerInfluence * 2.2;
  force = clampMagnitude(force - normal * dot(force, normal), 0.62);

  vec3 halfVelocity = velocity + 0.5 * u_dt * force;
  vec3 midpoint = backtrace(normal, halfVelocity, 0.5 * u_dt);
  vec3 midpointVelocity = parallelTransport(velocityAtDirection(midpoint), midpoint, normal);
  vec3 sourceDirection = backtrace(normal, midpointVelocity, u_dt);
  vec4 advected = stateAtDirection(sourceDirection);
  vec3 sourceVelocity = velocityAtDirection(sourceDirection);
  vec3 newVelocity = parallelTransport(sourceVelocity, sourceDirection, normal) + u_dt * force;
  float viscousDrag = exp(-u_viscosity * u_dt
    * (0.18 + 0.022 / max(height * height, 0.01)));
  newVelocity = clampMagnitude(newVelocity * viscousDrag, VMAX);

  float areaScale = exp(clamp(-u_dt * divergence, -0.12, 0.12));
  float newHeight = advected.r * areaScale;
  float newSurfactant = advected.a * areaScale;
  newSurfactant += u_dt * u_diffusion * 0.00016 * laplaceSurfactant(
    normal, tangentA, tangentB, directionL, directionR, directionB, directionT
  );

  newHeight = clamp(newHeight, 0.012, 0.98);
  newSurfactant = clamp(newSurfactant, 0.08, 0.92);
  outColor = vec4(
    newHeight,
    encodeVelocity(newVelocity, normal, currentFace),
    newSurfactant
  );
}`;

export const displayShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_state;
uniform float u_faceTexel;
uniform float u_angularStep;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_cameraOrbit;
uniform float u_thickness;
uniform float u_variation;
uniform float u_ior;
uniform float u_saturation;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;
const float BUBBLE_RADIUS_METERS = 0.022;

${cubeSphereMapping}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.31, 289.97))) * 9173.21);
}

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
  return 0.5 * (airyReflectance(rs * rs, beta) + airyReflectance(rp * rp, beta));
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

vec3 geodesicHeightGradient(vec3 normal) {
  vec3 reference = abs(normal.y) < 0.88 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangentA = normalize(cross(reference, normal));
  vec3 tangentB = normalize(cross(normal, tangentA));
  float sampleRadius = u_angularStep * 2.35;
  float center = stateAtDirection(normal).r;
  vec3 gradient = vec3(0.0);
  for (int index = 0; index < 6; index += 1) {
    float angle = TWO_PI * (float(index) + 0.5) / 6.0;
    vec3 tangent = tangentA * cos(angle) + tangentB * sin(angle);
    float sampleHeight = stateAtDirection(sphereOffset(normal, tangent, sampleRadius)).r;
    gradient += tangent * (sampleHeight - center);
  }
  return gradient / (3.0 * sampleRadius);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 q = uv - 0.5;
  q.x *= aspect;
  float radius = min(0.425 * aspect, 0.455);
  float r2 = dot(q, q) / (radius * radius);
  float grain = hash(gl_FragCoord.xy + floor(u_time * 1.7));

  vec3 backdrop = vec3(0.010, 0.014, 0.021);
  float glow = exp(-dot(q - vec2(-0.22, 0.18), q - vec2(-0.22, 0.18)) * 3.2);
  backdrop += vec3(0.014, 0.026, 0.041) * glow;
  backdrop += (grain - 0.5) * 0.004;
  if (r2 > 1.0) {
    outColor = vec4(backdrop, 1.0);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 screenNormal = normalize(vec3(q / radius, z));
  vec3 worldNormal = rotateY(rotateX(screenNormal, u_cameraOrbit.y), u_cameraOrbit.x);
  vec3 viewDir = rotateY(
    rotateX(vec3(0.0, 0.0, 1.0), u_cameraOrbit.y),
    u_cameraOrbit.x
  );
  vec4 state = stateAtDirection(worldNormal);
  vec3 heightGradient = geodesicHeightGradient(worldNormal);
  vec3 physicalSlope = heightGradient
    * u_variation * 3.1e-9 / BUBBLE_RADIUS_METERS;
  vec3 opticalNormal = normalize(worldNormal - physicalSlope);

  float cosView = max(dot(opticalNormal, viewDir), 0.001);
  float latitude = asin(clamp(worldNormal.y, -1.0, 1.0)) / PI + 0.5;
  float bottomMeniscus = pow(max(0.0, 1.0 - latitude), 5.0) * 0.12;
  float relativeHeight = state.r - 0.54 + bottomMeniscus;
  float thickness = max(7.0, u_thickness + relativeHeight * u_variation * 3.1);
  vec3 spectral = spectrum(thickness, cosView);
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  vec3 keyDir = normalize(vec3(-0.46, 0.58, 0.72));
  vec3 fillDir = normalize(vec3(0.58, -0.18, 0.79));
  vec3 keyHalf = normalize(keyDir + viewDir);
  vec3 fillHalf = normalize(fillDir + viewDir);
  float keySpec = pow(max(dot(opticalNormal, keyHalf), 0.0), 170.0);
  float fillSpec = pow(max(dot(opticalNormal, fillHalf), 0.0), 105.0);
  float broadSpec = pow(max(dot(opticalNormal, keyHalf), 0.0), 22.0);
  float diffuse = max(dot(opticalNormal, keyDir), 0.0) * 0.62
    + max(dot(opticalNormal, fillDir), 0.0) * 0.38;

  float edge = smoothstep(0.72, 1.0, sqrt(r2));
  vec3 transmitted = backdrop * (0.88 + 0.08 * z);
  transmitted += vec3(0.025, 0.032, 0.042) * (0.32 + diffuse)
    * (0.78 + state.a * 0.22);
  vec3 film = spectral * (1.25 + edge * 2.15 + broadSpec * 0.28);
  film += keySpec * mix(vec3(1.30, 1.26, 1.17), spectral * 3.2, 0.22);
  film += fillSpec * mix(vec3(0.46, 0.57, 0.72), spectral * 2.2, 0.18);
  film *= 0.90 + 0.10 * z;
  vec3 color = transmitted + film;

  float rim = smoothstep(0.952, 0.997, sqrt(r2));
  color += rim * vec3(0.23, 0.31, 0.42);
  color += (grain - 0.5) * 0.009;
  outColor = vec4(pow(max(color, 0.0), vec3(0.84)), 1.0);
}`;
