/**
 * 平板扫描仪成像模型
 * - 冷阴极/LED 灯源光谱（近似 D65 暖机后曲线）
 * - 线阵 CCD 三色滤光片（比 Status T 更宽、带间有串扰）
 * - 12-bit 量化 + 泊松/读出噪声 + 轻微 gamma 非线性
 * 输入光谱反射率 → 输出 8-bit sRGB 编码像素值。
 */
import { D50_SPD, SPECTRAL_BANDS, WAVELENGTHS } from './data.ts';

/** 扫描仪灯源：D50 基础上带轻微滚降 */
const LAMP_SPD: readonly number[] = D50_SPD.map((s, i) => {
  const w = WAVELENGTHS[i];
  const rolloff = 0.92 + 0.08 * Math.exp(-(((w - 560) / 120) ** 2));
  return s * rolloff;
});

/** CCD 滤光片光谱灵敏度（高斯近似，存在带间串扰） */
function gaussianResponse(center: number, width: number): number[] {
  return WAVELENGTHS.map((w) => Math.exp(-0.5 * ((w - center) / width) ** 2));
}
const SENSOR_R = gaussianResponse(610, 55);
const SENSOR_G = gaussianResponse(550, 48);
const SENSOR_B = gaussianResponse(465, 52);
// 串扰矩阵（传感器输出 → 通道串扰混合）
const CROSSTALK: ReadonlyArray<readonly [number, number, number]> = [
  [0.92, 0.06, 0.02],
  [0.05, 0.9, 0.05],
  [0.02, 0.09, 0.89],
];

const BIT_DEPTH = 14;
const MAX_CODE = 2 ** BIT_DEPTH - 1;
/** 读出噪声标准差（码值），现代平板扫描仪实测约 2-3 个 14-bit 码值 */
const READ_NOISE_SIGMA = 2.4;
/** 扫描仪 gamma（输出编码与反编码必须一致） */
export const SCANNER_GAMMA = 2.2;

/** 可复现随机数（mulberry32），保证测试场景可回放 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function integrate(filter: number[], reflectance: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < SPECTRAL_BANDS; i++) {
    s += LAMP_SPD[i] * filter[i] * reflectance[i];
  }
  return s;
}

/** 扫描仪内部白平衡增益（以纸白为中性基准） */
const WHITE_GAINS = (() => {
  const paper: number[] = [];
  for (let i = 0; i < SPECTRAL_BANDS; i++) paper.push(LAMP_SPD[i]);
  const r = integrate(SENSOR_R, paper);
  const g = integrate(SENSOR_G, paper);
  const b = integrate(SENSOR_B, paper);
  const norm = (r + g + b) / 3;
  return [norm / r, norm / g, norm / b];
})();

export interface ScanOptions {
  rng?: () => number;
  /** 噪声开关（色卡训练时同样开启以覆盖真实噪声分布） */
  noise?: boolean;
}

/**
 * 光谱反射率 → 扫描 RGB（8-bit，sRGB 编码风格 gamma=2.2）
 */
export function spectralToScannerRgb(
  reflectance: ArrayLike<number>,
  opts: ScanOptions = {},
): [number, number, number] {
  const raw = [
    integrate(SENSOR_R, reflectance),
    integrate(SENSOR_G, reflectance),
    integrate(SENSOR_B, reflectance),
  ];
  // 白平衡 + 串扰
  const balanced = raw.map((v, i) => v * WHITE_GAINS[i]);
  const mixed = [
    CROSSTALK[0][0] * balanced[0] + CROSSTALK[0][1] * balanced[1] + CROSSTALK[0][2] * balanced[2],
    CROSSTALK[1][0] * balanced[0] + CROSSTALK[1][1] * balanced[1] + CROSSTALK[1][2] * balanced[2],
    CROSSTALK[2][0] * balanced[0] + CROSSTALK[2][1] * balanced[1] + CROSSTALK[2][2] * balanced[2],
  ];
  // 归一化到纸白=1
  // 纸白参考（与白平衡增益一致）
  const whiteRef = [
    integrate(SENSOR_R, new Array(SPECTRAL_BANDS).fill(1)),
    integrate(SENSOR_G, new Array(SPECTRAL_BANDS).fill(1)),
    integrate(SENSOR_B, new Array(SPECTRAL_BANDS).fill(1)),
  ].map((v, i) => v * WHITE_GAINS[i]);
  const linear = mixed.map((v, i) => v / whiteRef[i]);
  const rng = opts.rng ?? Math.random;
  const noiseOn = opts.noise ?? true;
  const out = linear.map((v) => {
    let code = v * MAX_CODE;
    if (noiseOn) {
      // 散粒噪声（随信号变化）+ 读出噪声
      const shot = Math.sqrt(Math.max(0, code)) * 0.35;
      code += (rng() + rng() + rng() - 1.5) * 1.15 * shot;
      code += (rng() + rng() + rng() - 1.5) * 1.15 * READ_NOISE_SIGMA;
    }
    code = Math.min(MAX_CODE, Math.max(0, code));
    // 输出 8-bit gamma 编码；亚量化抖动（ordered dither）让 ROI 平均
    // 恢复等效高位深精度，显著降低深色块的量化偏差
    const lin = code / MAX_CODE;
    const encoded = Math.min(1, Math.max(0, lin ** (1 / SCANNER_GAMMA))) * 255;
    const dither = rng();
    return Math.min(255, Math.max(0, Math.floor(encoded + dither)));
  });
  return [out[0], out[1], out[2]];
}

/** 扫描 RGB → 扫描仪线性空间（去 gamma），供特性化与密度回归使用 */
export function scannerRgbToLinear(rgb: [number, number, number]): [number, number, number] {
  return rgb.map((v) => (v / 255) ** SCANNER_GAMMA) as [number, number, number];
}
