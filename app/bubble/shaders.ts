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
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_gravity;
uniform float u_surfaceTension;
uniform float u_viscosity;
uniform float u_marangoni;
uniform float u_diffusion;
uniform vec2 u_pointer;
uniform vec2 u_pointerVelocity;
uniform float u_pointerDown;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;
const float VMAX = 0.28;

vec2 sphereUv(vec2 uv) {
  float x = uv.x;
  float y = uv.y;
  if (y < 0.0) { y = -y; x += 0.5; }
  if (y > 1.0) { y = 2.0 - y; x += 0.5; }
  return vec2(fract(x), clamp(y, 0.0, 1.0));
}

vec4 sampleSphere(vec2 uv) {
  return texture(u_state, sphereUv(uv));
}

vec2 decodeVelocity(vec4 state) {
  return (state.gb * 2.0 - 1.0) * VMAX;
}

vec2 encodeVelocity(vec2 velocity) {
  return clamp(velocity / VMAX * 0.5 + 0.5, 0.0, 1.0);
}

float rawMetric(float y) {
  return max(0.0, sin(PI * clamp(y, 0.0, 1.0)));
}

float metric(float y) {
  // A longitude cell has finite width at the first cell center. Clamping to
  // that footprint regularizes the unavoidable latitude-longitude pole.
  return max(rawMetric(y), max(0.065, TWO_PI * u_texel.x * 1.5));
}

vec2 coordinateVelocity(vec2 physicalVelocity, vec2 uv) {
  return vec2(
    physicalVelocity.x / (TWO_PI * metric(uv.y)),
    physicalVelocity.y / PI
  );
}

float heightAt(vec2 uv) { return sampleSphere(uv).r; }
float surfactantAt(vec2 uv) { return sampleSphere(uv).a; }
vec2 velocityAt(vec2 uv) { return decodeVelocity(sampleSphere(uv)); }

float laplaceBeltramiHeight(vec2 uv) {
  float h = heightAt(uv);
  float hL = heightAt(uv - vec2(u_texel.x, 0.0));
  float hR = heightAt(uv + vec2(u_texel.x, 0.0));
  float hB = heightAt(uv - vec2(0.0, u_texel.y));
  float hT = heightAt(uv + vec2(0.0, u_texel.y));
  float m = metric(uv.y);
  float mB = metric(uv.y - 0.5 * u_texel.y);
  float mT = metric(uv.y + 0.5 * u_texel.y);
  float lonScale = TWO_PI * u_texel.x * m;
  float latScale = PI * u_texel.y;
  float lon = (hL + hR - 2.0 * h) / (lonScale * lonScale);
  float lat = (mT * (hT - h) - mB * (h - hB)) / (m * latScale * latScale);
  return lon + lat;
}

float laplaceBeltramiSurfactant(vec2 uv) {
  float c = surfactantAt(uv);
  float cL = surfactantAt(uv - vec2(u_texel.x, 0.0));
  float cR = surfactantAt(uv + vec2(u_texel.x, 0.0));
  float cB = surfactantAt(uv - vec2(0.0, u_texel.y));
  float cT = surfactantAt(uv + vec2(0.0, u_texel.y));
  float m = metric(uv.y);
  float mB = metric(uv.y - 0.5 * u_texel.y);
  float mT = metric(uv.y + 0.5 * u_texel.y);
  float lonScale = TWO_PI * u_texel.x * m;
  float latScale = PI * u_texel.y;
  float lon = (cL + cR - 2.0 * c) / (lonScale * lonScale);
  float lat = (mT * (cT - c) - mB * (c - cB)) / (m * latScale * latScale);
  return lon + lat;
}

void main() {
  vec2 uv = v_uv;
  vec4 center = sampleSphere(uv);
  vec4 stateL = sampleSphere(uv - vec2(u_texel.x, 0.0));
  vec4 stateR = sampleSphere(uv + vec2(u_texel.x, 0.0));
  vec4 stateB = sampleSphere(uv - vec2(0.0, u_texel.y));
  vec4 stateT = sampleSphere(uv + vec2(0.0, u_texel.y));

  float h = center.r;
  vec2 velocity = decodeVelocity(center);
  vec2 velocityL = decodeVelocity(stateL);
  vec2 velocityR = decodeVelocity(stateR);
  vec2 velocityB = decodeVelocity(stateB);
  vec2 velocityT = decodeVelocity(stateT);
  float m = metric(uv.y);
  float mB = metric(uv.y - 0.5 * u_texel.y);
  float mT = metric(uv.y + 0.5 * u_texel.y);

  // Intrinsic surface divergence: div_s(u) = 1/sqrt(g) d_i(sqrt(g) u^i).
  float divVelocity = (velocityR.x - velocityL.x) / (2.0 * TWO_PI * u_texel.x * m);
  divVelocity += (mT * velocityT.y - mB * velocityB.y) / (2.0 * PI * u_texel.y * m);

  vec2 gradSurfactant = vec2(
    (stateR.a - stateL.a) / (2.0 * TWO_PI * u_texel.x * m),
    (stateT.a - stateB.a) / (2.0 * PI * u_texel.y)
  );
  vec2 gradLapHeight = vec2(
    (laplaceBeltramiHeight(uv + vec2(u_texel.x, 0.0))
      - laplaceBeltramiHeight(uv - vec2(u_texel.x, 0.0)))
      / (2.0 * TWO_PI * u_texel.x * m),
    (laplaceBeltramiHeight(uv + vec2(0.0, u_texel.y))
      - laplaceBeltramiHeight(uv - vec2(0.0, u_texel.y)))
      / (2.0 * PI * u_texel.y)
  );

  float lonScale = TWO_PI * u_texel.x * m;
  float latScale = PI * u_texel.y;
  vec2 lapVelocity = (velocityL + velocityR - 2.0 * velocity) / (lonScale * lonScale);
  lapVelocity += (mT * (velocityT - velocity) - mB * (velocity - velocityB))
    / (m * latScale * latScale);

  // Reduced tangential momentum. The stored scalar is insoluble surfactant
  // concentration, so surface tension falls along +grad(c) and Marangoni flow
  // accelerates toward -grad(c). Capillary pressure contributes grad(Delta h).
  vec2 force = -u_marangoni * 0.055 * gradSurfactant / max(h, 0.05);
  force += u_surfaceTension * 0.00085 * h * h * gradLapHeight;
  force += u_viscosity * 0.00042 * lapVelocity;
  force.y -= u_gravity * 0.052 * cos(PI * (uv.y - 0.5));

  vec2 pointerDelta = uv - u_pointer;
  pointerDelta.x = mod(pointerDelta.x + 0.5, 1.0) - 0.5;
  float pointerInfluence = exp(-dot(pointerDelta, pointerDelta) * 82.0) * u_pointerDown;
  force += u_pointerVelocity * pointerInfluence * 2.2;
  force = clamp(force, vec2(-0.62), vec2(0.62));

  // Midpoint semi-Lagrangian characteristic tracing remains stable at the
  // larger time increments needed for accelerated real-time playback.
  vec2 halfVelocity = velocity + 0.5 * u_dt * force;
  vec2 midpoint = sphereUv(uv - 0.5 * u_dt * coordinateVelocity(halfVelocity, uv));
  vec2 midpointVelocity = velocityAt(midpoint);
  vec2 source = sphereUv(uv - u_dt * coordinateVelocity(midpointVelocity, midpoint));
  vec4 advected = sampleSphere(source);

  vec2 newVelocity = decodeVelocity(advected) + u_dt * force;
  float viscousDrag = exp(-u_viscosity * u_dt * (0.14 + 0.016 / max(h * h, 0.01)));
  newVelocity *= viscousDrag;

  // Advective form of d_t h + div_s(h u) = 0 and
  // d_t c + div_s(c u) = D Delta_s c. Exponential area change preserves
  // positivity and avoids the central-flux checkerboard at large time scales.
  float areaScale = exp(clamp(-u_dt * divVelocity, -0.12, 0.12));
  float newHeight = advected.r * areaScale;
  float newSurfactant = advected.a * areaScale;
  newSurfactant += u_dt * u_diffusion * 0.00016 * laplaceBeltramiSurfactant(uv);

  // Longitude degenerates to one physical point at each pole. Damp only the
  // unresolvable zonal component within the top/bottom cell footprint.
  float polarWeight = 1.0 - smoothstep(0.06, 0.16, rawMetric(uv.y));
  newVelocity.x *= exp(-polarWeight * u_dt * 24.0);
  newVelocity = clamp(newVelocity, vec2(-VMAX), vec2(VMAX));

  // The floor is the common-black-film scale; there is no island mask.
  newHeight = clamp(newHeight, 0.018, 0.98);
  newSurfactant = clamp(newSurfactant, 0.08, 0.92);
  outColor = vec4(newHeight, encodeVelocity(newVelocity), newSurfactant);
}`;

export const displayShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform vec2 u_stateTexel;
uniform float u_time;
uniform vec2 u_cameraOrbit;
uniform float u_thickness;
uniform float u_variation;
uniform float u_ior;
uniform float u_saturation;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;
const float BUBBLE_RADIUS_METERS = 0.022;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.31, 289.97))) * 9173.21);
}

vec4 sphereState(vec2 uv) {
  return texture(u_state, vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0)));
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
  float sinTransmitted2 = max(0.0, 1.0 - cosIncident * cosIncident) / (u_ior * u_ior);
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
  vec3 viewDir = rotateY(rotateX(vec3(0.0, 0.0, 1.0), u_cameraOrbit.y), u_cameraOrbit.x);
  vec2 bubbleUv = vec2(
    fract(atan(worldNormal.x, worldNormal.z) / TWO_PI + 0.5),
    asin(clamp(worldNormal.y, -1.0, 1.0)) / PI + 0.5
  );

  vec4 state = sphereState(bubbleUv);
  float hL = sphereState(bubbleUv - vec2(u_stateTexel.x, 0.0)).r;
  float hR = sphereState(bubbleUv + vec2(u_stateTexel.x, 0.0)).r;
  float hB = sphereState(bubbleUv - vec2(0.0, u_stateTexel.y)).r;
  float hT = sphereState(bubbleUv + vec2(0.0, u_stateTexel.y)).r;
  float longitude = (bubbleUv.x - 0.5) * TWO_PI;
  vec3 tangentLongitude = vec3(cos(longitude), 0.0, -sin(longitude));
  vec3 tangentLatitude = normalize(cross(worldNormal, tangentLongitude));
  float latitudeMetric = max(0.065, cos((bubbleUv.y - 0.5) * PI));

  // Film thickness is nanometres over a centimetre-scale bubble. Converting
  // the solved gradient to metres removes the previous artistic amplification:
  // its true geometric effect on a highlight is intentionally very small.
  float longitudeArc = max(
    2.0 * BUBBLE_RADIUS_METERS * TWO_PI * u_stateTexel.x * latitudeMetric,
    0.00001
  );
  float latitudeArc = 2.0 * BUBBLE_RADIUS_METERS * PI * u_stateTexel.y;
  vec2 physicalSlope = vec2(
    (hR - hL) * u_variation * 3.1e-9 / longitudeArc,
    (hT - hB) * u_variation * 3.1e-9 / latitudeArc
  );
  vec3 opticalNormal = normalize(worldNormal
    - tangentLongitude * physicalSlope.x
    - tangentLatitude * physicalSlope.y);

  float cosView = max(dot(opticalNormal, viewDir), 0.001);
  float bottomMeniscus = pow(max(0.0, 1.0 - bubbleUv.y), 5.0) * 0.12;
  float relativeHeight = state.r - 0.54 + bottomMeniscus;
  float thickness = max(7.0, u_thickness + relativeHeight * u_variation * 3.1);
  vec3 spectral = spectrum(thickness, cosView);
  float luminance = dot(spectral, vec3(0.2126, 0.7152, 0.0722));
  spectral = mix(vec3(luminance), spectral, u_saturation);

  // Two world-space area-light approximations. They rotate correctly under a
  // camera orbit and are evaluated against the physically scaled film normal.
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
