/**
 * 颜色科学核心：光谱→XYZ(D50)→Lab、ΔE2000、Status T 密度、sRGB 转换
 * 全部为纯函数，浏览器与 Node 共用。
 */
import { CMF_1931, D50_SPD, STATUS_T, SPECTRAL_BANDS } from './data.ts';
import type { Densities, Lab, XYZ } from '../types.ts';

/* ---------------- 光谱积分 ---------------- */

function spdIntegral(table: readonly number[]): number {
  // 等间距 10 nm，梯形积分
  let s = 0;
  for (let i = 0; i < table.length - 1; i++) s += table[i] + table[i + 1];
  return (s * 10) / 2;
}

/** D50 下归一化因子 k = 100 / ∫S(λ)·ȳ(λ)dλ */
const K_D50 = (() => {
  const sy: number[] = [];
  for (let i = 0; i < SPECTRAL_BANDS; i++) sy.push(D50_SPD[i] * CMF_1931[i][1]);
  return 100 / spdIntegral(sy);
})();

/** 光谱反射率（0..1，36 波段）→ D50/2° XYZ */
export function spectralToXYZ(reflectance: ArrayLike<number>): XYZ {
  let X = 0,
    Y = 0,
    Z = 0;
  for (let i = 0; i < SPECTRAL_BANDS; i++) {
    const s = D50_SPD[i] * reflectance[i];
    X += s * CMF_1931[i][0];
    Y += s * CMF_1931[i][1];
    Z += s * CMF_1931[i][2];
  }
  const f = (K_D50 * 10) / 2;
  return { X: X * f, Y: Y * f, Z: Z * f };
}

const D50_WHITE: XYZ = { X: 96.42, Y: 100, Z: 82.49 };

export function xyzToLab({ X, Y, Z }: XYZ): Lab {
  const f = (t: number): number => {
    const e = 216 / 24389;
    const k = 24389 / 27;
    return t > e ? Math.cbrt(t) : (k * t + 16) / 116;
  };
  const fx = f(X / D50_WHITE.X);
  const fy = f(Y / D50_WHITE.Y);
  const fz = f(Z / D50_WHITE.Z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function spectralToLab(reflectance: ArrayLike<number>): Lab {
  return xyzToLab(spectralToXYZ(reflectance));
}

/* ---------------- ΔE2000（CIE，参数 kL=kC=kH=1） ---------------- */

export function deltaE2000(l1: Lab, l2: Lab): number {
  const { L: L1, a: a1, b: b1 } = l1;
  const { L: L2, a: a2, b: b2 } = l2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G =
    0.5 *
    (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a: number, b: number): number => {
    if (a === 0 && b === 0) return 0;
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    hbarp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hbarp) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL =
    1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  );
}

/* ---------------- Status T 密度 ---------------- */

/**
 * 光谱反射率 → Status T 三色密度 + 视觉密度
 * 密度以纸白为零点（相对密度），与印刷车间读数口径一致。
 */
export function spectralToDensity(
  reflectance: ArrayLike<number>,
  paperReflectance: ArrayLike<number>,
): Densities {
  const channel = (filterIdx: 0 | 1 | 2): number => {
    let rs = 0,
    rp = 0;
    for (let i = 0; i < SPECTRAL_BANDS; i++) {
      const f = STATUS_T[i][filterIdx];
      rs += f * reflectance[i];
      rp += f * paperReflectance[i];
    }
    // 等间距积分系数在比值中消去
    return Math.log10(rp / rs);
  };
  const dR = channel(0);
  const dG = channel(1);
  const dB = channel(2);
  // 视觉密度：Status T 三通道加权平均（近似人眼明视觉权重），
  // 比取 max 更稳健，避免通道切换引入的不连续，利于黑墨回归
  const dV = 0.213 * dR + 0.715 * dG + 0.072 * dB;
  return { dR, dG, dB, dV };
}

/* ---------------- sRGB（用于显示与合成扫描） ---------------- */

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function srgbPixelToLinear(r: number, g: number, b: number): [number, number, number] {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** 线性 RGB（D65 编码值）→ XYZ(D65)，再 Bradford 适应到 D50 */
export function linearSrgbToXyzD50(r: number, g: number, b: number): XYZ {
  // sRGB D65
  const X65 = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y65 = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z65 = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  // Bradford D65 → D50
  return {
    X: 1.0478112 * X65 + 0.0228866 * Y65 - 0.050127 * Z65,
    Y: 0.0295424 * X65 + 0.9904844 * Y65 - 0.0170491 * Z65,
    Z: -0.0092345 * X65 + 0.0150436 * Y65 + 0.7521316 * Z65,
  };
}

export function labToSrgb(lab: Lab): [number, number, number] {
  // Lab(D50) → XYZ(D50)
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const finv = (t: number): number => (t ** 3 > e ? t ** 3 : (116 * t - 16) / k);
  const X50 = finv(fx) * D50_WHITE.X;
  const Y50 = finv(fy) * D50_WHITE.Y;
  const Z50 = finv(fz) * D50_WHITE.Z;
  // Bradford D50 → D65
  const X65 = 0.9555766 * X50 - 0.0230393 * Y50 + 0.0631636 * Z50;
  const Y65 = -0.0282895 * X50 + 1.0099416 * Y50 + 0.0210077 * Z50;
  const Z65 = 0.0122982 * X50 - 0.020483 * Y50 + 1.3299098 * Z50;
  // XYZ D65 → 线性 sRGB
  const r = 3.2404542 * X65 - 1.5371385 * Y65 - 0.4985314 * Z65;
  const g = -0.969266 * X65 + 1.8760108 * Y65 + 0.041556 * Z65;
  const b = 0.0556434 * X65 - 0.2040259 * Y65 + 1.2325326 * Z65;
  const enc = (v: number): number => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };
  return [enc(r), enc(g), enc(b)];
}

/** Lab 差值（向量形式，供批量统计） */
export function labDistance(a: Lab, b: Lab): number {
  return deltaE2000(a, b);
}

export const EMPTY_DENSITIES: Densities = { dR: 0, dG: 0, dB: 0, dV: 0 };
