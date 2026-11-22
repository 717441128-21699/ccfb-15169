/**
 * 印刷呈色模型
 * - Demichel：由 CMYK 名义覆盖率求 16 个 Neugebauer 基色的面积比
 * - Yule-Nielsen 光谱 Neugebauer（n≈1.8，胶印铜版纸典型值）
 * - 支持实地墨膜厚度偏移与网点扩大偏移（测试印张合成）
 */
import {
  BLACK_REFLECTANCE,
  CYAN_REFLECTANCE,
  MAGENTA_REFLECTANCE,
  PAPER_REFLECTANCE,
  SPECTRAL_BANDS,
  YELLOW_REFLECTANCE,
} from './data.ts';
import type { InkBias, InkName } from '../types.ts';

export const INKS: InkName[] = ['C', 'M', 'Y', 'K'];

/** 单墨实地光谱（含纸基），index 0..3 = C,M,Y,K */
export const SOLID_REFLECTANCE: Record<InkName, readonly number[]> = {
  C: CYAN_REFLECTANCE,
  M: MAGENTA_REFLECTANCE,
  Y: YELLOW_REFLECTANCE,
  K: BLACK_REFLECTANCE,
};

const YULE_NIELSEN_N = 1.8;

/** 墨膜厚度变化：Beer-Lambert 风格修正 R = R_paper · (R_ink/R_paper)^t */
export function adjustSolidForInkFilm(
  reflectance: readonly number[],
  thickness: number,
): number[] {
  const out = new Array<number>(SPECTRAL_BANDS);
  for (let i = 0; i < SPECTRAL_BANDS; i++) {
    const ratio = reflectance[i] / PAPER_REFLECTANCE[i];
    out[i] = PAPER_REFLECTANCE[i] * ratio ** thickness;
  }
  return out;
}

/**
 * 名义覆盖率 → 有效覆盖率（含网点扩大）。
 * 采用 ISO 12647-2 A 曲线（50% 处 TVI≈16% 铜版纸），再叠加场景偏移。
 */
export function effectiveCoverage(nominal: number, ink: InkName, tviDeltaPct: number): number {
  if (nominal <= 0) return 0;
  if (nominal >= 1) return 1;
  // ISO-A（CMY）/ B（K）型网点扩大基准，50% 处约 16% / 18%
  const baseTvi50 = ink === 'K' ? 18 : 16;
  // 高斯型 TVI 形状：在中间调最大，两端归零
  const shape = Math.exp(-(((nominal - 0.5) / 0.28) ** 2));
  const tvi = (baseTvi50 + tviDeltaPct) / 100;
  const eff = nominal + tvi * shape;
  return Math.min(1, Math.max(0, eff));
}

/** Demichel 叠印：返回 16 基色面积比，键为 CMYK 四位 0/1 字符串 */
export function demichelFractions(cov: Record<InkName, number>): Record<string, number> {
  const { C, M, Y, K } = cov;
  const out: Record<string, number> = {};
  for (let k = 0; k < 2; k++) {
    const fk = k === 1 ? K : 1 - K;
    for (let c = 0; c < 2; c++) {
      const fc = c === 1 ? C : 1 - C;
      for (let m = 0; m < 2; m++) {
        const fm = m === 1 ? M : 1 - M;
        for (let y = 0; y < 2; y++) {
          const fy = y === 1 ? Y : 1 - Y;
          out[`${c}${m}${y}${k}`] = fc * fm * fy * fk;
        }
      }
    }
  }
  return out;
}

/** 多墨叠印基色的光谱：各墨按 Beer-Lambert 依次叠在纸上 */
function overprintSpectrum(
  present: InkName[],
  thickness: Record<InkName, number>,
): number[] {
  const out = new Array<number>(SPECTRAL_BANDS);
  for (let i = 0; i < SPECTRAL_BANDS; i++) {
    let r = PAPER_REFLECTANCE[i];
    for (const ink of present) {
      const solid = adjustSolidForInkFilm(SOLID_REFLECTANCE[ink], thickness[ink]);
      r = (solid[i] / PAPER_REFLECTANCE[i]) * r;
    }
    out[i] = r;
  }
  return out;
}

/**
 * 合成一个 CMYK 覆盖率组合的光谱反射率
 * @param coverage 名义覆盖率 0..1
 * @param bias 墨量偏差
 */
export function synthesizeSpectrum(
  coverage: Record<InkName, number>,
  bias: InkBias = { solidDelta: {}, tviDelta: {} },
): number[] {
  const thickness: Record<InkName, number> = {
    C: 1 + (bias.solidDelta.C ?? 0),
    M: 1 + (bias.solidDelta.M ?? 0),
    Y: 1 + (bias.solidDelta.Y ?? 0),
    K: 1 + (bias.solidDelta.K ?? 0),
  };
  const eff: Record<InkName, number> = {
    C: effectiveCoverage(coverage.C, 'C', bias.tviDelta.C ?? 0),
    M: effectiveCoverage(coverage.M, 'M', bias.tviDelta.M ?? 0),
    Y: effectiveCoverage(coverage.Y, 'Y', bias.tviDelta.Y ?? 0),
    K: effectiveCoverage(coverage.K, 'K', bias.tviDelta.K ?? 0),
  };
  const fractions = demichelFractions(eff);
  // Yule-Nielsen：R_eff = (Σ f_i · R_i^(1/n))^n
  const accum = new Array<number>(SPECTRAL_BANDS).fill(0);
  for (const [key, frac] of Object.entries(fractions)) {
    if (frac < 1e-9) continue;
    const present: InkName[] = [];
    if (key[0] === '1') present.push('C');
    if (key[1] === '1') present.push('M');
    if (key[2] === '1') present.push('Y');
    if (key[3] === '1') present.push('K');
    const spec = overprintSpectrum(present, thickness);
    for (let i = 0; i < SPECTRAL_BANDS; i++) {
      accum[i] += frac * spec[i] ** (1 / YULE_NIELSEN_N);
    }
  }
  return accum.map((v) => Math.min(1, Math.max(0.002, v ** YULE_NIELSEN_N)));
}

/** 标准（零偏差）名义覆盖率对应的有效覆盖率——用于 TVI 真值 */
export function nominalToEffectiveStandard(nominal: number, ink: InkName): number {
  return effectiveCoverage(nominal, ink, 0);
}
