export type GlassMapOptions = {
  size?: number;
  gain?: number;
  rim?: number;
  refractiveIndex?: number;
  lightAngle?: number;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Builds an RGBA displacement map for a convex squircle lens.
 * R/G encode the curl-free x/y displacement and B carries directional rim light.
 */
export function createLiquidGlassMap({
  size = 160,
  gain = 58,
  rim = 0.32,
  refractiveIndex = 1.5,
  lightAngle = -Math.PI * 0.72,
}: GlassMapOptions = {}) {
  const safeSize = Math.max(32, Math.round(size));
  const data = new Uint8ClampedArray(safeSize * safeSize * 4);
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);

  for (let py = 0; py < safeSize; py += 1) {
    for (let px = 0; px < safeSize; px += 1) {
      const nx = ((px + 0.5) / safeSize) * 2 - 1;
      const ny = ((py + 0.5) / safeSize) * 2 - 1;
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const radius = (ax ** 4 + ay ** 4) ** 0.25;
      const inside = radius <= 1;
      const rimDepth = inside ? Math.max(0, Math.min(1, (1 - radius) / rim)) : 0;
      const oneMinusDepth = 1 - rimDepth;
      const denominator = Math.max(0.0001, (1 - oneMinusDepth ** 4) ** 0.75);
      const slope = rimDepth >= 1 ? 0 : oneMinusDepth ** 3 / denominator;
      const thetaI = Math.atan(slope);
      const thetaT = Math.asin(Math.sin(thetaI) / refractiveIndex);
      const bend = inside ? Math.sin(thetaI - thetaT) : 0;

      // The superellipse normal supplies a smooth, crease-free direction at corners.
      const gx = Math.sign(nx) * ax ** 3;
      const gy = Math.sign(ny) * ay ** 3;
      const magnitude = Math.hypot(gx, gy) || 1;
      const dirX = gx / magnitude;
      const dirY = gy / magnitude;
      const lit = Math.max(0, dirX * lightX + dirY * lightY);
      const opposite = Math.max(0, -(dirX * lightX + dirY * lightY));
      const rimLight = inside ? bend * (lit + opposite * 0.26) : 0;

      const offset = (py * safeSize + px) * 4;
      data[offset] = clampByte(128 + dirX * bend * gain);
      data[offset + 1] = clampByte(128 + dirY * bend * gain);
      data[offset + 2] = clampByte(22 + rimLight * 720);
      data[offset + 3] = inside ? 255 : 0;
    }
  }

  return { width: safeSize, height: safeSize, data };
}
