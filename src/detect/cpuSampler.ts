// CPU 采样器: 与 GPU 路径完全相同的算法, 用于无 WebGL2 环境兜底与交叉校验。

import { applyCalibration, type Calibration } from '../calib/calibration';
import { bandToLab, densitiesFromBand } from '../color/colorscience';
import type { PatchSample, Sampler, StripGeometry } from './geometry';
import { vignette } from '../sim/sheetSynth';

export class CpuSampler implements Sampler {
  readonly kind = 'cpu' as const;
  private img: ImageData | null = null;

  constructor(private cal: Calibration) {}

  setCalibration(cal: Calibration): void {
    this.cal = cal;
  }

  setImage(img: ImageData): void {
    this.img = img;
  }

  rowProfile(x0: number, x1: number): Float32Array {
    const img = this.must();
    const out = new Float32Array(img.height);
    const d = img.data;
    for (let y = 0; y < img.height; y++) {
      let acc = 0;
      let cnt = 0;
      for (let x = Math.floor(x0); x < Math.ceil(x1); x += 2) {
        const o = (y * img.width + x) * 4;
        acc += 1 - (d[o] + d[o + 1] + d[o + 2]) / 765;
        cnt++;
      }
      out[y] = acc / Math.max(cnt, 1);
    }
    return out;
  }

  colProfile(y0: number, y1: number): Float32Array {
    const img = this.must();
    const out = new Float32Array(img.width);
    const d = img.data;
    for (let x = 0; x < img.width; x++) {
      let acc = 0;
      let cnt = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y += 2) {
        const o = (y * img.width + x) * 4;
        acc += 1 - (d[o] + d[o + 1] + d[o + 2]) / 765;
        cnt++;
      }
      out[x] = acc / Math.max(cnt, 1);
    }
    return out;
  }

  measure(geom: StripGeometry, half: number): PatchSample[] {
    const img = this.must();
    const d = img.data;
    return geom.centers.map((c) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let cnt = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const px = Math.floor(c.x + geom.axis.x * dx + geom.nrm.x * dy);
          const py = Math.floor(c.y + geom.axis.y * dx + geom.nrm.y * dy);
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          const vig = vignette(px, py, img.width, img.height);
          const o = (py * img.width + px) * 4;
          const band = applyCalibration(this.cal, [
            d[o] / 255 / vig,
            d[o + 1] / 255 / vig,
            d[o + 2] / 255 / vig,
          ]);
          r += band[0];
          g += band[1];
          b += band[2];
          cnt++;
        }
      }
      const band: [number, number, number] = [r / cnt, g / cnt, b / cnt];
      return { lab: bandToLab(band), dens: densitiesFromBand(band) };
    });
  }

  measureRaw(geom: StripGeometry, half: number): [number, number, number][] {
    const img = this.must();
    const d = img.data;
    return geom.centers.map((c) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let cnt = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const px = Math.floor(c.x + geom.axis.x * dx + geom.nrm.x * dy);
          const py = Math.floor(c.y + geom.axis.y * dx + geom.nrm.y * dy);
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          const vig = vignette(px, py, img.width, img.height);
          const o = (py * img.width + px) * 4;
          r += d[o] / 255 / vig;
          g += d[o + 1] / 255 / vig;
          b += d[o + 2] / 255 / vig;
          cnt++;
        }
      }
      return [r / cnt, g / cnt, b / cnt];
    });
  }

  private must(): ImageData {
    if (!this.img) throw new Error('未设置图像');
    return this.img;
  }
}
