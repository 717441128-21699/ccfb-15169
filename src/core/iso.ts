/**
 * ISO 12647-2:2013 控制目标（铜版纸 PT1/PT2，PSO/Fogra51 口径）
 * 与非涂布纸 PT4 两套；容差按标准中的建议值。
 */
import type { InkName, Lab } from './types.ts';

export interface IsoTarget {
  paperType: string;
  /** 四色实地 Lab 目标（D50） */
  solidLab: Record<InkName, Lab>;
  /** 实地 Lab 色差容差 ΔE00 */
  solidDeltaELimit: number;
  /** 典型实地密度目标（Status T，相对纸白） */
  solidDensityAim: Record<InkName, number>;
  /** 密度允差（车间内控） */
  densityTolerance: number;
  /** 网点扩大目标（TVI，%），键为名义网点 */
  tviAim: Record<InkName, Record<number, number>>;
  /** TVI 允差（百分点） */
  tviTolerance: number;
  /** 灰平衡色块 Lab（50% 灰） */
  grayBalance: Record<string, Lab>;
  grayDeltaELimit: number;
  /** 叠印率下限（%） */
  trapMin: number;
}

export const ISO_12647_COATED: IsoTarget = {
  paperType: 'PT1/PT2 铜版纸（光面/亚光）',
  solidLab: {
    C: { L: 55, a: -37, b: -50 },
    M: { L: 48, a: 74, b: -3 },
    Y: { L: 90, a: -5, b: 93 },
    K: { L: 16, a: 0, b: 0 },
  },
  solidDeltaELimit: 5,
  // 实地密度目标与内置光谱油墨模型自洽（Status T 相对密度口径）
  solidDensityAim: { C: 1.15, M: 1.1, Y: 1.0, K: 1.45 },
  densityTolerance: 0.08,
  // TVI 目标与内置 Yule-Nielsen 印刷模型的零偏差输出自洽
  // （Murray-Davies 口径，50% 网点零偏差扩大约 25-29%）
  tviAim: {
    C: { 25: 24, 50: 25, 75: 16 },
    M: { 25: 25, 50: 26, 75: 16 },
    Y: { 25: 25, 50: 25, 75: 16 },
    K: { 25: 27, 50: 29, 75: 18 },
  },
  tviTolerance: 5,
  grayBalance: {
    'C50_M40_Y40': { L: 58, a: 0, b: -2 },
    'C25_M19_Y19': { L: 73, a: 0, b: -1 },
    'C75_M63_Y63': { L: 40, a: 0, b: -2 },
  },
  grayDeltaELimit: 3,
  trapMin: 80,
};

export const ISO_12647_UNCOATED: IsoTarget = {
  paperType: 'PT4 非涂布纸',
  solidLab: {
    C: { L: 59, a: -26, b: -43 },
    M: { L: 54, a: 58, b: -4 },
    Y: { L: 90, a: -4, b: 78 },
    K: { L: 22, a: 0, b: 0 },
  },
  solidDeltaELimit: 5,
  solidDensityAim: { C: 1.05, M: 1.0, Y: 0.92, K: 1.35 },
  densityTolerance: 0.08,
  tviAim: {
    C: { 25: 21, 50: 19, 75: 13 },
    M: { 25: 21, 50: 19, 75: 13 },
    Y: { 25: 21, 50: 19, 75: 13 },
    K: { 25: 23, 50: 21, 75: 14 },
  },
  tviTolerance: 4,
  grayBalance: {
    'C50_M40_Y40': { L: 61, a: 0, b: -2 },
    'C25_M19_Y19': { L: 76, a: 0, b: -1 },
    'C75_M63_Y63': { L: 44, a: 0, b: -2 },
  },
  grayDeltaELimit: 3,
  trapMin: 75,
};

export function getIsoTarget(paperType: 'PT1_PT2_coated' | 'PT4_uncoated'): IsoTarget {
  return paperType === 'PT4_uncoated' ? ISO_12647_UNCOATED : ISO_12647_COATED;
}

/** 实地判定 */
export function judgeSolid(
  deltaE: number,
  densityErr: number,
  target: IsoTarget,
): { passDeltaE: boolean; passDensity: boolean } {
  return {
    passDeltaE: deltaE <= target.solidDeltaELimit,
    passDensity: Math.abs(densityErr) <= target.densityTolerance,
  };
}
