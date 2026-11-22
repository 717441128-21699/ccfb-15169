/** 全局类型定义 */

/** 8-bit RGB 图像（行优先，每像素 3 通道） */
export interface RGBImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 浮点像素值（用于 ROI 平均等） */
export interface FloatImage {
  width: number;
  height: number;
  data: Float32Array;
}

export type InkName = 'C' | 'M' | 'Y' | 'K';
export type InkSet = InkName[];

/** CIE Lab（D50，2°） */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** CIE XYZ（D50 归一化） */
export interface XYZ {
  X: number;
  Y: number;
  Z: number;
}

/** 三色（RGB 或 CMY 通道）密度，Status T */
export interface Densities {
  dR: number; // 红通道 → 青墨密度
  dG: number; // 绿通道 → 品红墨密度
  dB: number; // 蓝通道 → 黄墨密度
  /** 视觉密度（取三通道最大值，黑墨用） */
  dV: number;
}

/** 墨量偏差场景（合成测试印张用） */
export interface InkBias {
  /** 实地浓度倍率偏移，0 表示标准，+0.10 表示墨膜增厚约 +0.1D */
  solidDelta: Partial<Record<InkName, number>>;
  /** 网点扩大偏移（百分点），正值表示扩大加剧 */
  tviDelta: Partial<Record<InkName, number>>;
}

/** 色控条色块定义 */
export interface PatchSpec {
  id: string;
  label: string;
  /** Demichel 叠印描述：各墨名义网点覆盖率 0..1 */
  coverage: Record<InkName, number>;
  kind: 'paper' | 'solid' | 'tint' | 'overprint' | 'gray';
}

/** 几何定位后的色块（像素坐标） */
export interface LocatedPatch {
  spec: PatchSpec;
  index: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 单个色块的测量结果 */
export interface PatchMeasurement {
  patch: PatchSpec;
  rgb: [number, number, number];
  lab: Lab;
  refLab: Lab;
  deltaE: number;
  densities: Densities;
  /** 该色块主墨的网点扩大（%），仅 tint 块有意义 */
  tvi?: number;
}

/** 单台机台配置 */
export interface Press {
  id: string;
  name: string;
  /** 纸张类型，影响 ISO 目标 */
  paperType: 'PT1_PT2_coated' | 'PT4_uncoated';
  /** 色控条规格标识 */
  controlBar: string;
  createdAt: number;
}

/** 一次完整检测记录 */
export interface InspectionRecord {
  id: string;
  pressId: string;
  timestamp: number;
  overallPass: boolean;
  patches: PatchMeasurement[];
  /** 四色实地指标汇总 */
  solidSummary: SolidSummary[];
  /** 灰平衡最差色块 */
  grayWorst?: { label: string; deltaE: number; lab: Lab; ref: Lab };
  durationMs: number;
  engine: 'webgl2' | 'cpu';
  /** 合成场景标签（真实扫描为空） */
  scenario?: string;
}

export interface SolidSummary {
  ink: InkName;
  density: number;
  densityAim: number;
  lab: Lab;
  refLab: Lab;
  deltaE: number;
  tvi50: number;
  tviAim50: number;
  passDensity: boolean;
  passDeltaE: boolean;
  passTvi: boolean;
}

/** 调墨建议 */
export interface InkAdvice {
  ink: InkName;
  severity: 'ok' | 'warn' | 'fail';
  message: string;
  /** 建议墨键调整量，-100..100（百分比方向，正值加墨） */
  keyAdjust: number;
}

/** 扫描仪特性化 profile（多项式回归系数） */
export interface ScannerProfile {
  id: string;
  name: string;
  createdAt: number;
  polynomialDegree: 2 | 3 | 4;
  /** 每一项 Lab 通道的系数（含截距），行主序 [L][coef] */
  coefLab: number[][];
  /** 四色密度系数 [C,M,Y,K][coef] */
  coefDensity: number[][];
  basisSize: number;
  /** 校验集残差 */
  fitResidualLab: number;
  fitResidualDensity: number;
  /** 训练时 RGB 各通道的均值/标准差（标准化用） */
  rgbMean: [number, number, number];
  rgbStd: [number, number, number];
  /** 白纸参考 RGB */
  paperRgb: [number, number, number];
}

/** 色卡上一个色块的采样（训练数据） */
export interface ChartSample {
  rgb: [number, number, number];
  lab: Lab;
  densities: Densities;
  coverage: Record<InkName, number>;
}
