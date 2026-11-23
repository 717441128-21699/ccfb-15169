// 色彩科学基础:波段反射率 -> XYZ -> Lab, CIEDE2000, 密度
// 波段->XYZ 矩阵由 tools/tune.mjs 标定, 使模型实地 Lab 命中 ISO 12647-2 目标值

export type Vec3 = [number, number, number];

/** 三波段反射率 -> XYZ(D50) */
export const BAND_TO_XYZ: readonly number[] = [
  0.62, 0.24, 0.10,
  0.25, 0.67, 0.08,
  0.005, 0.02, 0.75,
];

/** D50 白点 */
export const WP_D50: Vec3 = [0.9642, 1.0, 0.8251];

export function bandToXyz(rgb: Vec3): Vec3 {
  const m = BAND_TO_XYZ;
  return [
    m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
    m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
    m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
  ];
}

export function xyzToLab(xyz: Vec3): Vec3 {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787037 * t + 16 / 116);
  const fx = f(xyz[0] / WP_D50[0]);
  const fy = f(xyz[1] / WP_D50[1]);
  const fz = f(xyz[2] / WP_D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function bandToLab(rgb: Vec3): Vec3 {
  return xyzToLab(bandToXyz(rgb));
}

/** CIEDE2000 */
export function deltaE00(l1: Vec3, l2: Vec3): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const C7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 25 ** 7)));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    let h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hp(ap1, b1);
  const h2 = hp(ap2, b2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = h2 - h1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = h1 + h2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hbar = (h1 + h2) / 2;
    else if (h1 + h2 < 360) hbar = (h1 + h2 + 360) / 2;
    else hbar = (h1 + h2 - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Cp7 = Cpbar ** 7;
  const Rc = 2 * Math.sqrt(Cp7 / (Cp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const dL = dLp / Sl;
  const dC = dCp / Sc;
  const dH = dHp / Sh;
  return Math.sqrt(dL * dL + dC * dC + dH * dH + Rt * dC * dH);
}

/** 四色密度: C/M/Y 取对应滤色波段, K 取视觉密度(明度加权) */
export interface Densities {
  C: number;
  M: number;
  Y: number;
  K: number;
}

export function densitiesFromBand(rgb: Vec3): Densities {
  const d = (v: number) => -Math.log10(Math.max(v, 1e-5));
  const yvis = 0.25 * rgb[0] + 0.67 * rgb[1] + 0.08 * rgb[2];
  return { C: d(rgb[0]), M: d(rgb[1]), Y: d(rgb[2]), K: d(yvis) };
}

/** Murray-Davies 有效网点面积覆盖率 */
export function murrayDavies(dTint: number, dSolid: number, dPaper: number): number {
  const num = 1 - Math.pow(10, -(dTint - dPaper));
  const den = 1 - Math.pow(10, -(dSolid - dPaper));
  return den > 1e-6 ? num / den : 0;
}

/** Yule-Nielsen 修正的有效网点面积覆盖率(n 因子) */
export function yuleNielsen(dTint: number, dSolid: number, dPaper: number, n: number): number {
  const num = 1 - Math.pow(10, -(dTint - dPaper) / n);
  const den = 1 - Math.pow(10, -(dSolid - dPaper) / n);
  return den > 1e-6 ? num / den : 0;
}
