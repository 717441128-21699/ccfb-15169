// 精度自检:按多种墨量偏差合成测试印张, 跑完整检测管线,
// 与物理模型真值(相当于分光密度计读数)对比, 验证三项指标:
//   1. 密度读数差 ≤ 0.03
//   2. 色块色差(测量 Lab vs 真值 Lab) ΔE00 ≤ 1.5
//   3. 单张检测耗时 < 1000 ms

import { deltaE00, bandToLab, densitiesFromBand } from '../color/colorscience';
import { STRIP, patchReflectance, type PressDeviation } from '../sim/model';
import { renderSheet } from '../sim/sheetSynth';
import { detectStrip, type Sampler } from '../detect/geometry';

export interface Scenario {
  name: string;
  dev: PressDeviation;
}

const D = (
  dD: Partial<Record<'C' | 'M' | 'Y' | 'K', number>>,
  dTvi: Partial<Record<'C' | 'M' | 'Y' | 'K', number>> = {},
  dTrap: Record<string, number> = {}
): PressDeviation => ({
  dD: { C: 0, M: 0, Y: 0, K: 0, ...dD },
  dTvi: { C: 0, M: 0, Y: 0, K: 0, ...dTvi },
  dTrap,
});

export const SCENARIOS: Scenario[] = [
  { name: '基准(无偏差)', dev: D({}) },
  { name: 'C 墨量 +0.10', dev: D({ C: 0.1 }) },
  { name: 'M 墨量 -0.08', dev: D({ M: -0.08 }) },
  { name: 'Y +0.06 / K -0.06', dev: D({ Y: 0.06, K: -0.06 }) },
  {
    name: '四色综合偏差',
    dev: D({ C: 0.05, M: -0.05, Y: 0.08, K: 0.03 }, { C: 0.04, M: -0.03 }, { 'M>Y': -0.08 }),
  },
  {
    name: '网点扩大偏大 + 叠印偏低',
    dev: D({}, { C: 0.06, M: 0.06, Y: 0.05, K: 0.06 }, { 'C>Y': -0.12, 'C>M': -0.1 }),
  },
];

/** 随机偏差场景 */
export function randomScenario(rng: () => number, i: number): Scenario {
  const r = () => (rng() - 0.5) * 2;
  return {
    name: `随机 #${i + 1}`,
    dev: {
      dD: { C: r() * 0.12, M: r() * 0.12, Y: r() * 0.12, K: r() * 0.12 },
      dTvi: { C: r() * 0.06, M: r() * 0.06, Y: r() * 0.06, K: r() * 0.06 },
      dTrap: { 'M>Y': r() * 0.1, 'C>Y': r() * 0.1, 'C>M': r() * 0.1 },
    },
  };
}

export interface SelfTestRow {
  scenario: string;
  maxDD: number; // 实地密度最大误差
  maxDE: number; // 色块 Lab 最大误差
  ms: number; // 检测耗时
  pass: boolean;
}

export interface SelfTestReport {
  rows: SelfTestRow[];
  maxDD: number;
  maxDE: number;
  maxMs: number;
  pass: boolean;
  samplerKind: string;
}

export const SPEC = { maxDD: 0.03, maxDE: 1.5, maxMs: 1000 };

/** 用指定采样器跑一组场景 */
export function runSelfTest(
  sampler: Sampler,
  scenarios: Scenario[],
  seedBase = 1000
): SelfTestReport {
  const rows: SelfTestRow[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const sheet = renderSheet(sc.dev, seedBase + i * 17);
    sampler.setImage(sheet.image);
    const t0 = performance.now();
    const geom = detectStrip(sampler);
    if (!geom) {
      rows.push({ scenario: sc.name, maxDD: Infinity, maxDE: Infinity, ms: 0, pass: false });
      continue;
    }
    const samples = sampler.measure(geom, 16);
    const ms = performance.now() - t0;

    let maxDD = 0;
    let maxDE = 0;
    STRIP.forEach((spec, k) => {
      const truth = patchReflectance(spec, sc.dev);
      const truthLab = bandToLab(truth);
      const truthDens = densitiesFromBand(truth);
      const s = samples[k];
      const de = deltaE00(s.lab, truthLab);
      maxDE = Math.max(maxDE, de);
      if (spec.kind === 'solid') {
        const ink = spec.id[0] as 'C' | 'M' | 'Y' | 'K';
        maxDD = Math.max(maxDD, Math.abs(s.dens[ink] - truthDens[ink]));
      }
    });
    const pass = maxDD <= SPEC.maxDD && maxDE <= SPEC.maxDE && ms < SPEC.maxMs;
    rows.push({ scenario: sc.name, maxDD, maxDE, ms, pass });
  }
  const maxDD = Math.max(...rows.map((r) => r.maxDD));
  const maxDE = Math.max(...rows.map((r) => r.maxDE));
  const maxMs = Math.max(...rows.map((r) => r.ms));
  return {
    rows,
    maxDD,
    maxDE,
    maxMs,
    pass: rows.every((r) => r.pass),
    samplerKind: sampler.kind,
  };
}
