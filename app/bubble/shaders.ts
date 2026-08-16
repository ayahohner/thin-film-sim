export const fullscreenVertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const simulationShader = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
layout(location = 0) out vec4 outState0;
layout(location = 1) out vec4 outState1;

uniform sampler2D u_state0;
uniform sampler2D u_state1;
uniform sampler2D u_positions;
uniform sampler2D u_neighbors;
uniform ivec2 u_stateSize;
uniform int u_vertexCount;
uniform float u_dt;
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

const float VELOCITY_RANGE = 0.34;
const float TEMPERATURE_RANGE = 4.0;
const float BUBBLE_RADIUS = 0.022;

ivec2 indexCoord(int index) {
  return ivec2(index % u_stateSize.x, index / u_stateSize.x);
}

vec4 state0At(int index) { return texelFetch(u_state0, indexCoord(index), 0); }
vec4 state1At(int index) { return texelFetch(u_state1, indexCoord(index), 0); }
vec3 positionAt(int index) { return texelFetch(u_positions, indexCoord(index), 0).xyz; }

vec4 neighborAt(int index, int slot) {
  ivec2 coordinate = indexCoord(index);
  coordinate.y += slot * u_stateSize.y;
  return texelFetch(u_neighbors, coordinate, 0);
}

vec3 decodeVelocity(vec4 state) {
  return (state.gba * 2.0 - 1.0) * VELOCITY_RANGE;
}

vec3 parallelTransport(vec3 vector, vec3 from, vec3 to) {
  return vector - (dot(vector, to) / max(1.0 + dot(from, to), 0.0001)) * (from + to);
}

vec3 clampMagnitude(vec3 vector, float limit) {
  float magnitude = length(vector);
  return magnitude > limit ? vector * (limit / magnitude) : vector;
}

void tangentFrame(vec3 normal, out vec3 tangentA, out vec3 tangentB) {
  vec3 reference = abs(normal.z) < 0.88 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  tangentA = normalize(cross(reference, normal));
  tangentB = normalize(cross(normal, tangentA));
}

float laplaceHeightAt(int index) {
  float center = state0At(index).r;
  float laplacian = 0.0;
  for (int slot = 0; slot < 6; slot += 1) {
    vec4 neighbor = neighborAt(index, slot);
    if (neighbor.r >= 0.0) {
      int neighborIndex = int(neighbor.r + 0.5);
      laplacian += neighbor.g * (state0At(neighborIndex).r - center);
    }
  }
  return laplacian;
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
    outState0 = vec4(0.55, 0.5, 0.5, 0.5);
    outState1 = vec4(0.5, 0.5, 0.0, 1.0);
    return;
  }

  vec3 normal = normalize(positionAt(index));
  vec4 center0 = state0At(index);
  vec4 center1 = state1At(index);
  float height = center0.r;
  float surfactant = center1.r;
  float temperature = (center1.g * 2.0 - 1.0) * TEMPERATURE_RANGE;
  vec3 velocity = decodeVelocity(center0);
  velocity -= normal * dot(velocity, normal);

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
  float laplaceHeight = 0.0;
  float laplaceSurfactant = 0.0;
  float laplaceTemperature = 0.0;
  vec3 laplaceVelocity = vec3(0.0);
  float heightRate = 0.0;
  float surfactantRate = 0.0;
  float temperatureRate = 0.0;
  vec3 momentumRate = vec3(0.0);

  for (int slot = 0; slot < 6; slot += 1) {
    vec4 neighbor = neighborAt(index, slot);
    if (neighbor.r < 0.0) continue;
    int neighborIndex = int(neighbor.r + 0.5);
    vec3 neighborNormal = normalize(positionAt(neighborIndex));
    vec4 neighbor0 = state0At(neighborIndex);
    vec4 neighbor1 = state1At(neighborIndex);
    float neighborHeight = neighbor0.r;
    float neighborSurfactant = neighbor1.r;
    float neighborTemperature = (neighbor1.g * 2.0 - 1.0) * TEMPERATURE_RANGE;
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
    rhsSurfactantX += leastSquaresWeight * x * (neighborSurfactant - surfactant);
    rhsSurfactantY += leastSquaresWeight * y * (neighborSurfactant - surfactant);
    rhsTemperatureX += leastSquaresWeight * x * (neighborTemperature - temperature);
    rhsTemperatureY += leastSquaresWeight * y * (neighborTemperature - temperature);

    laplaceHeight += neighbor.g * (neighborHeight - height);
    laplaceSurfactant += neighbor.g * (neighborSurfactant - surfactant);
    laplaceTemperature += neighbor.g * (neighborTemperature - temperature);
    laplaceVelocity += neighbor.g * (neighborVelocity - velocity);

    vec3 edgeVelocity = (velocity + neighborVelocity) * 0.5;
    float normalFlow = dot(edgeVelocity, edgeDirection);
    float fluxWeight = neighbor.b;
    heightRate -= fluxWeight * normalFlow * (height + neighborHeight) * 0.5;
    surfactantRate -= fluxWeight * normalFlow
      * (surfactant + neighborSurfactant) * 0.5;
    temperatureRate -= fluxWeight * normalFlow
      * (temperature + neighborTemperature) * 0.5;
    vec3 centerMomentum = height * velocity;
    vec3 neighborMomentum = neighborHeight * neighborVelocity;
    momentumRate -= fluxWeight * normalFlow
      * (centerMomentum + neighborMomentum) * 0.5;
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

  float rhsLaplaceX = 0.0;
  float rhsLaplaceY = 0.0;
  for (int slot = 0; slot < 6; slot += 1) {
    vec4 neighbor = neighborAt(index, slot);
    if (neighbor.r < 0.0) continue;
    int neighborIndex = int(neighbor.r + 0.5);
    vec3 neighborNormal = normalize(positionAt(neighborIndex));
    float cosine = clamp(dot(normal, neighborNormal), -1.0, 1.0);
    float distance = max(acos(cosine), 0.0001);
    vec3 edgeDirection = normalize(neighborNormal - normal * cosine);
    float x = distance * dot(edgeDirection, tangentA);
    float y = distance * dot(edgeDirection, tangentB);
    float weight = 1.0 / (distance * distance);
    float difference = laplaceHeightAt(neighborIndex) - laplaceHeight;
    rhsLaplaceX += weight * x * difference;
    rhsLaplaceY += weight * y * difference;
  }
  vec2 gradLaplaceComponents = solveGradient(
    rhsLaplaceX, rhsLaplaceY, mxx, mxy, myy
  );
  vec3 gradLaplaceHeight = tangentA * gradLaplaceComponents.x
    + tangentB * gradLaplaceComponents.y;

  float gravityScale = 0.052 * u_gravity / 9.81;
  vec3 gravityTangent = vec3(0.0, -1.0, 0.0) + normal * normal.y;
  vec3 acceleration = gravityScale * gravityTangent;
  acceleration -= 0.085 * (
    (u_marangoni / 18.0) * gradSurfactant
    + (0.15 / 18.0) * gradTemperature
  );
  acceleration += 0.00115 * (u_surfaceTension / 32.0)
    * height * height * gradLaplaceHeight;
  float angularViscosity = (u_viscosity * 1.0e-6)
    / (BUBBLE_RADIUS * BUBBLE_RADIUS);
  acceleration += angularViscosity * (laplaceVelocity + 2.0 * velocity);
  acceleration -= velocity * 0.018;

  float pointerInfluence = exp(-(1.0 - dot(normal, u_pointerDirection)) * 48.0)
    * u_pointerDown;
  acceleration += parallelTransport(u_pointerVelocity, u_pointerDirection, normal)
    * pointerInfluence * 1.8;
  acceleration = clampMagnitude(acceleration - normal * dot(acceleration, normal), 0.72);

  float diffusion = u_diffusion * 1.0e-12
    / (BUBBLE_RADIUS * BUBBLE_RADIUS);
  surfactantRate += diffusion * laplaceSurfactant;
  temperatureRate += 0.00029 * laplaceTemperature;
  float ambientShape = 0.55 * normal.y + 0.22 * normal.x * normal.z
    + 0.13 * (normal.x * normal.x - normal.z * normal.z);
  float targetTemperature = u_thermalGradient * ambientShape
    - 0.22 * (0.55 - height);
  temperatureRate += 0.16 * (targetTemperature - temperature);
  temperatureRate -= 0.032 * u_evaporation * (1.0 + 0.3 * (0.55 - height));

  heightRate -= u_evaporation / 600.0;
  float newHeight = clamp(height + u_dt * heightRate, 0.008, 0.96);
  vec3 newMomentum = height * velocity
    + u_dt * (momentumRate + height * acceleration);
  vec3 newVelocity = newMomentum / max(newHeight, 0.025);
  newVelocity -= normal * dot(newVelocity, normal);
  newVelocity = clampMagnitude(newVelocity, VELOCITY_RANGE);
  float newSurfactant = clamp(
    surfactant + u_dt * surfactantRate, 0.22, 0.78
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
out vec3 v_worldNormal;

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
  v_worldNormal = worldNormal;
}`;

export const bubbleFragmentShader = `#version 300 es
precision highp float;
in float v_height;
in vec3 v_viewNormal;
in vec3 v_worldNormal;
out vec4 outColor;

uniform float u_thickness;
uniform float u_variation;
uniform float u_ior;
uniform float u_saturation;

const float TWO_PI = 6.28318530718;

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

void main() {
  vec3 normal = normalize(v_viewNormal);
  float cosView = max(normal.z, 0.001);
  float relativeHeight = v_height - 0.55;
  float thickness = max(5.0, u_thickness + relativeHeight * u_variation * 3.0);
  vec3 spectral = spectrum(thickness, cosView);
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  vec3 keyDir = normalize(vec3(-0.46, 0.58, 0.72));
  vec3 fillDir = normalize(vec3(0.58, -0.18, 0.79));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float keySpec = pow(max(dot(normalize(keyDir + viewDir), normal), 0.0), 180.0);
  float fillSpec = pow(max(dot(normalize(fillDir + viewDir), normal), 0.0), 120.0);
  float edge = pow(clamp(1.0 - cosView, 0.0, 1.0), 1.5);
  vec3 backdrop = vec3(0.010, 0.014, 0.021);
  vec3 transmitted = backdrop + vec3(0.030, 0.038, 0.050) * (0.7 + 0.3 * cosView);
  vec3 film = spectral * (1.3 + edge * 2.1);
  film += keySpec * vec3(1.20, 1.17, 1.10);
  film += fillSpec * vec3(0.42, 0.51, 0.66);
  film += smoothstep(0.72, 0.99, edge) * vec3(0.12, 0.17, 0.24);
  outColor = vec4(pow(max(transmitted + film, 0.0), vec3(0.84)), 1.0);
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
  float glow = exp(-dot(q - vec2(-0.18, 0.16), q - vec2(-0.18, 0.16)) * 4.2);
  vec3 color = vec3(0.010, 0.014, 0.021)
    + vec3(0.012, 0.023, 0.037) * glow;
  color += (hash(gl_FragCoord.xy) - 0.5) * 0.003;
  outColor = vec4(color, 1.0);
}`;
