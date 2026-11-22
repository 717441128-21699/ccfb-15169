/** 检测器共享内部工具：后端定义 + 倾斜角搜索 */
import {
  allBands,
  columnProjection,
  darkMask,
  downsample2x,
  longestBand,
  rotateGray,
  rowProjection,
  sobelMagnitude,
  toGrayscale,
} from './kernels-cpu.ts';
import type { GlBackend } from './gl-backend.ts';
import type { FloatImage, RGBImage } from '../core/types.ts';

export interface ImagingBackend {
  grayscale(img: RGBImage): FloatImage;
  sobel(gray: FloatImage): FloatImage;
  dark(gray: FloatImage, threshold: number): FloatImage;
  rotate(gray: FloatImage, angleDeg: number): FloatImage;
  downsample(gray: FloatImage): FloatImage;
}

export const cpuBackend: ImagingBackend = {
  grayscale: toGrayscale,
  sobel: sobelMagnitude,
  dark: darkMask,
  rotate: rotateGray,
  downsample: downsample2x,
};

export function gpuBackend(gl: GlBackend): ImagingBackend {
  return {
    grayscale: (img) => gl.grayscale(img),
    sobel: (gray) => gl.sobel(gray),
    dark: (gray, t) => gl.darkMask(gray, t),
    rotate: (gray, a) => gl.rotate(gray, a),
    downsample: (gray) => gl.downsample2x(gray),
  };
}

export { columnProjection, rowProjection };

/** 条带行区间定位：边缘行投影中最长的高能区段 */
export function locateEdgeBand(edges: FloatImage): [number, number] {
  const proj = rowProjection(edges);
  const sorted = Float32Array.from(proj).sort();
  const threshold = sorted[Math.floor(sorted.length * 0.72)];
  return longestBand(proj, threshold);
}

/**
 * 倾斜角估计（色控条：暗像素主轴法；网格色卡：行投影周期能量法）
 * @param gridMode 多行网格时启用周期评分，兼容近似方形的暗像素云
 */
export function estimateAngleFallback(
  backend: ImagingBackend,
  gray: FloatImage,
  gridMode = false,
): number {
  const small = backend.downsample(gray);

  // 网格模式先用暗像素行投影定位完整网格；
  // 色块行间有白色间隙，固定门限会让投影断裂，故先做形态学闭运算（max→min）桥接间隙
  let by0: number;
  let by1: number;
  if (gridMode) {
    const allSorted = Float32Array.from(small.data).filter(Number.isFinite).sort();
    const gPaper = allSorted[Math.floor(allSorted.length * 0.9)];
    const gDark = allSorted[Math.floor(allSorted.length * 0.02)];
    const gThr = gDark + (gPaper - gDark) * 0.45;
    const gDarkImg = new Float32Array(small.data.length);
    for (let i = 0; i < small.data.length; i++) {
      gDarkImg[i] = Number.isFinite(small.data[i]) && small.data[i] < gThr ? 1 : 0;
    }
    const gProj = rowProjection({ width: small.width, height: small.height, data: gDarkImg });
    const rowThr = small.width * 0.12;
    // 闭运算：先做宽度 closeGap 的膨胀（滑动最大），再同宽度腐蚀（滑动最小）
    const closeGap = Math.max(6, Math.round(small.height * 0.03));
    const dil = new Float32Array(gProj.length);
    for (let i = 0; i < gProj.length; i++) {
      let m = 0;
      for (let k = -closeGap; k <= closeGap; k++) {
        const j = i + k;
        if (j >= 0 && j < gProj.length && gProj[j] > m) m = gProj[j];
      }
      dil[i] = m;
    }
    const clo = new Float32Array(gProj.length);
    for (let i = 0; i < gProj.length; i++) {
      let m = Infinity;
      for (let k = -closeGap; k <= closeGap; k++) {
        const j = i + k;
        if (j >= 0 && j < gProj.length && dil[j] < m) m = dil[j];
      }
      clo[i] = m;
    }
    [by0, by1] = longestBand(clo, rowThr);
  } else {
    const edges0 = backend.sobel(small);
    [by0, by1] = locateEdgeBand(edges0);
  }
  const bandPad = Math.max(4, Math.round((by1 - by0) * 0.3));
  const ry0 = Math.max(0, by0 - bandPad);
  const ry1 = Math.min(small.height, by1 + bandPad);

  // 自适应暗阈值
  const vals: number[] = [];
  for (let y = ry0; y < ry1; y++) {
    for (let x = 0; x < small.width; x++) {
      const v = small.data[y * small.width + x];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  vals.sort((a, b) => a - b);
  const paper = vals[Math.floor(vals.length * 0.9)];
  const darkest = vals[Math.floor(vals.length * 0.02)];
  const darkThr = darkest + (paper - darkest) * 0.4;
  const markerThr = darkest + (paper - darkest) * 0.28;

  if (!gridMode) {
    // 色控条：暗像素云二阶矩主轴，亚像素精度
    let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;
    for (let y = ry0; y < ry1; y++) {
      const base = y * small.width;
      for (let x = 0; x < small.width; x++) {
        const v = small.data[base + x];
        if (Number.isFinite(v) && v < darkThr) {
          m00++; m10 += x; m01 += y; m20 += x * x; m02 += y * y; m11 += x * y;
        }
      }
    }
    if (m00 < 50) return 0;
    const cx = m10 / m00, cy = m01 / m00;
    const mu20 = m20 / m00 - cx * cx;
    const mu02 = m02 / m00 - cy * cy;
    const mu11 = m11 / m00 - cx * cy;
    let axis = (0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180) / Math.PI;
    if (axis > 45) axis -= 180;
    if (axis < -45) axis += 180;
    return Math.round(axis * 10) / 10;
  }

  // 网格色卡：全局角度扫描。
  // 摆正时网格左右两端的黑色定位标记在列投影上形成一对高而窄的对称峰，
  // 且两峰之外不再有同量级峰；用“最外两峰高度和 − 内部峰高度惩罚”作评分，
  // 对深色块粘连不敏感，因为粘连发生在倾斜时、会同时抬高内部峰而拉低评分。
  const markerScore = (angle: number): number => {
    const work = Math.abs(angle) < 0.05 ? small : backend.rotate(small, angle);
    const wDark = new Float32Array(work.data.length);
    for (let i = 0; i < work.data.length; i++) {
      wDark[i] = Number.isFinite(work.data[i]) && work.data[i] < darkThr ? 1 : 0;
    }
    const wProj = rowProjection({ width: work.width, height: work.height, data: wDark });
    const closeGap = Math.max(6, Math.round(work.height * 0.03));
    const dil = new Float32Array(wProj.length);
    for (let i = 0; i < wProj.length; i++) {
      let m = 0;
      for (let k = -closeGap; k <= closeGap; k++) {
        const j = i + k;
        if (j >= 0 && j < wProj.length && wProj[j] > m) m = wProj[j];
      }
      dil[i] = m;
    }
    const clo = new Float32Array(wProj.length);
    for (let i = 0; i < wProj.length; i++) {
      let m = Infinity;
      for (let k = -closeGap; k <= closeGap; k++) {
        const j = i + k;
        if (j >= 0 && j < wProj.length && dil[j] < m) m = dil[j];
      }
      clo[i] = m;
    }
    const [wy0, wy1] = longestBand(clo, work.width * 0.12);
    const wGridH = wy1 - wy0;
    const wRegion = new Float32Array(work.width * wGridH);
    for (let y = wy0; y < wy1; y++) {
      for (let x = 0; x < work.width; x++) {
        const v = work.data[y * work.width + x];
        if (Number.isFinite(v) && v < markerThr) {
          wRegion[(y - wy0) * work.width + x] = 1;
        }
      }
    }
    const wCol = columnProjection({ width: work.width, height: wGridH, data: wRegion });
    const wMax = Math.max(...wCol);
    if (wMax <= 0) return -Infinity;
    const wBands = allBands(wCol, wMax * 0.6).filter(([a, b]) => b - a >= 2);
    if (wBands.length < 2) return -Infinity;
    const lb = wBands[0];
    const rb = wBands[wBands.length - 1];
    const span = rb[0] - lb[1];
    if (span < work.width * 0.5) return -Infinity;
    // 摆正时标记独立成窄带、内部深色块不与标记粘连：
    // 评分 = 带数惩罚（越少越好）+ 两端带高度奖励 + 窄度奖励
    const bandHeight = (b: [number, number]): number => {
      let s = 0;
      for (let x = b[0]; x < b[1]; x++) s += wCol[x];
      return s;
    };
    const outer = bandHeight(lb) + bandHeight(rb);
    const narrow =
      2 / (1 + Math.abs(lb[1] - lb[0] - 7) + Math.abs(rb[1] - rb[0] - 7));
    return -wBands.length * wGridH * 2 + outer + narrow * wGridH;
  };

  let bestAngle = 0;
  let bestScore = -Infinity;
  const consider = (a: number) => {
    const s = markerScore(a);
    if (s > bestScore) {
      bestScore = s;
      bestAngle = a;
    }
  };
  for (let a = -5; a <= 5.001; a += 0.5) consider(a);
  const coarse = bestAngle;
  for (let a = coarse - 0.6; a <= coarse + 0.601; a += 0.1) {
    consider(Math.round(a * 10) / 10);
  }

  // 精修：用粗估角旋转到近似水平，标记列独立后做质心连线，求残余角
  const refined = refineByMarkerCentroid(small, backend, bestAngle, darkThr, markerThr);
  if (refined !== null && Math.abs(refined) <= 8) return Math.round(refined * 10) / 10;
  return bestAngle;
}

/** 在指定粗校正角下定位标记并质心测角，返回总校正角 */
function refineByMarkerCentroid(
  small: FloatImage,
  backend: ImagingBackend,
  coarseAngle: number,
  darkThr: number,
  markerThr: number,
): number | null {
  const work = Math.abs(coarseAngle) < 0.05 ? small : backend.rotate(small, coarseAngle);
  const wDark = new Float32Array(work.data.length);
  for (let i = 0; i < work.data.length; i++) {
    wDark[i] = Number.isFinite(work.data[i]) && work.data[i] < darkThr ? 1 : 0;
  }
  const wProj = rowProjection({ width: work.width, height: work.height, data: wDark });
  const closeGap = Math.max(6, Math.round(work.height * 0.03));
  const dil = new Float32Array(wProj.length);
  for (let i = 0; i < wProj.length; i++) {
    let m = 0;
    for (let k = -closeGap; k <= closeGap; k++) {
      const j = i + k;
      if (j >= 0 && j < wProj.length && wProj[j] > m) m = wProj[j];
    }
    dil[i] = m;
  }
  const clo = new Float32Array(wProj.length);
  for (let i = 0; i < wProj.length; i++) {
    let m = Infinity;
    for (let k = -closeGap; k <= closeGap; k++) {
      const j = i + k;
      if (j >= 0 && j < wProj.length && dil[j] < m) m = dil[j];
    }
    clo[i] = m;
  }
  const [wy0, wy1] = longestBand(clo, work.width * 0.12);
  const wGridH = wy1 - wy0;
  const wRegion = new Float32Array(work.width * wGridH);
  for (let y = wy0; y < wy1; y++) {
    for (let x = 0; x < work.width; x++) {
      const v = work.data[y * work.width + x];
      if (Number.isFinite(v) && v < markerThr) {
        wRegion[(y - wy0) * work.width + x] = 1;
      }
    }
  }
  const wCol = columnProjection({ width: work.width, height: wGridH, data: wRegion });
  const wMax = Math.max(...wCol);
  const wBands = allBands(wCol, wMax * 0.6).filter(([a, b]) => b - a >= 2);
  if (wBands.length < 2) return null;
  const lb = wBands[0];
  const rb = wBands[wBands.length - 1];
  if (rb[0] - lb[1] < work.width * 0.5) return null;
  // 标记贯穿网格全高，其每列最上暗像素即标记顶边；
  // 深色块只占局部行、顶边明显偏低，只取网格最上方 25% 区域的上沿点拟合直线，
  // 天然排除下方深色块污染。
  type Pt = { x: number; y: number };
  const upperEdgePoints = (band: [number, number]): Pt[] => {
    const pts: Pt[] = [];
    for (let x = band[0]; x < band[1]; x++) {
      for (let y = 0; y < wGridH; y++) {
        if (wRegion[y * work.width + x]) {
          if (y < wGridH * 0.45) pts.push({ x, y });
          break;
        }
      }
    }
    return pts;
  };
  const fitSlope = (pts: Pt[]): number | null => {
    if (pts.length < 4) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let sxx = 0, sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    return sxx < 1e-6 ? null : sxy / sxx;
  };
  const ptsL = upperEdgePoints(lb);
  const ptsR = upperEdgePoints(rb);
  const slopeL = fitSlope(ptsL);
  const slopeR = fitSlope(ptsR);
  if (slopeL === null || slopeR === null) return null;
  const residual = (Math.atan((slopeL + slopeR) / 2) * 180) / Math.PI;
  if (Math.abs(residual) > 3) return null;
  return coarseAngle + residual;
}

