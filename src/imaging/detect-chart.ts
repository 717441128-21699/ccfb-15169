/**
 * 标准色卡网格检测（扫描仪特性化页使用）
 * 全分辨率处理，避免降采样坐标换算问题：
 * 1) 暗像素行的总范围确定网格上下边界（网格外为白纸）
 * 2) 网格带内近黑列投影找两端定位标记，标记质心连线测倾斜角
 * 3) 旋转校正后重新定位，按已知行列数做等距网格划分，
 *    边缘行投影峰值微调每行中心
 */
import {
  allBands,
  columnProjection,
  roiMeanRgb,
  rotateRgb,
  rowProjection,
} from './kernels-cpu.ts';
import { CHART_GEOMETRY, buildChartLayout } from '../core/layout.ts';
import {
  cpuBackend,
  type ImagingBackend,
} from './detect-internals.ts';
import type { FloatImage, LocatedPatch, RGBImage } from '../core/types.ts';

export interface ChartDetectionResult {
  corrected: RGBImage;
  angleDeg: number;
  located: LocatedPatch[];
}

function percentiles(data: Float32Array, pLo: number, pHi: number): [number, number] {
  const sorted = Float32Array.from(data).filter(Number.isFinite).sort();
  return [
    sorted[Math.floor(sorted.length * pLo)],
    sorted[Math.floor(sorted.length * pHi)],
  ];
}

/** 暗像素行的首末范围（低门限，避免浅色块行被截断） */
function darkRowRange(gray: FloatImage, thr: number): [number, number] {
  const dark = new Float32Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) dark[i] = gray.data[i] < thr ? 1 : 0;
  const proj = rowProjection({ width: gray.width, height: gray.height, data: dark });
  // 用投影峰值的小比例作门限，自适应不同画布尺寸与色块密度
  const peak = Math.max(...proj);
  const rowThr = peak * 0.06;
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < proj.length; y++) {
    if (proj[y] > rowThr) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  if (y0 < 0) throw new Error('未检测到色卡网格内容');
  return [y0, y1 + 1];
}

/** 在指定行带内找近黑竖直标记带；markerH 为标记预期高度（首行色块高） */
function findMarkerBands(
  gray: FloatImage,
  y0: number,
  y1: number,
  markerThr: number,
  markerH?: number,
): Array<[number, number]> {
  // 标记核心灰度约 9-13、边缘过渡到 ~30；黑墨实地中位约 39。
  const useThr = 32;
  const fullH = y1 - y0;
  // 只在标记所在的首行窗口内统计列投影；窗口取标记高（色块高），
  // 过宽会把同行其他深色块并入，导致整行连成一条暗带
  const winH = markerH ? Math.min(fullH, Math.round(markerH)) : fullH;
  const region = new Float32Array(gray.width * winH);
  for (let y = y0; y < y0 + winH; y++) {
    for (let x = 0; x < gray.width; x++) {
      const v = gray.data[y * gray.width + x];
      if (Number.isFinite(v) && v < useThr) {
        region[(y - y0) * gray.width + x] = 1;
      }
    }
  }
  const colProj = columnProjection({ width: gray.width, height: winH, data: region });
  const cmax = Math.max(...colProj);
  // 标记在窗口内占比高：保留暗像素数达最高列 60% 的列
  const coreCols = colProj.map((v): number => (v >= cmax * 0.6 ? 1 : 0));
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= gray.width; x++) {
    const on = x < gray.width && coreCols[x];
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= 5) bands.push([start, x]);
      start = -1;
    }
  }
  return bands;
}

/**
 * 两标记质心连线测倾角。
 * 标记已通过“近黑 + 贯穿全高”干净分离，质心稳定；
 * 连线斜率即网格整体倾斜角。
 */
function markerAngle(
  gray: FloatImage,
  y0: number,
  y1: number,
  bands: Array<[number, number]>,
  markerThr: number,
  markerH: number,
): number {
  const useThr = 32;
  const winY1 = Math.min(y1, y0 + Math.round(markerH * 1.4));
  const centroid = (band: [number, number]) => {
    let n = 0, sx = 0, sy = 0;
    for (let y = y0; y < winY1; y++) {
      for (let x = band[0]; x < band[1]; x++) {
        if (gray.data[y * gray.width + x] < useThr) {
          n++;
          sx += x;
          sy += y - y0;
        }
      }
    }
    return { x: sx / n, y: sy / n, n };
  };
  const l = centroid(bands[0]);
  const r = centroid(bands[bands.length - 1]);
  if (l.n < 40 || r.n < 40) return 0;
  return (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI;
}

export function detectChart(
  image: RGBImage,
  backend: ImagingBackend = cpuBackend,
): ChartDetectionResult {
  const specs = buildChartLayout();
  const expectedRows = Math.ceil(specs.length / CHART_GEOMETRY.cols);
  const cols = CHART_GEOMETRY.cols;

  // 第一次：未校正图上粗定位网格与标记，测倾角
  const gray0 = backend.grayscale(image);
  const [darkest, paper] = percentiles(gray0.data, 0.02, 0.9);
  const contentThr = darkest + (paper - darkest) * 0.45;
  // 标记为近黑竖带；实际阈值在 findMarkerBands 内按区域暗分位自适应
  const markerThr = 90;
  const [ry0, ry1] = darkRowRange(gray0, contentThr);
  const estMarkerH = (ry1 - ry0) / expectedRows;
  const allBands0 = findMarkerBands(gray0, ry0, ry1, markerThr, estMarkerH);
  const bands0 = allBands0.length >= 2
    ? [allBands0[0], allBands0[allBands0.length - 1]]
    : allBands0;
  let angle = 0;
  if (bands0.length >= 2) {
    const a = markerAngle(gray0, ry0, ry1, bands0, markerThr, estMarkerH);
    if (Number.isFinite(a) && Math.abs(a) <= 8) angle = Math.round(a * 10) / 10;
  }

  // 旋转校正后重新精定位
  const correctedRgb = Math.abs(angle) < 0.05 ? image : rotateRgb(image, angle);
  const gray =
    Math.abs(angle) < 0.05 ? gray0 : backend.rotate(gray0, angle);
  const [bandY0, bandY1] = darkRowRange(gray, contentThr);
  const markerH = (bandY1 - bandY0) / expectedRows;
  const allMarkerBands = findMarkerBands(gray, bandY0, bandY1, markerThr, markerH);
  if (allMarkerBands.length < 2) throw new Error('色卡定位标记识别失败');
  // 几何先验：真标记在网格最外侧，取最左/最右两带；
  // 中间带为黑墨实地等深色块，不参与
  const bands = [allMarkerBands[0], allMarkerBands[allMarkerBands.length - 1]];

  // 标记带含边缘过渡像素会偏宽，直接用带中心 + 标准标记宽（14px）重建内沿，
  // 消除网格起点的系统性横向偏移
  const leftMarker = bands[0];
  const rightMarker = bands[bands.length - 1];
  if (rightMarker[0] - leftMarker[1] < gray.width * 0.4) {
    throw new Error('色卡标记间距异常');
  }
  const STD_MARKER_W = 14;
  const lCenter = (leftMarker[0] + leftMarker[1]) / 2;
  const rCenter = (rightMarker[0] + rightMarker[1]) / 2;
  const gridLeft = lCenter + STD_MARKER_W / 2;
  const gridRight = rCenter - STD_MARKER_W / 2;
  const gridW = gridRight - gridLeft;
  const pitchX = gridW / cols;

  // 标记位于首行网格内，其 y 中心即首行中心。
  // 只在首行窗口（约 1.4 个标记高）内统计，避免下方黑墨色块污染质心
  const firstRowWinY1 = Math.min(bandY1, bandY0 + Math.round(markerH * 1.4));
  const firstRowMarkerCenters = bands.map((b) => {
    let sy = 0;
    let n = 0;
    for (let y = bandY0; y < firstRowWinY1; y++) {
      for (let x = b[0]; x < b[1]; x++) {
        if (gray.data[y * gray.width + x] < 32) {
          sy += y;
          n++;
        }
      }
    }
    if (n < 30) return bandY0 + markerH / 2;
    return sy / n;
  });
  // 标记与首行色块等高、垂直居中对齐，故标记中心即首行色块中心
  const firstRowCenter =
    firstRowMarkerCenters.reduce((s, v) => s + v, 0) / firstRowMarkerCenters.length;
  // 垂直行距：色卡色块为正方形、行列等距（layout 几何保证），直接采用列距，
  // 避免依赖受浅色块截断影响的 band 上下边界
  const pitchY = pitchX;

  const located: LocatedPatch[] = [];
  let idx = 0;
  for (let r = 0; r < expectedRows; r++) {
    // 等距几何：标记给出准确的首行中心，行距由网格高度推算
    const cy = firstRowCenter + r * pitchY;
    for (let c = 0; c < cols && idx < specs.length; c++) {
      located.push({
        spec: specs[idx],
        index: idx,
        cx: gridLeft + pitchX * (c + 0.5),
        cy,
        w: pitchX * 0.82,
        h: pitchY * 0.72,
      });
      idx++;
    }
  }

  return { corrected: correctedRgb, angleDeg: angle, located };
}

export function sampleChart(
  image: RGBImage,
  located: LocatedPatch[],
): Array<{ spec: LocatedPatch['spec']; rgb: [number, number, number] }> {
  // 色卡色块大（40px），用 50% 内缩取中心区域，最大化降噪且不邻接边缘
  return located.map((p) => ({
    spec: p.spec,
    rgb: roiMeanRgb(image, p.cx, p.cy, p.w, p.h, 0.5),
  }));
}
