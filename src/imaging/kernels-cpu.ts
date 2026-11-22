/**
 * 图像处理 CPU 后端 —— 与 WebGL2 内核算法完全一致
 * Node 验证脚本与浏览器 GPU 自检都使用本模块，保证两端数值一致。
 */
import type { FloatImage, RGBImage } from '../core/types.ts';

export function toGrayscale(img: RGBImage): FloatImage {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 3, j++) {
    // ITU-R BT.601
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { width, height, data: out };
}

/** Sobel 边缘能量（梯度幅值） */
export function sobelMagnitude(gray: FloatImage): FloatImage {
  const { width, height, data } = gray;
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = data[i - width - 1],
        t = data[i - width],
        tr = data[i - width + 1];
      const l = data[i - 1],
        r = data[i + 1];
      const bl = data[i + width - 1],
        b = data[i + width],
        br = data[i + width + 1];
      const gx = -tl + tr - 2 * l + 2 * r - bl + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return { width, height, data: out };
}

/** 二值暗像素掩膜（阈值以下为 1） */
export function darkMask(gray: FloatImage, threshold: number): FloatImage {
  const out = new Float32Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) out[i] = gray.data[i] < threshold ? 1 : 0;
  return { width: gray.width, height: gray.height, data: out };
}

/** 行投影：每行像素和 */
export function rowProjection(img: FloatImage): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const v = data[base + x];
      if (Number.isFinite(v)) s += v;
    }
    out[y] = s;
  }
  return out;
}

/** 列投影：每列像素和 */
export function columnProjection(img: FloatImage): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y < height; y++) {
      const v = data[y * width + x];
      if (Number.isFinite(v)) s += v;
    }
    out[x] = s;
  }
  return out;
}

/** 均值降采样（2×2 块平均），用于加速角度搜索 */
export function downsample2x(gray: FloatImage): FloatImage {
  const w = Math.floor(gray.width / 2);
  const h = Math.floor(gray.height / 2);
  const out = new Float32Array(w * h);
  const W = gray.width;
  const H = gray.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x * 2;
      const sy = y * 2;
      let s = 0;
      let cnt = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = sx + dx;
          const py = sy + dy;
          if (px < W && py < H) {
            s += gray.data[py * W + px];
            cnt++;
          }
        }
      }
      out[y * w + x] = s / cnt;
    }
  }
  return { width: w, height: h, data: out };
}

/** 绕中心旋转灰度图（角度，度；正值逆时针），输出同尺寸，空白填 255 */
export function rotateGray(gray: FloatImage, angleDeg: number): FloatImage {
  const { width, height, data } = gray;
  const out = new Float32Array(width * height).fill(255);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cos * dx + sin * dy + cx);
      const sy = Math.round(-sin * dx + cos * dy + cy);
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
        out[y * width + x] = data[sy * width + sx];
      }
    }
  }
  return { width, height, data: out };
}

/** 绕中心旋转 RGB 图 */
export function rotateRgb(img: RGBImage, angleDeg: number): RGBImage {
  const { width, height, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cos * dx + sin * dy + cx);
      const sy = Math.round(-sin * dx + cos * dy + cy);
      const o = (y * width + x) * 3;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
        const s = (sy * width + sx) * 3;
        out[o] = data[s];
        out[o + 1] = data[s + 1];
        out[o + 2] = data[s + 2];
      } else {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
      }
    }
  }
  return { width, height, data: out };
}

/** ROI 内 RGB 平均（内缩比例 inset，避免边缘） */
export function roiMeanRgb(
  img: RGBImage,
  cx: number,
  cy: number,
  w: number,
  h: number,
  inset = 0.35,
): [number, number, number] {
  const x0 = Math.max(0, Math.round(cx - (w * (1 - inset)) / 2));
  const x1 = Math.min(img.width - 1, Math.round(cx + (w * (1 - inset)) / 2));
  const y0 = Math.max(0, Math.round(cy - (h * (1 - inset)) / 2));
  const y1 = Math.min(img.height - 1, Math.round(cy + (h * (1 - inset)) / 2));
  let r = 0,
    g = 0,
    b = 0,
    cnt = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 3;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      cnt++;
    }
  }
  return [r / cnt, g / cnt, b / cnt];
}

/** 求一维数组中最长的、值超过 threshold 的连续区段 */
export function longestBand(values: Float32Array, threshold: number): [number, number] {
  let best: [number, number] = [0, 0];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

/** 一维投影中所有超阈值区段（用于列方向切分色块） */
export function allBands(values: Float32Array, threshold: number): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      bands.push([start, i]);
      start = -1;
    }
  }
  return bands;
}
