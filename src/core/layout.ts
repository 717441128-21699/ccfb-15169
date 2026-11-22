/**
 * 色控条与标准色卡的布局定义
 * 色控条参考 GATF/ISO 风格：纸白、四色实地、多档淡网、叠印、灰平衡、黑梯
 */
import type { InkName, PatchSpec } from './types.ts';

const cov = (C: number, M: number, Y: number, K = 0): Record<InkName, number> => ({
  C,
  M,
  Y,
  K,
});

/** 机台色控条（检测页使用），顺序即从左到右排布 */
export const CONTROL_BAR: PatchSpec[] = [
  { id: 'paper', label: '纸白', coverage: cov(0, 0, 0, 0), kind: 'paper' },
  { id: 'C-solid', label: '青实地', coverage: cov(1, 0, 0, 0), kind: 'solid' },
  { id: 'M-solid', label: '品红实地', coverage: cov(0, 1, 0, 0), kind: 'solid' },
  { id: 'Y-solid', label: '黄实地', coverage: cov(0, 0, 1, 0), kind: 'solid' },
  { id: 'K-solid', label: '黑实地', coverage: cov(0, 0, 0, 1), kind: 'solid' },
  { id: 'C25', label: '青25%', coverage: cov(0.25, 0, 0, 0), kind: 'tint' },
  { id: 'C50', label: '青50%', coverage: cov(0.5, 0, 0, 0), kind: 'tint' },
  { id: 'C75', label: '青75%', coverage: cov(0.75, 0, 0, 0), kind: 'tint' },
  { id: 'M25', label: '品红25%', coverage: cov(0, 0.25, 0, 0), kind: 'tint' },
  { id: 'M50', label: '品红50%', coverage: cov(0, 0.5, 0, 0), kind: 'tint' },
  { id: 'M75', label: '品红75%', coverage: cov(0, 0.75, 0, 0), kind: 'tint' },
  { id: 'Y25', label: '黄25%', coverage: cov(0, 0, 0.25), kind: 'tint' },
  { id: 'Y50', label: '黄50%', coverage: cov(0, 0, 0.5), kind: 'tint' },
  { id: 'Y75', label: '黄75%', coverage: cov(0, 0, 0.75), kind: 'tint' },
  { id: 'K25', label: '黑25%', coverage: cov(0, 0, 0, 0.25), kind: 'tint' },
  { id: 'K50', label: '黑50%', coverage: cov(0, 0, 0, 0.5), kind: 'tint' },
  { id: 'K75', label: '黑75%', coverage: cov(0, 0, 0, 0.75), kind: 'tint' },
  { id: 'CM', label: '蓝叠印', coverage: cov(1, 1, 0, 0), kind: 'overprint' },
  { id: 'MY', label: '红叠印', coverage: cov(0, 1, 1, 0), kind: 'overprint' },
  { id: 'CY', label: '绿叠印', coverage: cov(1, 0, 1, 0), kind: 'overprint' },
  { id: 'gray25', label: '浅灰平衡', coverage: cov(0.25, 0.19, 0.19, 0), kind: 'gray' },
  { id: 'gray50', label: '中灰平衡', coverage: cov(0.5, 0.4, 0.4, 0), kind: 'gray' },
  { id: 'gray75', label: '深灰平衡', coverage: cov(0.75, 0.63, 0.63, 0), kind: 'gray' },
];

/** 几何尺寸（像素，合成图基准；检测时自动估计） */
export const BAR_GEOMETRY = {
  patchW: 44,
  patchH: 64,
  gap: 6,
  margin: 28,
  /** 两端定位标记（黑块）宽度 */
  markerW: 14,
};

/** 标准色卡（特性化用）：单墨梯尺 + 多色组合 + 灰梯，覆盖色域 */
export function buildChartLayout(): PatchSpec[] {
  const ramps = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const patches: PatchSpec[] = [];
  // 单墨梯尺 ×4
  for (const ink of ['C', 'M', 'Y', 'K'] as InkName[]) {
    for (const v of ramps) {
      const c: Record<InkName, number> = { C: 0, M: 0, Y: 0, K: 0 };
      c[ink] = v;
      patches.push({
        id: `${ink}-${Math.round(v * 100)}`,
        label: `${ink} ${Math.round(v * 100)}%`,
        coverage: c,
        kind: v === 0 ? 'paper' : v === 1 ? 'solid' : 'tint',
      });
    }
  }
  // 双色叠印网格（CM/MY/CY，各 5×5）
  const pairs: Array<[InkName, InkName]> = [
    ['C', 'M'],
    ['M', 'Y'],
    ['C', 'Y'],
  ];
  const grid = [0.25, 0.5, 0.75, 1];
  for (const [i1, i2] of pairs) {
    for (const a of grid) {
      for (const b of grid) {
        const c: Record<InkName, number> = { C: 0, M: 0, Y: 0, K: 0 };
        c[i1] = a;
        c[i2] = b;
        patches.push({
          id: `${i1}${Math.round(a * 100)}-${i2}${Math.round(b * 100)}`,
          label: `${i1}${Math.round(a * 100)} ${i2}${Math.round(b * 100)}`,
          coverage: c,
          kind: 'overprint',
        });
      }
    }
  }
  // 三色叠印
  for (const a of [0.25, 0.5, 0.75]) {
    for (const b of [0.25, 0.5, 0.75]) {
      for (const cc of [0.25, 0.5]) {
        patches.push({
          id: `CMY-${a}-${b}-${cc}`,
          label: `CMY ${a}/${b}/${cc}`,
          coverage: { C: a, M: b, Y: cc, K: 0 },
          kind: 'overprint',
        });
      }
    }
  }
  // 深色叠印补充：覆盖暗部色域（色控条含 MY/CM/CY 实地与高覆盖灰，
  // 训练色卡需在这些深暗处有样本，否则多项式回归外推误差大）
  const darkOverprints: Array<Partial<Record<InkName, number>>> = [
    { M: 1, Y: 1 },
    { C: 1, M: 1 },
    { C: 1, Y: 1 },
    { C: 0.75, M: 0.75, Y: 0.75 },
  ];
  for (const cov of darkOverprints) {
    const full: Record<InkName, number> = { C: 0, M: 0, Y: 0, K: 0, ...cov };
    patches.push({
      id: `dark-${patches.length}`,
      label: `深色叠印 ${patches.length}`,
      coverage: full,
      kind: 'overprint',
    });
  }
  // 灰平衡梯
  const grays: Array<[number, number, number]> = [
    [0.25, 0.19, 0.19],
    [0.5, 0.4, 0.4],
    [0.75, 0.63, 0.63],
  ];
  for (const [C, M, Y] of grays) {
    patches.push({
      id: `gray-${C}`,
      label: `灰 ${C}`,
      coverage: { C, M, Y, K: 0 },
      kind: 'gray',
    });
  }
  return patches;
}

export const CHART_GEOMETRY = {
  cols: 12,
  patchW: 40,
  patchH: 40,
  gap: 5,
  margin: 30,
  markerW: 14,
};
