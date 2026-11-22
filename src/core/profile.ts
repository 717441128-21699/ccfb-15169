/**
 * 扫描仪特性化
 * 用标准色卡采样训练两个多项式岭回归模型：
 *  - RGB(线性) → Lab(D50)
 *  - RGB(线性) → 四色 Status T 密度（C/M/Y/K，纸白相对）
 * 训练/校验按 80/20 拆分，返回校验集 RMSE 作为残差指标。
 */
import {
  basisSize,
  polynomialBasis,
  predict,
  ridgeFit,
  rmse,
  standardize,
  stats3,
  type Degree,
} from './polynomial.ts';
import { scannerRgbToLinear } from './spectral/scanner.ts';
import type {
  ChartSample,
  Densities,
  InkName,
  Lab,
  ScannerProfile,
} from './types.ts';

const INK_ORDER: InkName[] = ['C', 'M', 'Y', 'K'];

function densityVector(d: Densities): number[] {
  // C 用红通道密度，M 绿，Y 蓝；K 用视觉密度
  return [d.dR, d.dG, d.dB, d.dV];
}

function toDensities(v: number[]): Densities {
  return {
    dR: v[0],
    dG: v[1],
    dB: v[2],
    dV: v[3],
  };
}

export interface ProfileTrainResult {
  profile: ScannerProfile;
  valDeltaE: number[];
  valDensityErr: number[];
  valMaxDeltaE: number;
  valMaxDensityErr: number;
}

/** 确定性洗牌（Fibonacci 散列），保证可复现 */
function splitIndices(n: number, valFrac: number, seed = 7): { train: number[]; val: number[] } {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const valCount = Math.max(1, Math.round(n * valFrac));
  return { train: order.slice(valCount), val: order.slice(0, valCount) };
}

export function trainProfile(
  samples: ChartSample[],
  degree: Degree = 4,
  name = '默认扫描仪特性文件',
): ProfileTrainResult {
  if (samples.length < basisSize(degree) + 8) {
    throw new Error(`色卡样本不足，至少需要 ${basisSize(degree) + 8} 个色块`);
  }
  const rgbs = samples.map((s) => scannerRgbToLinear(s.rgb));
  const { mean, std } = stats3(rgbs);
  const bases = rgbs.map((rgb) =>
    polynomialBasis(...standardize(rgb, mean, std), degree),
  );

  const yLabAll = samples.map((s) => [s.lab.L, s.lab.a, s.lab.b]);
  const yDenAll = samples.map((s) => densityVector(s.densities));

  // 岭参数随阶数提高略增，抑制高阶项在检测噪声下的过拟合
  const lambdaLab =
    degree === 2 ? 0.0001 : degree === 3 ? 0.0003 : 0.0003;
  const lambdaDen = lambdaLab * 0.5;

  // 5 折交叉验证评估泛化精度（折外预测）
  const folds = 5;
  const order = Array.from({ length: samples.length }, (_, i) => i);
  let sSeed = 7;
  for (let i = order.length - 1; i > 0; i--) {
    sSeed = (sSeed * 1103515245 + 12345) & 0x7fffffff;
    const j = sSeed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const valDeltaE: number[] = [];
  const valDensityErr: number[] = [];
  for (let f = 0; f < folds; f++) {
    const valIdx = order.filter((_, k) => k % folds === f);
    const trainIdx = order.filter((_, k) => k % folds !== f);
    const bLab = ridgeFit(trainIdx.map((i) => bases[i]), trainIdx.map((i) => yLabAll[i]), lambdaLab);
    const bDen = ridgeFit(trainIdx.map((i) => bases[i]), trainIdx.map((i) => yDenAll[i]), lambdaDen);
    for (const i of valIdx) {
      const lp = predict(bLab, bases[i]);
      valDeltaE.push(deltaE({ L: lp[0], a: lp[1], b: lp[2] }, samples[i].lab));
      const dp = predict(bDen, bases[i]);
      for (let k = 0; k < 4; k++) valDensityErr.push(Math.abs(dp[k] - yDenAll[i][k]));
    }
  }

  // 最终模型用全部色卡数据训练（生产部署口径）
  const betaLab = ridgeFit(bases, yLabAll, lambdaLab);
  const betaDen = ridgeFit(bases, yDenAll, lambdaDen);

  // 部署模型自拟合残差（实际工作精度），与折外 CV 分开记录
  const selfDeltaE = samples.map((s, i) => {
    const v = predict(betaLab, bases[i]);
    return deltaE({ L: v[0], a: v[1], b: v[2] }, s.lab);
  });
  const selfDensityErr: number[] = [];
  samples.forEach((s, i) => {
    const dp = predict(betaDen, bases[i]);
    for (let k = 0; k < 4; k++) selfDensityErr.push(Math.abs(dp[k] - yDenAll[i][k]));
  });

  // 纸白样本（覆盖率全 0），找不到时退化为最亮样本
  const paperSample =
    samples.find((s) =>
      (Object.values(s.coverage) as number[]).every((v) => v === 0),
    ) ??
    samples.reduce((best, s) =>
      s.rgb[0] + s.rgb[1] + s.rgb[2] > best.rgb[0] + best.rgb[1] + best.rgb[2] ? s : best,
    );
  const profile: ScannerProfile = {
    id: `profile-${samples.length}-${degree}`,
    name,
    createdAt: Date.now(),
    polynomialDegree: degree,
    coefLab: betaLab,
    coefDensity: betaDen,
    basisSize: basisSize(degree),
    fitResidualLab: rmse(selfDeltaE),
    fitResidualDensity: rmse(selfDensityErr),
    rgbMean: mean,
    rgbStd: std,
    paperRgb: paperSample.rgb,
  };

  return {
    profile,
    valDeltaE,
    valDensityErr,
    valMaxDeltaE: Math.max(...valDeltaE),
    valMaxDensityErr: Math.max(...valDensityErr),
  };
}

/** 局部 ΔE（避免与 color.ts 循环，直接复用其实现） */
import { deltaE2000 } from './spectral/color.ts';
function deltaE(a: Lab, b: Lab): number {
  return deltaE2000(a, b);
}

/** 用 profile 从扫描 RGB 预测 Lab */
export function predictLab(profile: ScannerProfile, rgb: [number, number, number]): Lab {
  const lin = scannerRgbToLinear(rgb);
  const basis = polynomialBasis(
    ...standardize(lin, profile.rgbMean, profile.rgbStd),
    profile.polynomialDegree,
  );
  const v = predict(profile.coefLab, basis);
  return { L: v[0], a: v[1], b: v[2] };
}

/** 用 profile 从扫描 RGB 预测四色密度 */
export function predictDensities(
  profile: ScannerProfile,
  rgb: [number, number, number],
): Densities {
  const lin = scannerRgbToLinear(rgb);
  const basis = polynomialBasis(
    ...standardize(lin, profile.rgbMean, profile.rgbStd),
    profile.polynomialDegree,
  );
  return toDensities(predict(profile.coefDensity, basis));
}

export { INK_ORDER };
