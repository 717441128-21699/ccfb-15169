// 印刷机物理模型:给定机台状态(墨量/网点扩大/叠印偏差),
// 计算色控条各色块的三波段反射率真值(相当于"分光密度计"所测)。
// 常数由 tools/tune.mjs 按 ISO 12647-2 目标 Lab 反解得到。

import type { Vec3 } from '../color/colorscience';

export type Ink = 'C' | 'M' | 'Y' | 'K';
export const INKS: Ink[] = ['C', 'M', 'Y', 'K'];
/** 印刷色序(先印在后) */
export const PRINT_ORDER: Ink[] = ['K', 'C', 'M', 'Y'];

/** 纸张三波段反射率 */
export const PAPER_RGB: Vec3 = [0.8711, 0.8674, 0.9655];

/** 各油墨实地三波段密度(标称墨膜厚度) */
export const INK_D: Record<Ink, Vec3> = {
  C: [1.403, 0.5472, 0.1409],
  M: [0.2561, 1.2655, 0.693],
  Y: [0.0402, 0.0337, 1.1579],
  K: [1.6185, 1.6195, 1.6345],
};

/** 各油墨主滤色波段(用于把密度偏差换算为墨膜厚度系数) */
const MAIN_BAND: Record<Ink, number> = { C: 0, M: 1, Y: 2, K: 0 };

/** 50% 处标称网点扩大(TVI) */
export const TVI50_NOMINAL: Record<Ink, number> = { C: 0.15, M: 0.15, Y: 0.13, K: 0.16 };

/** 叠印率标称值(第二色叠于第一色), 色序 K<C<M<Y */
export const TRAP_NOMINAL: Record<string, number> = {
  'C>M': 0.85, // 蓝 = C 上叠 M
  'C>Y': 0.85, // 绿 = C 上叠 Y
  'M>Y': 0.82, // 红 = M 上叠 Y
};

/** Yule-Nielsen n 因子 */
export const YN_N = 1.6;

/** 机台偏差状态 */
export interface PressDeviation {
  /** 实地密度偏差(墨量), 如 C:+0.10 */
  dD: Record<Ink, number>;
  /** 50% 网点扩大偏差(绝对值, 如 +0.05 = 5 个百分点) */
  dTvi: Record<Ink, number>;
  /** 叠印率偏差(绝对值, 如 -0.10) */
  dTrap: Record<string, number>;
}

export const ZERO_DEV: PressDeviation = {
  dD: { C: 0, M: 0, Y: 0, K: 0 },
  dTvi: { C: 0, M: 0, Y: 0, K: 0 },
  dTrap: {},
};

/** 墨膜厚度系数: 密度偏差 -> 相对厚度 */
function thickness(ink: Ink, dev: PressDeviation): number {
  const d0 = INK_D[ink][MAIN_BAND[ink]];
  return Math.max(0.2, (d0 + dev.dD[ink]) / d0);
}

/** TVI 曲线(抛物线, 50% 处为峰值) */
export function tviAt(ink: Ink, a: number, dev: PressDeviation): number {
  const tvi50 = Math.max(0, TVI50_NOMINAL[ink] + dev.dTvi[ink]);
  return tvi50 * (1 - (2 * a - 1) * (2 * a - 1));
}

/** 有效网点覆盖率 */
export function effectiveCoverage(ink: Ink, a: number, dev: PressDeviation): number {
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  return Math.min(1, Math.max(0, a + tviAt(ink, a, dev)));
}

/** 叠印率(第一色 first, 第二色 second) */
export function trapFactor(first: Ink, second: Ink, dev: PressDeviation): number {
  const key = `${first}>${second}`;
  const base = TRAP_NOMINAL[key] ?? 0.88;
  return Math.min(1, Math.max(0.3, base + (dev.dTrap[key] ?? 0)));
}

export type PatchKind = 'paper' | 'solid' | 'tint' | 'overprint' | 'gray';

export interface PatchSpec {
  id: string;
  label: string;
  kind: PatchKind;
  /** 各色标称覆盖率(0..1), 缺省为 0 */
  inks: Partial<Record<Ink, number>>;
}

/** 色控条布局(左右定位标记由 sheetSynth 单独绘制) */
export const STRIP: PatchSpec[] = [
  { id: 'paper', label: '纸白', kind: 'paper', inks: {} },
  { id: 'C100', label: 'C 实地', kind: 'solid', inks: { C: 1 } },
  { id: 'M100', label: 'M 实地', kind: 'solid', inks: { M: 1 } },
  { id: 'Y100', label: 'Y 实地', kind: 'solid', inks: { Y: 1 } },
  { id: 'K100', label: 'K 实地', kind: 'solid', inks: { K: 1 } },
  { id: 'C80', label: 'C 80%', kind: 'tint', inks: { C: 0.8 } },
  { id: 'C40', label: 'C 40%', kind: 'tint', inks: { C: 0.4 } },
  { id: 'M80', label: 'M 80%', kind: 'tint', inks: { M: 0.8 } },
  { id: 'M40', label: 'M 40%', kind: 'tint', inks: { M: 0.4 } },
  { id: 'Y80', label: 'Y 80%', kind: 'tint', inks: { Y: 0.8 } },
  { id: 'Y40', label: 'Y 40%', kind: 'tint', inks: { Y: 0.4 } },
  { id: 'K80', label: 'K 80%', kind: 'tint', inks: { K: 0.8 } },
  { id: 'K40', label: 'K 40%', kind: 'tint', inks: { K: 0.4 } },
  { id: 'R_MY', label: '红 M+Y', kind: 'overprint', inks: { M: 1, Y: 1 } },
  { id: 'G_CY', label: '绿 C+Y', kind: 'overprint', inks: { C: 1, Y: 1 } },
  { id: 'B_CM', label: '蓝 C+M', kind: 'overprint', inks: { C: 1, M: 1 } },
  { id: 'gray', label: '灰平衡 50/40/40', kind: 'gray', inks: { C: 0.5, M: 0.4, Y: 0.4 } },
  { id: 'C25', label: 'C 25%', kind: 'tint', inks: { C: 0.25 } },
  { id: 'M25', label: 'M 25%', kind: 'tint', inks: { M: 0.25 } },
  { id: 'Y25', label: 'Y 25%', kind: 'tint', inks: { Y: 0.25 } },
  { id: 'K50', label: 'K 50%', kind: 'tint', inks: { K: 0.5 } },
];

/**
 * Neugebauer + Yule-Nielsen 正向模型:
 * 计算色块在给定机台偏差下的三波段反射率真值。
 */
export function patchReflectance(spec: PatchSpec, dev: PressDeviation): Vec3 {
  const present = PRINT_ORDER.filter((ink) => (spec.inks[ink] ?? 0) > 0);
  const n = present.length;
  const acc: Vec3 = [0, 0, 0];
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    // 该 Neugebauer 基元的面积权重
    let area = 1;
    for (let i = 0; i < n; i++) {
      const a = effectiveCoverage(present[i], spec.inks[present[i]] ?? 0, dev);
      area *= mask & (1 << i) ? a : 1 - a;
    }
    if (area < 1e-9) continue;
    // 基元密度: 按色序叠加油墨密度, 非第一色乘叠印率
    const D: Vec3 = [0, 0, 0];
    let prev: Ink | null = null;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const ink = present[i];
      const t = thickness(ink, dev);
      const trap = prev === null ? 1 : trapFactor(prev, ink, dev);
      for (let b = 0; b < 3; b++) D[b] += INK_D[ink][b] * t * trap;
      prev = ink;
    }
    for (let b = 0; b < 3; b++) {
      const rPrimary = PAPER_RGB[b] * Math.pow(10, -D[b]);
      acc[b] += area * Math.pow(rPrimary, 1 / YN_N);
    }
  }
  return [
    Math.pow(acc[0], YN_N),
    Math.pow(acc[1], YN_N),
    Math.pow(acc[2], YN_N),
  ];
}
