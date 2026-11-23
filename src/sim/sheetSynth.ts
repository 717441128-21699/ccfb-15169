// 印张扫描图合成:按机台偏差用物理模型生成"扫描仪看到"的印张图像。
// 布局常量同时供检测几何使用。

import type { Vec3 } from '../color/colorscience';
import { STRIP, patchReflectance, type PressDeviation } from './model';
import { bandToScanner, makeRng, gauss, SCAN_NOISE } from './scanner';

export const SHEET_W = 1654;
export const SHEET_H = 2339;
export const PATCH_SIZE = 56;
export const PATCH_GAP = 10;
export const MARK_SIZE = 56;
export const STRIP_CY = 2150; // 色控条中心 y
export const MARK_L_CX = 88;
export const MARK_R_CX = 1600;
export const PATCH_CX0 = 200; // 第一个色块中心 x
export const PATCH_DX = PATCH_SIZE + PATCH_GAP; // 66

/** 色块中心 x(未旋转布局坐标) */
export function patchLayoutCx(i: number): number {
  return PATCH_CX0 + i * PATCH_DX;
}

export interface SheetImage {
  image: ImageData;
  angleDeg: number;
}

function css(v: Vec3): string {
  const c = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  return `rgb(${c(v[0])},${c(v[1])},${c(v[2])})`;
}

/** 暗噪声+暗角(编码域乘性暗角, 检测端按模型校正) */
export function vignette(x: number, y: number, w: number, h: number): number {
  const nx = (x - w / 2) / (w / 2);
  const ny = (y - h / 2) / (h / 2);
  return 1 - 0.05 * (nx * nx + ny * ny) * 0.5;
}

/** 合成一张印张扫描图 */
export function renderSheet(dev: PressDeviation, seed: number, angleDeg?: number): SheetImage {
  const rng = makeRng(seed);
  const angle = angleDeg ?? (rng() - 0.5) * 0.8; // ±0.4°

  const c1 = document.createElement('canvas');
  c1.width = SHEET_W;
  c1.height = SHEET_H;
  const g1 = c1.getContext('2d')!;

  // 纸底
  const paperBand = patchReflectance({ id: '', label: '', kind: 'paper', inks: {} }, dev);
  g1.fillStyle = css(bandToScanner(paperBand));
  g1.fillRect(0, 0, SHEET_W, SHEET_H);

  // 图文区(模拟画面, 不进入底部 20% 检测区)
  for (let k = 0; k < 9; k++) {
    const band: Vec3 = [0.15 + rng() * 0.7, 0.15 + rng() * 0.7, 0.15 + rng() * 0.7];
    g1.fillStyle = css(bandToScanner(band));
    const x = 100 + rng() * 1200;
    const y = 180 + rng() * 1400;
    g1.fillRect(x, y, 120 + rng() * 300, 90 + rng() * 260);
  }
  // 渐变图(底边保持在底部 20% 检测区之上)
  const grad = g1.createLinearGradient(100, 1680, 1450, 1830);
  grad.addColorStop(0, css(bandToScanner([0.7, 0.5, 0.3])));
  grad.addColorStop(1, css(bandToScanner([0.2, 0.35, 0.6])));
  g1.fillStyle = grad;
  g1.fillRect(100, 1680, 1350, 150);

  // 定位标记(纯黑, 仅用于几何定位, 8bit 即可)
  const black = css(bandToScanner([0.004, 0.004, 0.004]));
  g1.fillStyle = black;
  g1.fillRect(MARK_L_CX - MARK_SIZE / 2, STRIP_CY - MARK_SIZE / 2, MARK_SIZE, MARK_SIZE);
  g1.fillRect(MARK_R_CX - MARK_SIZE / 2, STRIP_CY - MARK_SIZE / 2, MARK_SIZE, MARK_SIZE);

  // 旋转到输出画布
  const c2 = document.createElement('canvas');
  c2.width = SHEET_W;
  c2.height = SHEET_H;
  const g2 = c2.getContext('2d')!;
  g2.fillStyle = css(bandToScanner(paperBand));
  g2.fillRect(0, 0, SHEET_W, SHEET_H);
  g2.translate(SHEET_W / 2, SHEET_H / 2);
  g2.rotate((angle * Math.PI) / 180);
  g2.drawImage(c1, -SHEET_W / 2, -SHEET_H / 2);

  // 暗角 + 噪声 + 量化(纸底与图文)
  const img = g2.getImageData(0, 0, SHEET_W, SHEET_H);
  const d = img.data;
  for (let y = 0; y < SHEET_H; y++) {
    for (let x = 0; x < SHEET_W; x++) {
      const vig = vignette(x, y, SHEET_W, SHEET_H);
      const o = (y * SHEET_W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let v = d[o + ch] * vig + gauss(rng) * SCAN_NOISE * 255;
        d[o + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      d[o + 3] = 255;
    }
  }

  // 色控条色块: 在 ImageData 阶段以浮点颜色直接写入。
  // 避免 canvas 8bit 中间量化造成整块的系统性偏移(量化只在最终扫描输出发生一次,
  // 且噪声在前使其随机化, 区域平均后消除)。
  const theta = (angle * Math.PI) / 180;
  const axis = { x: Math.cos(theta), y: Math.sin(theta) };
  for (let i = 0; i < STRIP.length; i++) {
    const band = patchReflectance(STRIP[i], dev);
    const enc = bandToScanner(band); // 浮点 0..1
    // 布局坐标 -> 旋转后坐标(与 canvas 变换一致: p' = c + R(θ)(p-c))
    const lx = patchLayoutCx(i) - SHEET_W / 2;
    const ly = STRIP_CY - SHEET_H / 2;
    const cx = SHEET_W / 2 + axis.x * lx - axis.y * ly;
    const cy = SHEET_H / 2 + axis.y * lx + axis.x * ly;
    const half = PATCH_SIZE / 2;
    for (let dy = -half; dy < half; dy++) {
      for (let dx = -half; dx < half; dx++) {
        const px = Math.round(cx + axis.x * dx - axis.y * dy);
        const py = Math.round(cy + axis.y * dx + axis.x * dy);
        if (px < 0 || py < 0 || px >= SHEET_W || py >= SHEET_H) continue;
        const vig = vignette(px, py, SHEET_W, SHEET_H);
        const o = (py * SHEET_W + px) * 4;
        for (let ch = 0; ch < 3; ch++) {
          let v = enc[ch] * 255 * vig + gauss(rng) * SCAN_NOISE * 255;
          d[o + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
        d[o + 3] = 255;
      }
    }
  }
  return { image: img, angleDeg: angle };
}
