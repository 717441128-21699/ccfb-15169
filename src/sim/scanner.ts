// 平板扫描仪响应模型: 三波段反射率 -> 扫描仪 8bit RGB
// 包含通道串扰、伽马编码、眩光、暗噪声, 用于合成"扫描图"。

import type { Vec3 } from '../color/colorscience';

/** 扫描仪串扰矩阵(线性域) */
export const SCAN_MATRIX: readonly number[] = [
  0.93, 0.05, 0.02,
  0.04, 0.92, 0.04,
  0.02, 0.05, 0.93,
];

/** 伽马编码指数 */
export const SCAN_GAMMA = 0.45;
/** 眩光(加性) */
export const SCAN_FLARE = 0.004;
/** 噪声标准差(0..1 编码域) */
export const SCAN_NOISE = 1.1 / 255;

/** 可复现伪随机数(mulberry32) */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高斯噪声(Box-Muller) */
export function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 波段反射率 -> 扫描仪编码值(0..1, 未量化) */
export function bandToScanner(rgb: Vec3, vig = 1): Vec3 {
  const m = SCAN_MATRIX;
  const out: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const lin =
      (m[c * 3] * rgb[0] + m[c * 3 + 1] * rgb[1] + m[c * 3 + 2] * rgb[2]) * vig +
      SCAN_FLARE;
    out[c] = Math.pow(Math.max(lin, 0), SCAN_GAMMA);
  }
  return out;
}
