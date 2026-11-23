// 扫描仪特性化:用标准色卡(中性梯尺 + CMY 色域网格)拟合
// 每通道逆色调曲线 LUT + 3x3 矩阵, 把扫描仪 RGB 映射回三波段反射率。

import type { Vec3 } from '../color/colorscience';
import { bandToLab, deltaE00 } from '../color/colorscience';
import { PAPER_RGB, patchReflectance, ZERO_DEV } from '../sim/model';
import { bandToScanner, makeRng, gauss, SCAN_NOISE } from '../sim/scanner';

export interface Calibration {
  /** 每通道 256 级逆色调曲线: 编码值 -> 线性波段值 */
  lut: [Float32Array, Float32Array, Float32Array];
  /** 3x3 矩阵(行主序) + 偏移 */
  matrix: Float32Array;
  offset: Float32Array;
  createdAt: string;
  /** 拟合残差: 色卡复测误差 */
  residual: { maxDD: number; meanDD: number; maxDE: number; meanDE: number };
}

/** 色卡色块: 真值波段反射率 */
export interface CalibPatch {
  truth: Vec3;
  cx: number;
  cy: number;
}

export const CALIB_COLS = 12;
export const CALIB_CELL = 64;
export const CALIB_MARGIN = 40;

/** 中性梯尺级数 */
const RAMP_STEPS = 32;

/** 生成色卡色块真值与位置(32 级中性梯尺 + 4x4x4 CMY 网格 + 4 级 K) */
export function calibTargetPatches(): CalibPatch[] {
  const patches: CalibPatch[] = [];
  const push = (truth: Vec3, i: number) => {
    const col = i % CALIB_COLS;
    const row = Math.floor(i / CALIB_COLS);
    patches.push({
      truth,
      cx: CALIB_MARGIN + col * CALIB_CELL + CALIB_CELL / 2,
      cy: CALIB_MARGIN + row * CALIB_CELL + CALIB_CELL / 2,
    });
  };
  let i = 0;
  // 中性梯尺: 密度 0..2.2(覆盖三色叠印最暗波段)
  for (let k = 0; k < RAMP_STEPS; k++) {
    const D = (k / (RAMP_STEPS - 1)) * 2.2;
    const t: Vec3 = [
      PAPER_RGB[0] * Math.pow(10, -D),
      PAPER_RGB[1] * Math.pow(10, -D),
      PAPER_RGB[2] * Math.pow(10, -D),
    ];
    push(t, i++);
  }
  // CMY 网格 4x4x4
  const levels = [0, 0.33, 0.66, 1];
  for (const c of levels)
    for (const m of levels)
      for (const y of levels) {
        const t = patchReflectance(
          { id: '', label: '', kind: 'overprint', inks: { C: c, M: m, Y: y } },
          ZERO_DEV
        );
        push(t, i++);
      }
  // K 梯尺 4 级
  for (const k of [0.25, 0.5, 0.75, 1]) {
    const t = patchReflectance(
      { id: '', label: '', kind: 'tint', inks: { K: k } },
      ZERO_DEV
    );
    push(t, i++);
  }
  return patches;
}

export const CALIB_W = CALIB_MARGIN * 2 + CALIB_COLS * CALIB_CELL;
export const CALIB_ROWS = Math.ceil((RAMP_STEPS + 64 + 4) / CALIB_COLS);
export const CALIB_H = CALIB_MARGIN * 2 + CALIB_ROWS * CALIB_CELL;

/** 合成色卡扫描图(色块浮点直写, 量化只在最终输出发生一次) */
export function renderCalibTarget(seed = 7): ImageData {
  const rng = makeRng(seed);
  const patches = calibTargetPatches();
  const c = document.createElement('canvas');
  c.width = CALIB_W;
  c.height = CALIB_H;
  const g = c.getContext('2d')!;
  const paperScan = bandToScanner(PAPER_RGB);
  const cc = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  g.fillStyle = `rgb(${cc(paperScan[0])},${cc(paperScan[1])},${cc(paperScan[2])})`;
  g.fillRect(0, 0, CALIB_W, CALIB_H);
  const img = g.getImageData(0, 0, CALIB_W, CALIB_H);
  const d = img.data;
  // 纸底: 暗角 + 噪声
  for (let y = 0; y < CALIB_H; y++) {
    for (let x = 0; x < CALIB_W; x++) {
      const i = (y * CALIB_W + x) * 4;
      const nx = (x - CALIB_W / 2) / (CALIB_W / 2);
      const ny = (y - CALIB_H / 2) / (CALIB_H / 2);
      const vig = 1 - 0.05 * (nx * nx + ny * ny) * 0.5;
      for (let ch = 0; ch < 3; ch++) {
        const v = d[i + ch] * vig + gauss(rng) * SCAN_NOISE * 255;
        d[i + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      d[i + 3] = 255;
    }
  }
  // 色块: 浮点颜色直写
  for (const p of patches) {
    const enc = bandToScanner(p.truth);
    for (let dy = -26; dy < 26; dy++) {
      for (let dx = -26; dx < 26; dx++) {
        const px = Math.round(p.cx + dx);
        const py = Math.round(p.cy + dy);
        if (px < 0 || py < 0 || px >= CALIB_W || py >= CALIB_H) continue;
        const nx = (px - CALIB_W / 2) / (CALIB_W / 2);
        const ny = (py - CALIB_H / 2) / (CALIB_H / 2);
        const vig = 1 - 0.05 * (nx * nx + ny * ny) * 0.5;
        const i = (py * CALIB_W + px) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const v = enc[ch] * 255 * vig + gauss(rng) * SCAN_NOISE * 255;
          d[i + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
        d[i + 3] = 255;
      }
    }
  }
  return img;
}

/** LUT 连续查找(线性插值, 与 GLSL lutS 一致) */
export function lutLookup(lut: Float32Array, v: number): number {
  const x = Math.min(1, Math.max(0, v)) * 255 - 0.5;
  const i = Math.min(254, Math.max(0, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - i));
  return lut[i] * (1 - f) + lut[i + 1] * f;
}

/** 应用校准(与 GLSL 完全一致) */
export function applyCalibration(cal: Calibration, enc: Vec3): Vec3 {
  const lin: Vec3 = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    lin[ch] = lutLookup(cal.lut[ch], enc[ch]);
  }
  const m = cal.matrix;
  const o = cal.offset;
  return [
    Math.min(1, Math.max(0, m[0] * lin[0] + m[1] * lin[1] + m[2] * lin[2] + o[0])),
    Math.min(1, Math.max(0, m[3] * lin[0] + m[4] * lin[1] + m[5] * lin[2] + o[1])),
    Math.min(1, Math.max(0, m[6] * lin[0] + m[7] * lin[1] + m[8] * lin[2] + o[2])),
  ];
}

/** 解 4x4 线性方程组(高斯消元) */
function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]]);
  const n = 4;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * 单调三次 Hermite 插值(Fritsch-Carlson)生成 256 级 LUT。
 * 比分段线性精度高一个数量级, 且保持单调; 端点外按端点切线外推。
 */
function monotoneCubicLut(pts: { x: number; y: number }[], lut: Float32Array): void {
  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  for (let v = 0; v < 256; v++) {
    const x = v / 255;
    if (x <= xs[0]) {
      lut[v] = Math.max(0, ys[0] + m[0] * (x - xs[0]));
      continue;
    }
    if (x >= xs[n - 1]) {
      lut[v] = ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
      continue;
    }
    let i = 0;
    while (i < n - 2 && xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    lut[v] =
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1];
  }
}

/**
 * 拟合校准: measured[i] 为扫描仪编码 RGB(0..1), patches[i].truth 为真值波段反射率。
 */
export function fitCalibration(measured: Vec3[], patches: CalibPatch[]): Calibration {
  // 1. 每通道逆色调曲线: 用中性梯尺(前 RAMP_STEPS 块), 单调三次插值
  const luts: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(256),
    new Float32Array(256),
    new Float32Array(256),
  ];
  for (let ch = 0; ch < 3; ch++) {
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k < RAMP_STEPS; k++) {
      pts.push({ x: measured[k][ch], y: patches[k].truth[ch] });
    }
    pts.sort((a, b) => a.x - b.x);
    // 单调化(y 累积最大)
    for (let k = 1; k < pts.length; k++) {
      if (pts[k].y < pts[k - 1].y) pts[k].y = pts[k - 1].y;
    }
    monotoneCubicLut(pts, luts[ch]);
  }

  // 2. 3x3 矩阵 + 偏移: 全部色块加权最小二乘(暗部加权, 均衡相对误差)
  const matrix = new Float32Array(9);
  const offset = new Float32Array(3);
  for (let ch = 0; ch < 3; ch++) {
    const A: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const b = [0, 0, 0, 0];
    for (let i = 0; i < measured.length; i++) {
      const x = [
        lutLookup(luts[0], measured[i][0]),
        lutLookup(luts[1], measured[i][1]),
        lutLookup(luts[2], measured[i][2]),
        1,
      ];
      const y = patches[i].truth[ch];
      const w = 1 / (0.15 + y);
      const w2 = w * w;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) A[r][c] += w2 * x[r] * x[c];
        b[r] += w2 * x[r] * y;
      }
    }
    const w = solve4(A, b);
    matrix[ch * 3] = w[0];
    matrix[ch * 3 + 1] = w[1];
    matrix[ch * 3 + 2] = w[2];
    offset[ch] = w[3];
  }

  const cal: Calibration = {
    lut: luts,
    matrix,
    offset,
    createdAt: new Date().toISOString(),
    residual: { maxDD: 0, meanDD: 0, maxDE: 0, meanDE: 0 },
  };
  cal.residual = evalCalibration(cal, measured, patches);
  return cal;
}

/** 复测: 校准后色块误差(密度/ΔE) */
export function evalCalibration(
  cal: Calibration,
  measured: Vec3[],
  patches: CalibPatch[]
): { maxDD: number; meanDD: number; maxDE: number; meanDE: number } {
  let maxDD = 0;
  let sumDD = 0;
  let maxDE = 0;
  let sumDE = 0;
  for (let i = 0; i < measured.length; i++) {
    const band = applyCalibration(cal, measured[i]);
    const truth = patches[i].truth;
    for (let ch = 0; ch < 3; ch++) {
      const dd = Math.abs(-Math.log10(Math.max(band[ch], 1e-5)) - -Math.log10(Math.max(truth[ch], 1e-5)));
      maxDD = Math.max(maxDD, dd);
      sumDD += dd;
    }
    const de = deltaE00(bandToLab(band), bandToLab(truth));
    maxDE = Math.max(maxDE, de);
    sumDE += de;
  }
  const n = measured.length;
  return { maxDD, meanDD: sumDD / (n * 3), maxDE, meanDE: sumDE / n };
}

const STORAGE_KEY = 'scanpress-calib-v1';

interface CalibJson {
  lut: number[][];
  matrix: number[];
  offset: number[];
  createdAt: string;
  residual: { maxDD: number; meanDD: number; maxDE: number; meanDE: number };
}

export function saveCalibration(cal: Calibration): void {
  const j: CalibJson = {
    lut: [Array.from(cal.lut[0]), Array.from(cal.lut[1]), Array.from(cal.lut[2])],
    matrix: Array.from(cal.matrix),
    offset: Array.from(cal.offset),
    createdAt: cal.createdAt,
    residual: cal.residual,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(j));
  } catch {
    /* 忽略存储失败 */
  }
}

export function loadCalibration(): Calibration | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return null;
    const j = JSON.parse(s) as CalibJson;
    return {
      lut: [
        Float32Array.from(j.lut[0]),
        Float32Array.from(j.lut[1]),
        Float32Array.from(j.lut[2]),
      ],
      matrix: Float32Array.from(j.matrix),
      offset: Float32Array.from(j.offset),
      createdAt: j.createdAt,
      residual: j.residual,
    };
  } catch {
    return null;
  }
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
