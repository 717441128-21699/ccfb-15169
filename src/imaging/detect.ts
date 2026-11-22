/**
 * 色控条自动定位管线
 * 1) 灰度 + 降采样，条带行区间内列投影峰度搜索倾斜角（粗 0.5°/细 0.1°）
 * 2) 校正后用暗像素行投影定位条带上下边界
 * 3) 自适应阈值（纸白与最暗值之间）列投影找两端黑色定位标记
 * 4) 标记间等距网格切分，逐块输出中心/尺寸供 ROI 采样
 * CPU 与 WebGL2 后端实现同一 ImagingBackend 接口。
 */
import {
  allBands,
  columnProjection,
  longestBand,
  roiMeanRgb,
  rotateRgb,
  rowProjection,
} from './kernels-cpu.ts';
import { CONTROL_BAR } from '../core/layout.ts';
import {
  cpuBackend,
  estimateAngleFallback,
  gpuBackend,
  type ImagingBackend,
} from './detect-internals.ts';
import type {
  FloatImage,
  LocatedPatch,
  PatchSpec,
  RGBImage,
} from '../core/types.ts';

export { cpuBackend, gpuBackend };
export type { ImagingBackend };

export interface DetectionResult {
  corrected: RGBImage;
  angleDeg: number;
  band: [number, number];
  markerLeft: number;
  markerRight: number;
  located: LocatedPatch[];
}

/** 暗像素行投影定位条带：返回最强的连续暗行区段 */
function findDarkBand(gray: FloatImage): [number, number] {
  // 纸白灰度（取最亮 20% 分位）与自适应阈值
  const sorted = Float32Array.from(gray.data).filter(Number.isFinite).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)];
  const darkest = sorted[Math.floor(sorted.length * 0.02)];
  const threshold = darkest + (paper - darkest) * 0.45;
  const dark: FloatImage = {
    width: gray.width,
    height: gray.height,
    data: new Float32Array(gray.data.length),
  };
  for (let i = 0; i < gray.data.length; i++) {
    dark.data[i] = gray.data[i] < threshold ? 1 : 0;
  }
  const proj = rowProjection(dark);
  // 条带行暗像素占比高；用行宽的 12% 作为门限
  const rowThr = gray.width * 0.12;
  return longestBand(proj, rowThr);
}

/**
 * 检测色控条并定位全部色块
 */
export function detectControlBar(
  image: RGBImage,
  backend: ImagingBackend,
  expectedPatches: PatchSpec[] = CONTROL_BAR,
): DetectionResult {
  const gray = backend.grayscale(image);
  const angle = estimateAngleFallback(backend, gray);

  const correctedRgb = Math.abs(angle) < 0.05 ? image : rotateRgb(image, angle);
  const correctedGray =
    Math.abs(angle) < 0.05 ? gray : backend.rotate(gray, angle);

  const [bandY0, bandY1] = findDarkBand(correctedGray);
  const bandH = bandY1 - bandY0;

  // 条带区域：自适应阈值找黑色定位标记
  const region: FloatImage = {
    width: correctedGray.width,
    height: bandH,
    data: correctedGray.data.subarray(
      bandY0 * correctedGray.width,
      bandY1 * correctedGray.width,
    ),
  };
  const regionSorted = Float32Array.from(region.data).filter(Number.isFinite).sort();
  const paper = regionSorted[Math.floor(regionSorted.length * 0.92)];
  const darkest = regionSorted[Math.floor(regionSorted.length * 0.02)];
  // 标记是近黑色，阈值取偏向暗端（暗值与纸白间距的 28%）
  const markerThr = darkest + (paper - darkest) * 0.28;
  const dark = backend.dark(region, markerThr);
  const colProj = columnProjection(dark);
  const colThreshold = bandH * 0.5;
  const bands = allBands(colProj, colThreshold).filter(([a, b]) => b - a >= 5);
  if (bands.length < 2) {
    throw new Error('未能识别色控条两端定位标记，请确认扫描图包含完整色控条');
  }
  const markerLeft = bands[0];
  const markerRight = bands[bands.length - 1];

  // 条带垂直中心：两黑色定位标记的 y 质心（标记与色块等高、垂直居中对齐），
  // 避免 band 下边界混入外部内容导致中心下移
  const markerY = (b: [number, number]): number => {
    let sy = 0;
    let n = 0;
    for (let y = 0; y < bandH; y++) {
      for (let x = b[0]; x < b[1]; x++) {
        if (dark.data[y * correctedGray.width + x]) {
          sy += y;
          n++;
        }
      }
    }
    return n > 0 ? sy / n : bandH / 2;
  };
  const cy = bandY0 + (markerY(markerLeft) + markerY(markerRight)) / 2;

  // 标记之间按等距网格切分
  const n = expectedPatches.length;
  const spanStart = markerLeft[1];
  const spanEnd = markerRight[0];
  const pitch = (spanEnd - spanStart) / n;
  // ROI 尺寸保守：宽取 pitch 45%、高取条带高 50%，
  // 确保即使有几像素定位误差也不越入相邻色块或条带外白纸
  const patchW = pitch * 0.45;
  const patchH = bandH * 0.5;

  const located: LocatedPatch[] = expectedPatches.map((spec, index) => ({
    spec,
    index,
    cx: spanStart + pitch * (index + 0.5),
    cy,
    w: patchW,
    h: patchH,
  }));

  return {
    corrected: correctedRgb,
    angleDeg: angle,
    band: [bandY0, bandY1],
    markerLeft: markerLeft[0],
    markerRight: markerRight[1],
    located,
  };
}

/**
 * 在名义中心附近的搜索窗内，以暗像素（相对纸白）质心做亚像素微调，
 * 让 ROI 贴合每个色块的真实中心。纸白色块直接用名义中心。
 */
function refineCenter(
  image: RGBImage,
  cx: number,
  cy: number,
  w: number,
  h: number,
): [number, number] {
  const winX = Math.round(w * 0.9);
  const winY = Math.round(h * 0.9);
  const x0 = Math.max(1, Math.round(cx - winX));
  const x1 = Math.min(image.width - 2, Math.round(cx + winX));
  const y0 = Math.max(1, Math.round(cy - winY));
  const y1 = Math.min(image.height - 2, Math.round(cy + winY));
  // 窗口内纸白估计（取最亮 10% 均值）
  const vals: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * image.width + x) * 3;
      vals.push(0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]);
    }
  }
  vals.sort((a, b) => a - b);
  const localDark = vals[Math.floor(vals.length * 0.2)];
  const localPaper = vals[Math.floor(vals.length * 0.9)];
  // 接近纸白的色块（纸白/浅网）不做微调
  if (localPaper - localDark < 25) return [cx, cy];
  const thr = localDark + (localPaper - localDark) * 0.55;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * image.width + x) * 3;
      const g = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
      if (g < thr) {
        const weight = (thr - g) / (thr - localDark + 1e-6);
        sx += x * weight;
        sy += y * weight;
        sw += weight;
      }
    }
  }
  if (sw < 20) return [cx, cy];
  const fx = sx / sw;
  const fy = sy / sw;
  // 限制微调幅度，避免异常漂移
  const clamp = (v: number, c: number, lim: number): number =>
    Math.max(c - lim, Math.min(c + lim, v));
  return [clamp(fx, cx, w * 0.35), clamp(fy, cy, h * 0.35)];
}

/** 在定位结果上做 ROI 平均取色（含逐块中心微调） */
export function samplePatches(
  image: RGBImage,
  located: LocatedPatch[],
): Array<{ spec: PatchSpec; rgb: [number, number, number] }> {
  return located.map((p) => {
    const [cx, cy] = refineCenter(image, p.cx, p.cy, p.w, p.h);
    return {
      spec: p.spec,
      rgb: roiMeanRgb(image, cx, cy, p.w, p.h),
    };
  });
}
