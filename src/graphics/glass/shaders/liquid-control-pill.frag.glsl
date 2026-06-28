#version 300 es
/**
 * Liquid control glass composite (WebGL2).
 * Samples shell RTs only (u_bg / u_blurredBg) — not arbitrary DOM (see store + pipeline comments).
 * Rounded-rect SDF → finite-difference gradient → refraction UV offsets; RGB dispersion; Fresnel + glare;
 * interaction phase scales strength (quiet idle, stronger press/drag).
 */
precision highp float;

uniform sampler2D u_bg;
uniform sampler2D u_blurredBg;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform vec2 u_halfSize;
uniform float u_radius;
uniform int u_phase;
uniform float u_debug;
uniform float u_morphT;

in vec2 v_uv;
out vec4 fragColor;

const float N_R = 0.985;
const float N_G = 1.0;
const float N_B = 1.015;

float sdRoundRect(vec2 p, vec2 h, float r) {
  r = min(r, min(h.x, h.y));
  vec2 q = abs(p) - h + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float phaseBoost() {
  float b = 1.0;
  if (u_phase == 1) b = 1.12;
  if (u_phase == 2) b = 1.32;
  if (u_phase == 3) b = 1.5;
  if (u_phase == 4) b = 1.1;
  return b * (0.88 + 0.45 * u_debug);
}

void main() {
  (void)v_uv;
  vec2 frag = gl_FragCoord.xy;
  vec2 p = frag - u_center;
  float d = sdRoundRect(p, u_halfSize, u_radius);
  float aa = max(fwidth(d), 0.6);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  if (mask < 0.001) discard;

  float e = 1.2;
  float dx = sdRoundRect(p + vec2(e, 0.0), u_halfSize, u_radius) -
    sdRoundRect(p - vec2(e, 0.0), u_halfSize, u_radius);
  float dy = sdRoundRect(p + vec2(0.0, e), u_halfSize, u_radius) -
    sdRoundRect(p - vec2(0.0, e), u_halfSize, u_radius);
  vec2 N = normalize(vec2(dx, dy) + 1e-5);

  float ps = phaseBoost();
  float refStr = (0.014 + 0.018 * (1.0 - abs(N.y))) * ps * (1.0 + u_debug * 1.1);
  vec2 refrPix = -N * refStr * u_resolution.y * (0.35 + 0.25 * u_morphT);

  vec2 uv = frag / u_resolution;
  vec2 duv = refrPix / u_resolution;

  vec3 sam;
  sam.r = texture(u_bg, uv + duv * N_R).r;
  sam.g = texture(u_bg, uv + duv * N_G).g;
  sam.b = texture(u_bg, uv + duv * N_B).b;

  vec3 blur = texture(u_blurredBg, uv).rgb;
  sam = mix(blur, sam, 0.68 + 0.08 * u_morphT);

  float fres = pow(clamp(1.0 - abs(N.y), 0.0, 1.0), 2.4) * (0.12 + 0.28 * ps) * (1.0 + u_debug * 0.9);
  vec3 tint = vec3(1.01, 1.02, 1.05);
  vec3 col = sam * tint + fres * vec3(1.0);

  float glare = pow(max(0.0, dot(N, normalize(vec2(0.35, 0.94)))), 12.0);
  glare *= (0.1 + 0.22 * ps) * (1.0 + u_debug * 1.2);

  fragColor = vec4(col + glare, mask * 0.9);
}
