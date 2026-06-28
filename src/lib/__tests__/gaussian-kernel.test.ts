import { describe, expect, it } from 'vitest';

import { buildGaussianKernel, gaussianKernelToUniformArray } from '../gaussian-kernel';

describe('buildGaussianKernel', () => {
  it('sums to ~1 with symmetric taps', () => {
    const k = buildGaussianKernel(4, 12);
    let sum = k[0];
    for (let i = 1; i < k.length; i++) sum += 2 * k[i];
    expect(sum).toBeCloseTo(1, 5);
  });

  it('pads to uniform length', () => {
    const k = buildGaussianKernel(3, 8);
    const u = gaussianKernelToUniformArray(k, 200);
    expect(u.length).toBe(201);
    expect(u[0]).toBeCloseTo(k[0], 6);
  });
});
