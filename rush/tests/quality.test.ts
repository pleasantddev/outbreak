// Auto graphics: the first guess from the GPU name and the benchmark step that refines it.
import { describe, it, expect } from 'vitest';
import { guessPreset, refineByBenchmark, DynamicResolution, type DeviceInfo } from '../src/render/quality';

const dev = (gpu: string, extra: Partial<DeviceInfo> = {}): DeviceInfo => ({ gpu, mobile: false, memory: 8, cores: 8, screen: 1920, webgl2: true, ...extra });

describe('auto graphics', () => {
  it('guesses from the GPU', () => {
    expect(guessPreset(dev('Google SwiftShader'))).toBe('potato');
    expect(guessPreset(dev('NVIDIA GeForce RTX 3060'))).toBe('ultra');
    expect(guessPreset(dev('Mali-G52 MC2', { mobile: true, memory: 3 }))).toBe('low');
    expect(guessPreset(dev('Adreno (TM) 506', { mobile: true, memory: 2 }))).toBe('potato');
    expect(guessPreset(dev('anything', { webgl2: false }))).toBe('potato');
  });

  it('steps the preset by measured frame time', () => {
    // 60 fps budget is 16.7 ms
    expect(refineByBenchmark('high', 15, 60)).toBe('high');
    expect(refineByBenchmark('high', 20, 60)).toBe('medium');
    expect(refineByBenchmark('high', 30, 60)).toBe('low');
    expect(refineByBenchmark('high', 120, 60)).toBe('potato');
    expect(refineByBenchmark('medium', 5, 60)).toBe('high');
    expect(refineByBenchmark('ultra', 2, 60)).toBe('ultra');
    expect(refineByBenchmark('low', 40, 30)).toBe('potato');
  });

  it('dynamic resolution drops under load and climbs back, within its limits', () => {
    const d = new DynamicResolution(1, 0.5);
    for (let i = 0; i < 2000; i++) d.update(60, 60);
    expect(d.scale).toBe(0.5);
    for (let i = 0; i < 4000; i++) d.update(5, 60);
    expect(d.scale).toBe(1);
  });
});
