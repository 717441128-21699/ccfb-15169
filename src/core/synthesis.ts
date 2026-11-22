/**
 * 合成测试印张/色卡扫描图
 * - 光谱模型逐色块呈色 → 扫描仪 RGB
 * - 整体小角度旋转、定位黑块、纸纹与文字干扰、逐像素噪声
 */
import { makeRng, spectralToScannerRgb } from './spectral/scanner.ts';
import { synthesizeSpectrum } from './spectral/print.ts';
import { PAPER_REFLECTANCE } from './spectral/data.ts';
import { BAR_GEOMETRY, CHART_GEOMETRY, CONTROL_BAR, buildChartLayout } from './layout.ts';
import type { InkBias, PatchSpec, RGBImage } from './types.ts';

export interface SheetLayout {
  width: number;
  height: number;
  /** 色块中心在“未旋转”坐标系中的位置 */
  patches: Array<{ spec: PatchSpec; x0: number; y0: number; w: number; h: number }>;
  /** 定位标记（未旋转坐标） */
  markers: Array<{ x0: number; y0: number; w: number; h: number }>;
  angleDeg: number;
  barTop: number;
  barLeft: number;
}

/** 计算色控条在画布上的布局（未旋转） */
export function layoutControlBar(canvasW: number, canvasH: number, angleDeg = 1.2): SheetLayout {
  const g = BAR_GEOMETRY;
  const n = CONTROL_BAR.length;
  const barW = g.margin * 2 + g.markerW * 2 + n * g.patchW + (n - 1) * g.gap;
  const barH = g.margin * 2 + g.patchH;
  const barLeft = Math.round((canvasW - barW) / 2);
  const barTop = Math.round(canvasH * 0.62);
  const patches: SheetLayout['patches'] = [];
  let x = barLeft + g.margin + g.markerW;
  const y0 = barTop + g.margin;
  for (const spec of CONTROL_BAR) {
    patches.push({ spec, x0: x, y0, w: g.patchW, h: g.patchH });
    x += g.patchW + g.gap;
  }
  const markers = [
    { x0: barLeft + g.margin, y0, w: g.markerW, h: g.patchH },
    { x0: x + g.gap, y0, w: g.markerW, h: g.patchH },
  ];
  return { width: canvasW, height: canvasH, patches, markers, angleDeg, barTop, barLeft };
}

/** 色卡网格布局（未旋转） */
export function layoutChart(angleDeg = 0.6): SheetLayout {
  const g = CHART_GEOMETRY;
  const all = buildChartLayout();
  const rows = Math.ceil(all.length / g.cols);
  const barW = g.margin * 2 + g.markerW * 2 + g.cols * g.patchW + (g.cols - 1) * g.gap;
  const barH = g.margin * 2 + rows * g.patchH + (rows - 1) * g.gap;
  const canvasW = barW + 80;
  const canvasH = barH + 120;
  const barLeft = Math.round((canvasW - barW) / 2);
  const barTop = Math.round((canvasH - barH) / 2);
  const patches: SheetLayout['patches'] = [];
  for (let i = 0; i < all.length; i++) {
    const r = Math.floor(i / g.cols);
    const c = i % g.cols;
    patches.push({
      spec: all[i],
      x0: barLeft + g.margin + g.markerW + c * (g.patchW + g.gap),
      y0: barTop + g.margin + r * (g.patchH + g.gap),
      w: g.patchW,
      h: g.patchH,
    });
  }
  const markers = [
    { x0: barLeft + g.margin, y0: barTop + g.margin, w: g.markerW, h: g.patchH },
    {
      x0: barLeft + g.margin + g.markerW + g.cols * g.patchW + (g.cols - 1) * g.gap + g.gap,
      y0: barTop + g.margin,
      w: g.markerW,
      h: g.patchH,
    },
  ];
  return { width: canvasW, height: canvasH, patches, markers, angleDeg, barTop, barLeft };
}

/**
 * 渲染合成扫描图
 * @param layout 布局
 * @param bias 墨量偏差
 * @param seed 随机种子
 * @param distractors 是否绘制文字/图像干扰
 */
export function renderSyntheticSheet(
  layout: SheetLayout,
  bias: InkBias = { solidDelta: {}, tviDelta: {} },
  seed = 42,
  distractors = true,
): RGBImage {
  const { width, height, angleDeg } = layout;
  const rng = makeRng(seed);
  const data = new Uint8ClampedArray(width * height * 3);
  // 纸白底色
  const paperRgb = spectralToScannerRgb(PAPER_REFLECTANCE, { rng, noise: false });
  const cos = Math.cos((-angleDeg * Math.PI) / 180);
  const sin = Math.sin((-angleDeg * Math.PI) / 180);
  const cx = width / 2;
  const cy = height / 2;

  // 预渲染“未旋转”画布
  const flat = new Uint8ClampedArray(width * height * 3);
  flat.fill(0);
  const fillBase = (rgb: [number, number, number]) => {
    for (let i = 0; i < flat.length; i += 3) {
      flat[i] = rgb[0];
      flat[i + 1] = rgb[1];
      flat[i + 2] = rgb[2];
    }
  };
  fillBase(paperRgb);

  const fillRect = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    rgb: [number, number, number],
  ) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = (y * width + x) * 3;
        flat[idx] = rgb[0];
        flat[idx + 1] = rgb[1];
        flat[idx + 2] = rgb[2];
      }
    }
  };

  // 干扰：伪文字条与浅灰图块（模拟印张上的正文/图像内容）
  if (distractors) {
    for (let i = 0; i < 40; i++) {
      const rx = Math.floor(rng() * (width - 120));
      const ry = Math.floor(rng() * (layout.barTop - 60));
      const rw = 30 + Math.floor(rng() * 160);
      const rh = 3 + Math.floor(rng() * 6);
      const shade = 150 + Math.floor(rng() * 60);
      fillRect(rx, ry, rw, rh, [shade, shade, shade]);
    }
    for (let i = 0; i < 6; i++) {
      const rx = Math.floor(rng() * (width - 200));
      const ry = Math.floor(rng() * (layout.barTop - 100));
      fillRect(rx, ry, 120, 70, [200 + Math.floor(rng() * 30), 200, 205]);
    }
  }

  // 色块
  for (const p of layout.patches) {
    const spectrum = synthesizeSpectrum(p.spec.coverage, bias);
    const rgb = spectralToScannerRgb(spectrum, { rng, noise: false });
    fillRect(p.x0, p.y0, p.w, p.h, rgb);
  }
  // 黑色定位标记
  for (const m of layout.markers) {
    fillRect(m.x0, m.y0, m.w, m.h, [12, 12, 12]);
  }

  // 旋转 + 逐像素噪声 + 轻微纸纹
  const paperVar = () => (rng() - 0.5) * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cos * dx - sin * dy + cx);
      const sy = Math.round(sin * dx + cos * dy + cy);
      const oidx = (y * width + x) * 3;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
        data[oidx] = paperRgb[0];
        data[oidx + 1] = paperRgb[1];
        data[oidx + 2] = paperRgb[2];
        continue;
      }
      const sidx = (sy * width + sx) * 3;
      const n1 = (rng() + rng() + rng() - 1.5) * 2.2;
      const n2 = (rng() + rng() + rng() - 1.5) * 2.2;
      const n3 = (rng() + rng() + rng() - 1.5) * 2.2;
      const pv = paperVar();
      data[oidx] = clamp8(flat[sidx] + n1 + pv);
      data[oidx + 1] = clamp8(flat[sidx + 1] + n2 + pv);
      data[oidx + 2] = clamp8(flat[sidx + 2] + n3 + pv);
    }
  }
  return { width, height, data };
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 合成一张标准检测印张（机台页面/验证脚本共用） */
export function makeInspectionSheet(
  bias: InkBias,
  seed = 42,
  canvasW = 1400,
  canvasH = 900,
  angleDeg = 1.2,
): { image: RGBImage; layout: SheetLayout } {
  const layout = layoutControlBar(canvasW, canvasH, angleDeg);
  const image = renderSyntheticSheet(layout, bias, seed, true);
  return { image, layout };
}
