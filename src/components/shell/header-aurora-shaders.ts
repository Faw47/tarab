/**
 * Header aurora plane (liquid TopBar only). Kept separate for readability.
 * Not true DOM refraction — additive color under CSS backdrop-filter.
 */

export const topBarAuroraVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const topBarAuroraFragmentShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uAccent;
  uniform float uScroll;
  uniform float uFocus;
  uniform vec2 uPointer;
  uniform float uSweepStrength;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + uTime * 0.08;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2(uv.x * aspect, uv.y) * 2.8;

    float scrollBoost = 0.85 + uScroll * 0.35;
    float n = fbm(p + vec2(uTime * 0.12, uTime * 0.09)) * scrollBoost;
    float n2 = fbm(p * 1.6 - vec2(uTime * 0.07, uTime * 0.11)) * 0.55 * scrollBoost;
    float blend = smoothstep(0.2, 0.95, n * 0.65 + n2);

    vec3 base = vec3(0.02, 0.022, 0.04);
    vec3 accent = mix(uAccent, vec3(0.35, 0.85, 0.55), 0.15);
    vec3 col = mix(base, accent * 0.45, blend * 0.55);

    float focusGlow = uFocus * 0.12;
    col += vec3(focusGlow);

    float diag = uv.x * 1.15 + uv.y * 0.95 + uTime * 0.22;
    float band = smoothstep(0.02, 0.0, abs(fract(diag) - 0.5) - 0.46);
    col += vec3(1.0) * band * uSweepStrength * 0.09;

    vec2 ptr = uPointer;
    if (ptr.x >= 0.0 && ptr.y >= 0.0) {
      float d = distance(uv, ptr);
      float spot = smoothstep(0.45, 0.0, d) * 0.18;
      col += vec3(spot);
    }

    float alpha = (0.14 + blend * 0.18 + uFocus * 0.04) * (0.88 + uScroll * 0.12);
    gl_FragColor = vec4(col, alpha);
  }
`;
