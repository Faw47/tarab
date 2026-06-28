export const liquidBackgroundVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const liquidBackgroundFragmentShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 color1;
  uniform vec3 color2;
  uniform vec3 color3;
  uniform vec3 color4;
  uniform vec3 color5;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;

    vec2 p1 = vec2(sin(uTime * 0.4) * 0.6, cos(uTime * 0.3) * 0.5);
    vec2 p2 = vec2(cos(uTime * 0.25) * 0.7, sin(uTime * 0.45) * 0.6);
    vec2 p3 = vec2(sin(uTime * 0.5) * 0.5, cos(uTime * 0.2) * 0.7);
    vec2 p4 = vec2(cos(uTime * 0.35) * 0.8, sin(uTime * 0.55) * 0.4);
    vec2 p5 = vec2(sin(uTime * 0.15) * 0.9, cos(uTime * 0.6) * 0.5);

    float d1 = max(0.0, 1.0 - distance(p, p1) * 1.2);
    float d2 = max(0.0, 1.0 - distance(p, p2) * 1.5);
    float d3 = max(0.0, 1.0 - distance(p, p3) * 1.3);
    float d4 = max(0.0, 1.0 - distance(p, p4) * 1.4);
    float d5 = max(0.0, 1.0 - distance(p, p5) * 1.1);

    d1 = smoothstep(0.0, 1.0, d1);
    d2 = smoothstep(0.0, 1.0, d2);
    d3 = smoothstep(0.0, 1.0, d3);
    d4 = smoothstep(0.0, 1.0, d4);
    d5 = smoothstep(0.0, 1.0, d5);

    vec3 finalColor = vec3(0.0);
    finalColor += color1 * d1;
    finalColor += color2 * d2;
    finalColor += color3 * d3;
    finalColor += color4 * d4;
    finalColor += color5 * d5;

    vec3 bgColor = vec3(0.015, 0.015, 0.03);
    finalColor += bgColor;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
