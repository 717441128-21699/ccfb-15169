// ISO 12647-2 目标值、容差与判定, 以及调墨建议生成。

import {
  bandToLab,
  deltaE00,
  densitiesFromBand,
  yuleNielsen,
  type Densities,
  type Vec3,
} from './colorscience';
import {
  INKS,
  STRIP,
  TVI50_NOMINAL,
  TRAP_NOMINAL,
  YN_N,
  patchReflectance,
  ZERO_DEV,
  type Ink,
  type PatchSpec,
} from '../sim/model';
import type { PatchSample } from '../detect/geometry';

/** ISO 12647-2(涂布纸)实地 Lab 目标值 */
export const ISO_SOLID_LAB: Record<string, Vec3> = {
  C: [55, -37, -50],
  M: [48, 74, -3],
  Y: [89, -5, 93],
  K: [16, 0, 0],
};

/** 由标称模型导出的参考值(纸白/叠印/灰平衡) */
function modelRef(id: string): Vec3 {
  const spec = STRIP.find((s) => s.id === id)!;
  return bandToLab(patchReflectance(spec, ZERO_DEV));
}

export const REF_LAB: Record<string, Vec3> = {
  paper: modelRef('paper'),
  C: ISO_SOLID_LAB.C,
  M: ISO_SOLID_LAB.M,
  Y: ISO_SOLID_LAB.Y,
  K: ISO_SOLID_LAB.K,
  R_MY: modelRef('R_MY'),
  G_CY: modelRef('G_CY'),
  B_CM: modelRef('B_CM'),
  gray: modelRef('gray'),
};

/** 标称实地密度目标(由模型真值导出) */
export const TARGET_DENS: Densities = (() => {
  const d = (id: string) =>
    densitiesFromBand(patchReflectance(STRIP.find((s) => s.id === id)!, ZERO_DEV));
  return { C: d('C100').C, M: d('M100').M, Y: d('Y100').Y, K: d('K100').K };
})();

/** 纸白密度(各滤色片) */
export const PAPER_DENS: Densities = densitiesFromBand(
  patchReflectance(STRIP.find((s) => s.id === 'paper')!, ZERO_DEV)
);

/** 容差(ISO 12647-2 过程控制) */
export const TOL = {
  solidDD: 0.05, // 实地密度允差
  solidDE: 5.0, // 实地 ΔE00 允差
  tvi: 0.04, // 网点扩大允差(绝对)
  trapMin: 0.7, // 叠印率下限
  grayAB: 3.0, // 灰平衡 a*/b* 允差
};

export interface SolidResult {
  ink: Ink;
  dens: number;
  targetDens: number;
  dD: number;
  dE: number;
  pass: boolean;
}

export interface TviResult {
  ink: Ink;
  at40: number;
  at80: number;
  nominal40: number;
  pass: boolean;
}

export interface TrapResult {
  pair: string;
  label: string;
  trap: number;
  nominal: number;
  pass: boolean;
}

export interface GrayResult {
  a: number;
  b: number;
  dE: number;
  pass: boolean;
}

export interface JudgeResult {
  solids: SolidResult[];
  tvis: TviResult[];
  traps: TrapResult[];
  gray: GrayResult;
  patchDE: { spec: PatchSpec; dE: number }[];
  advice: string[];
  pass: boolean;
}

/** 判定一张印张的测量结果 */
export function judge(samples: PatchSample[]): JudgeResult {
  const byId = new Map<string, PatchSample>();
  STRIP.forEach((s, i) => byId.set(s.id, samples[i]));

  const paperDens = byId.get('paper')!.dens;

  // 实地密度与 ΔE
  const solids: SolidResult[] = INKS.map((ink) => {
    const s = byId.get(`${ink}100`)!;
    const dens = s.dens[ink];
    const target = TARGET_DENS[ink];
    const dD = dens - target;
    const dE = deltaE00(s.lab, REF_LAB[ink]);
    return {
      ink,
      dens,
      targetDens: target,
      dD,
      dE,
      pass: Math.abs(dD) <= TOL.solidDD && dE <= TOL.solidDE,
    };
  });

  // 网点扩大(Yule-Nielsen 反演, n 与制版模型一致)
  const tvis: TviResult[] = INKS.map((ink) => {
    const solid = byId.get(`${ink}100`)!.dens[ink];
    const t40 = byId.get(`${ink}40`)?.dens[ink];
    const t80 = byId.get(`${ink}80`)?.dens[ink];
    const nom50 = TVI50_NOMINAL[ink];
    const tviAt = (a: number, dt?: number) =>
      dt === undefined ? NaN : yuleNielsen(dt, solid, paperDens[ink], YN_N) - a;
    // 标称曲线在 40% 处的值(抛物线)
    const nom40 = nom50 * (1 - (2 * 0.4 - 1) ** 2);
    const at40 = tviAt(0.4, t40);
    const at80 = tviAt(0.8, t80);
    const pass = !isNaN(at40) && Math.abs(at40 - nom40) <= TOL.tvi;
    return { ink, at40, at80, nominal40: nom40, pass };
  });

  // 叠印率(Preucil): 第二色滤色片
  const trapDefs: { pair: string; label: string; patch: string; first: Ink; second: Ink }[] = [
    { pair: 'M>Y', label: '红 (M+Y)', patch: 'R_MY', first: 'M', second: 'Y' },
    { pair: 'C>Y', label: '绿 (C+Y)', patch: 'G_CY', first: 'C', second: 'Y' },
    { pair: 'C>M', label: '蓝 (C+M)', patch: 'B_CM', first: 'C', second: 'M' },
  ];
  const traps: TrapResult[] = trapDefs.map((t) => {
    const dOp = byId.get(t.patch)!.dens[t.second];
    const d1 = byId.get(`${t.first}100`)!.dens[t.second];
    const d2 = byId.get(`${t.second}100`)!.dens[t.second];
    const trap = d2 > 0.05 ? (dOp - d1) / d2 : 0;
    const nominal = TRAP_NOMINAL[t.pair] ?? 0.85;
    return { pair: t.pair, label: t.label, trap, nominal, pass: trap >= TOL.trapMin };
  });

  // 灰平衡
  const graySample = byId.get('gray')!;
  const gray: GrayResult = {
    a: graySample.lab[1],
    b: graySample.lab[2],
    dE: deltaE00(graySample.lab, REF_LAB.gray),
    pass: false,
  };
  gray.pass =
    Math.abs(gray.a - REF_LAB.gray[1]) <= TOL.grayAB &&
    Math.abs(gray.b - REF_LAB.gray[2]) <= TOL.grayAB;

  // 全部色块 ΔE(对有参考值的色块)
  const patchDE: { spec: PatchSpec; dE: number }[] = [];
  for (const s of STRIP) {
    const ref = REF_LAB[s.id];
    if (!ref) continue;
    patchDE.push({ spec: s, dE: deltaE00(byId.get(s.id)!.lab, ref) });
  }

  // 调墨建议
  const advice: string[] = [];
  for (const s of solids) {
    if (Math.abs(s.dD) > TOL.solidDD) {
      const keyPct = Math.max(-15, Math.min(15, Math.round((-s.dD / 0.02) * 2) / 2));
      advice.push(
        `${s.ink} 实地密度${s.dD > 0 ? '偏高' : '偏低'} ${Math.abs(s.dD).toFixed(2)}，` +
          `建议墨键${keyPct > 0 ? '加' : '减'} ${Math.abs(keyPct).toFixed(1)}%`
      );
    }
  }
  for (const t of tvis) {
    if (!t.pass) {
      const diff = t.at40 - t.nominal40;
      advice.push(
        `${t.ink} 网点扩大(40%)${diff > 0 ? '偏大' : '偏小'} ${Math.abs(diff * 100).toFixed(1)} 个百分点，` +
          `建议检查印版曲线补偿与橡皮布压力`
      );
    }
  }
  for (const t of traps) {
    if (!t.pass) {
      advice.push(
        `${t.label} 叠印率 ${(t.trap * 100).toFixed(0)}% 偏低(目标 ≥${(TOL.trapMin * 100).toFixed(0)}%)，` +
          `建议检查墨序、润版液 pH 与第一色墨层厚度`
      );
    }
  }
  if (!gray.pass) {
    const da = gray.a - REF_LAB.gray[1];
    const db = gray.b - REF_LAB.gray[2];
    const hints: string[] = [];
    if (Math.abs(da) > TOL.grayAB) hints.push(da > 0 ? '减 M 或加 C' : '加 M 或减 C');
    if (Math.abs(db) > TOL.grayAB) hints.push(db > 0 ? '减 Y' : '加 Y');
    advice.push(`灰平衡偏色 (Δa*=${da.toFixed(1)}, Δb*=${db.toFixed(1)})，建议${hints.join('、')}`);
  }
  if (advice.length === 0) advice.push('各项指标均在 ISO 12647-2 容差内，无需调整。');

  const pass =
    solids.every((s) => s.pass) &&
    tvis.every((t) => t.pass) &&
    traps.every((t) => t.pass) &&
    gray.pass;

  return { solids, tvis, traps, gray, patchDE, advice, pass };
}
