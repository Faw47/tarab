/**
 * Separable Gaussian weights for shell blur passes (`fragment-bg-*blur.glsl`).
 * Normalized so discrete convolution preserves energy (symmetric taps, center + pairs).
 */

export function buildGaussianKernel(sigma: number, radius: number): Float32Array {
  if (radius < 0 || !Number.isFinite(sigma) || sigma <= 0) {
    return new Float32Array([1]);
  }
  const weights = new Float32Array(radius + 1);
  let sum = 0;
  for (let i = 0; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights[i] = w;
    sum += i === 0 ? w : 2 * w;
  }
  for (let i = 0; i <= radius; i++) {
    weights[i] /= sum;
  }
  return weights;
}

/** Pad / truncate to `GLSL_MAX + 1` for `uniform float u_blurWeights[MAX+1]`. */
export function gaussianKernelToUniformArray(
  kernel: Float32Array,
  glslMaxRadius: number,
): Float32Array {
  const out = new Float32Array(glslMaxRadius + 1);
  const n = Math.min(kernel.length, glslMaxRadius + 1);
  out.set(kernel.subarray(0, n));
  return out;
}
