// 应用上下文: 校准状态 + 采样器(GPU 优先, CPU 兜底)

import {
  calibTargetPatches,
  fitCalibration,
  loadCalibration,
  saveCalibration,
  clearCalibration,
  renderCalibTarget,
  type Calibration,
} from './calib/calibration';
import type { Sampler, StripGeometry } from './detect/geometry';
import { CpuSampler } from './detect/cpuSampler';
import { GpuSampler } from './gpu/gpuSampler';

export interface AppContext {
  readonly sampler: Sampler;
  readonly gpuOk: boolean;
  getCal(): Calibration;
  /** 扫描标准色卡并重新拟合特性化 */
  recalibrate(): Calibration;
  /** 恢复默认(重新自动校准) */
  resetCalibration(): Calibration;
}

/** 恒等校准(仅用于启动兜底, measureRaw 不依赖校准) */
function identityCal(): Calibration {
  const ramp = () => {
    const a = new Float32Array(256);
    for (let i = 0; i < 256; i++) a[i] = i / 255;
    return a;
  };
  return {
    lut: [ramp(), ramp(), ramp()],
    matrix: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    offset: Float32Array.from([0, 0, 0]),
    createdAt: '',
    residual: { maxDD: 0, meanDD: 0, maxDE: 0, meanDE: 0 },
  };
}

/** 色卡色块的几何(轴对齐, 无需检测) */
function calibGeometry(): StripGeometry {
  const patches = calibTargetPatches();
  return {
    centers: patches.map((p) => ({ x: p.cx, y: p.cy })),
    axis: { x: 1, y: 0 },
    nrm: { x: 0, y: 1 },
    angleDeg: 0,
    markL: { x: 0, y: 0 },
    markR: { x: 0, y: 0 },
    stripY0: 0,
    stripY1: 0,
  };
}

export function createApp(): AppContext {
  // 启动: 有保存的校准直接用; 否则自动扫描内置标准色卡拟合一次
  let cal = loadCalibration();
  let sampler: Sampler;
  let gpuOk = true;

  const boot = identityCal();
  try {
    sampler = new GpuSampler(cal ?? boot);
  } catch (e) {
    console.warn('WebGL2 不可用, 使用 CPU 采样器', e);
    sampler = new CpuSampler(cal ?? boot);
    gpuOk = false;
  }

  const doCalibrate = (): Calibration => {
    const img = renderCalibTarget();
    sampler.setImage(img);
    const raw = sampler.measureRaw(calibGeometry(), 20);
    const fitted = fitCalibration(raw, calibTargetPatches());
    saveCalibration(fitted);
    sampler.setCalibration(fitted);
    cal = fitted;
    return fitted;
  };

  if (!cal) {
    cal = doCalibrate();
  } else {
    sampler.setCalibration(cal);
  }

  return {
    sampler,
    gpuOk,
    getCal: () => cal!,
    recalibrate: doCalibrate,
    resetCalibration: () => {
      clearCalibration();
      return doCalibrate();
    },
  };
}
