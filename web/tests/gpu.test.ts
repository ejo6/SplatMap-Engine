import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscreteGPU, lodBudget } from '../src/gpu.ts';

test('discrete vs integrated GPUs from the WebGL renderer string', () => {
  assert.equal(isDiscreteGPU('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'), false);
  assert.equal(isDiscreteGPU('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isDiscreteGPU('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isDiscreteGPU('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), true);
  assert.equal(isDiscreteGPU('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'), true);
  assert.equal(isDiscreteGPU(''), false); // hidden renderer: assume the weaker budget
  assert.equal(lodBudget(false), 1_500_000);
  assert.equal(lodBudget(true), 2_500_000);
});
