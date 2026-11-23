// 色控条几何检测:由行/列暗度轮廓定位定位标记, 解算各色块中心。
// 与采样方式(GPU/CPU)无关, 两侧共用。

import { STRIP } from '../sim/model';
import type { Calibration } from '../calib/calibration';
import {
  SHEET_W,
  SHEET_H,
  MARK_L_CX,
  MARK_R_CX,
  patchLayoutCx,
} from '../sim/sheetSynth';

/** 采样器接口: GPU 与 CPU 两种实现 */
export interface Sampler {
  readonly kind: 'gpu' | 'cpu';
  setImage(img: ImageData): void;
  setCalibration(cal: Calibration): void;
  /** 行暗度轮廓: 对每行 y, 在列范围 [x0,x1) 内求平均暗度 */
  rowProfile(x0: number, x1: number): Float32Array;
  /** 列暗度轮廓: 对每列 x, 在行范围 [y0,y1) 内求平均暗度 */
  colProfile(y0: number, y1: number): Float32Array;
  /** 逐色块测量: 返回 Lab 与四色密度 */
  measure(geom: StripGeometry, half: number): PatchSample[];
  /** 逐色块原始扫描 RGB 均值(暗角校正后, 未校准) — 用于色卡特性化 */
  measureRaw(geom: StripGeometry, half: number): [number, number, number][];
}

export interface PatchSample {
  lab: [number, number, number];
  dens: { C: number; M: number; Y: number; K: number };
}

export interface StripGeometry {
  centers: { x: number; y: number }[];
  axis: { x: number; y: number };
  nrm: { x: number; y: number };
  angleDeg: number;
  markL: { x: number; y: number };
  markR: { x: number; y: number };
  stripY0: number;
  stripY1: number;
}

/** 检测色控条几何; 返回 null 表示未找到 */
export function detectStrip(s: Sampler): StripGeometry | null {
  const H = SHEET_H;
  const W = SHEET_W;

  // 1. 全宽行轮廓, 在底部 20% 区域找暗度带(取最靠下且高度合理者)
  const rowDark = s.rowProfile(0, W);
  const yStart = Math.floor(H * 0.8);
  let y0 = -1;
  let y1 = -1;
  let bandStart = -1;
  for (let y = yStart; y < H; y++) {
    if (rowDark[y] > 0.15) {
      if (bandStart < 0) bandStart = y;
      y1 = y;
    } else if (bandStart >= 0 && y - y1 > 12) {
      if (y1 - bandStart >= 25 && y1 - bandStart <= 160) {
        y0 = bandStart; // 记录候选, 继续找更靠下的
      }
      bandStart = -1;
    }
  }
  if (bandStart >= 0 && y1 - bandStart >= 25 && y1 - bandStart <= 160) y0 = bandStart;
  if (y0 < 0) return null;
  // 重新确定该候选带的上沿
  y1 = y0;
  for (let y = y0; y < H; y++) {
    if (rowDark[y] > 0.15) y1 = y;
    else if (y - y1 > 12) break;
  }

  // 2. 条带内列轮廓, 找左右定位标记(纯黑方块 -> 列暗度很高)
  const colDark = s.colProfile(y0, y1 + 1);
  const clusters: { x0: number; x1: number }[] = [];
  let cx0 = -1;
  for (let x = 0; x < W; x++) {
    if (colDark[x] > 0.5) {
      if (cx0 < 0) cx0 = x;
    } else if (cx0 >= 0) {
      clusters.push({ x0: cx0, x1: x - 1 });
      cx0 = -1;
    }
  }
  if (cx0 >= 0) clusters.push({ x0: cx0, x1: W - 1 });
  const marks = clusters.filter((c) => c.x1 - c.x0 >= 15 && c.x1 - c.x0 <= 130);
  if (marks.length < 2) return null;
  const mL = marks[0];
  const mR = marks[marks.length - 1];
  const xl = (mL.x0 + mL.x1) / 2;
  const xr = (mR.x0 + mR.x1) / 2;

  // 3. 两个标记各自的行质心
  const rowL = s.rowProfile(mL.x0, mL.x1 + 1);
  const rowR = s.rowProfile(mR.x0, mR.x1 + 1);
  const centroid = (rd: Float32Array): number => {
    let sw = 0;
    let sy = 0;
    for (let y = Math.max(0, y0 - 40); y <= Math.min(H - 1, y1 + 40); y++) {
      const w = Math.max(0, rd[y] - 0.3);
      sw += w;
      sy += w * y;
    }
    return sw > 1e-6 ? sy / sw : (y0 + y1) / 2;
  };
  const yl = centroid(rowL);
  const yr = centroid(rowR);

  const angle = Math.atan2(yr - yl, xr - xl);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const nrm = { x: -Math.sin(angle), y: Math.cos(angle) };
  const markL = { x: xl, y: yl };
  const markR = { x: xr, y: yr };

  // 4. 模板比例 -> 各色块中心
  const span = MARK_R_CX - MARK_L_CX;
  const centers = STRIP.map((_, i) => {
    const t = (patchLayoutCx(i) - MARK_L_CX) / span;
    return {
      x: markL.x + (markR.x - markL.x) * t,
      y: markL.y + (markR.y - markL.y) * t,
    };
  });

  return {
    centers,
    axis,
    nrm,
    angleDeg: (angle * 180) / Math.PI,
    markL,
    markR,
    stripY0: y0,
    stripY1: y1,
  };
}
