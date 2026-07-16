import { describe, expect, it } from 'vitest';
import { createLiquidGlassMap } from './liquid-glass-map';

describe('createLiquidGlassMap', () => {
  it('keeps the optical centre neutral and concentrates displacement at the rim', () => {
    const map = createLiquidGlassMap({ size: 96 });
    const centre = ((48 * map.width) + 48) * 4;
    const rim = ((48 * map.width) + 92) * 4;
    expect(Math.abs(map.data[centre] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(map.data[centre + 1] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(map.data[rim] - 128) + Math.abs(map.data[rim + 1] - 128)).toBeGreaterThan(5);
  });

  it('caps every channel so the displacement map cannot fold or overflow', () => {
    const map = createLiquidGlassMap({ size: 64, gain: 200 });
    expect(Math.min(...map.data)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...map.data)).toBeLessThanOrEqual(255);
  });
});
