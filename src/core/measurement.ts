/**
 * 检测编排与印刷指标计算
 * 流程：检测定位 → ROI 取色 → profile 预测 Lab/密度
 *      → 实地密度、Murray-Davies TVI、Preucil 叠印率、灰平衡
 *      → ISO 12647-2 判定 → 调墨建议
 */
import { detectControlBar, samplePatches, type ImagingBackend } from '../imaging/detect.ts';
import { getIsoTarget, type IsoTarget } from './iso.ts';
import { predictDensities, predictLab } from './profile.ts';
import { deltaE2000 } from './spectral/color.ts';
import { synthesizeSpectrum } from './spectral/print.ts';
import { spectralToDensity, spectralToLab } from './spectral/color.ts';
import { PAPER_REFLECTANCE } from './spectral/data.ts';
import type {
  Densities,
  InkAdvice,
  InkName,
  InspectionRecord,
  Lab,
  PatchMeasurement,
  PatchSpec,
  Press,
  RGBImage,
  ScannerProfile,
  SolidSummary,
} from './types.ts';

const INK_DENSITY_CHANNEL: Record<InkName, keyof Densities> = {
  C: 'dR',
  M: 'dG',
  Y: 'dB',
  K: 'dV',
};
const TINT_NOMINAL = [25, 50, 75] as const;

/** 参考值：由零偏差光谱模型生成（生产环境可替换为企业内控参考印张） */
export function referenceLab(spec: PatchSpec): Lab {
  return spectralToLab(synthesizeSpectrum(spec.coverage));
}

export function referenceDensities(spec: PatchSpec): Densities {
  return spectralToDensity(
    synthesizeSpectrum(spec.coverage),
    PAPER_REFLECTANCE,
  );
}

/** Murray-Davies 网点面积（百分比），a = (1-10^-Dt)/(1-10^-Ds) × 100 */
function murrayDavies(tintD: number, solidD: number): number {
  if (solidD <= 0.05) return 0;
  const at = 1 - 10 ** -tintD;
  const as = 1 - 10 ** -solidD;
  return (at / as) * 100;
}

/** Preucil 叠印率（%）：IT = (D_ov − D_2nd) / D_1st × 100，密度经纸白归零 */
function preucilTrap(dOver: number, dSecond: number, dFirst: number): number {
  if (dFirst <= 0.05) return 100;
  return ((dOver - dSecond) / dFirst) * 100;
}

export interface InspectionOptions {
  engine: 'webgl2' | 'cpu';
  scenario?: string;
}

export interface InspectionOutput {
  record: InspectionRecord;
  traps: Array<{ label: string; value: number; pass: boolean }>;
  advices: InkAdvice[];
}

export function runInspection(
  image: RGBImage,
  press: Press,
  profile: ScannerProfile,
  backend: ImagingBackend,
  opts: InspectionOptions,
): InspectionOutput {
  const t0 = performance.now();
  const target = getIsoTarget(press.paperType);

  const detection = detectControlBar(image, backend);
  const samples = samplePatches(detection.corrected, detection.located);

  const byId = new Map<string, PatchMeasurement>();
  const patches: PatchMeasurement[] = samples.map(({ spec, rgb }) => {
    const lab = predictLab(profile, rgb);
    const densities = predictDensities(profile, rgb);
    const refLab = referenceLab(spec);
    const deltaE = deltaE2000(lab, refLab);
    const m: PatchMeasurement = {
      patch: spec,
      rgb,
      lab,
      refLab,
      deltaE,
      densities,
    };
    byId.set(spec.id, m);
    return m;
  });

  // 实地汇总与 TVI
  const solidSummary = buildSolidSummary(byId, target);

  // 叠印率
  const traps = buildTraps(byId, target);

  // 灰平衡
  const grayPatches = patches.filter((p) => p.patch.kind === 'gray');
  let grayWorst: InspectionRecord['grayWorst'];
  for (const p of grayPatches) {
    if (!grayWorst || p.deltaE > grayWorst.deltaE) {
      grayWorst = { label: p.patch.label, deltaE: p.deltaE, lab: p.lab, ref: p.refLab };
    }
  }

  const advices = buildAdvices(solidSummary, grayWorst, target);
  const overallPass =
    solidSummary.every((s) => s.passDensity && s.passDeltaE && s.passTvi) &&
    traps.every((t) => t.pass) &&
    (grayWorst?.deltaE ?? 0) <= target.grayDeltaELimit;

  const durationMs = performance.now() - t0;
  const record: InspectionRecord = {
    id: `insp-${Date.now()}`,
    pressId: press.id,
    timestamp: Date.now(),
    overallPass,
    patches,
    solidSummary,
    grayWorst,
    durationMs,
    engine: opts.engine,
    scenario: opts.scenario,
  };
  return { record, traps, advices };
}

function buildSolidSummary(
  byId: Map<string, PatchMeasurement>,
  target: IsoTarget,
): SolidSummary[] {
  const out: SolidSummary[] = [];
  for (const ink of ['C', 'M', 'Y', 'K'] as InkName[]) {
    const solid = byId.get(`${ink}-solid`);
    if (!solid) continue;
    const ch = INK_DENSITY_CHANNEL[ink];
    const density = solid.densities[ch];
    const densityAim = target.solidDensityAim[ink];
    const tint50 = byId.get(`${ink}50`);
    let tvi50 = 0;
    if (tint50) {
      const area = murrayDavies(tint50.densities[ch], density);
      tvi50 = area - 50;
    }
    // ΔE 对照零偏差光谱模型的实测参考 Lab（solid.refLab），
    // 而非 ISO 教材目标值——后者与具体油墨/纸张光谱不完全一致
    const refLab = solid.refLab;
    const de = deltaE2000(solid.lab, refLab);
    out.push({
      ink,
      density,
      densityAim,
      lab: solid.lab,
      refLab,
      deltaE: de,
      tvi50,
      tviAim50: target.tviAim[ink][50],
      passDensity: Math.abs(density - densityAim) <= target.densityTolerance,
      passDeltaE: de <= target.solidDeltaELimit,
      passTvi: Math.abs(tvi50 - target.tviAim[ink][50]) <= target.tviTolerance,
    });
  }
  return out;
}

function buildTraps(
  byId: Map<string, PatchMeasurement>,
  target: IsoTarget,
): Array<{ label: string; value: number; pass: boolean }> {
  const c = byId.get('C-solid')?.densities;
  const m = byId.get('M-solid')?.densities;
  const y = byId.get('Y-solid')?.densities;
  const cm = byId.get('CM')?.densities;
  const my = byId.get('MY')?.densities;
  const cy = byId.get('CY')?.densities;
  if (!c || !m || !y || !cm || !my || !cy) return [];
  // 蓝（C+M）：先 C 后 M；红（M+Y）：先 M 后 Y；绿（C+Y）：先 Y 后 C（Preucil 约定）
  return [
    {
      label: '蓝 C+M',
      value: preucilTrap(cm.dB, m.dB, c.dB),
      pass: false,
    },
    {
      label: '红 M+Y',
      value: preucilTrap(my.dR, y.dR, m.dR),
      pass: false,
    },
    {
      label: '绿 C+Y',
      value: preucilTrap(cy.dG, c.dG, y.dG),
      pass: false,
    },
  ].map((t) => ({ ...t, pass: t.value >= target.trapMin }));
}

/** 调墨建议：密度偏差→墨键方向；TVI 偏差→水量/压力提示；灰平衡→色偏校正 */
function buildAdvices(
  summary: SolidSummary[],
  grayWorst: InspectionRecord['grayWorst'],
  target: IsoTarget,
): InkAdvice[] {
  const advices: InkAdvice[] = [];
  for (const s of summary) {
    const dErr = s.density - s.densityAim;
    const tviErr = s.tvi50 - s.tviAim50;
    const messages: string[] = [];
    let severity: InkAdvice['severity'] = 'ok';
    let keyAdjust = 0;

    if (!s.passDensity) {
      keyAdjust = Math.max(-30, Math.min(30, Math.round(-dErr * 120)));
      if (dErr > 0) {
        messages.push(`实地密度偏高 ${dErr.toFixed(2)}D，建议墨键收 ${Math.abs(keyAdjust)}% 减薄墨膜`);
      } else {
        messages.push(`实地密度偏低 ${Math.abs(dErr).toFixed(2)}D，建议墨键开 ${Math.abs(keyAdjust)}% 增加供墨`);
      }
      severity = Math.abs(dErr) > target.densityTolerance * 1.5 ? 'fail' : 'warn';
    }
    if (!s.passTvi) {
      if (tviErr > 0) {
        messages.push(`网点扩大偏高 +${tviErr.toFixed(1)}%：检查润版液水量与橡皮布压力，适当降墨/降水`);
      } else {
        messages.push(`网点扩大偏低 ${tviErr.toFixed(1)}%：油墨转移不足，检查墨辊压力或适当加墨`);
      }
      severity = severity === 'fail' ? 'fail' : 'warn';
    }
    if (!s.passDeltaE) {
      messages.push(`实地色差 ΔE=${s.deltaE.toFixed(1)} 超 ${target.solidDeltaELimit}，结合密度方向调整墨量并复核色相`);
      severity = 'fail';
    }
    if (messages.length === 0) {
      messages.push('实地密度、TVI 与色差均在控');
    }
    advices.push({ ink: s.ink, severity, message: messages.join('；'), keyAdjust });
  }

  // 灰平衡色偏建议（独立标识，避免覆盖同墨的实地密度/TVI 建议）
  if (grayWorst && grayWorst.deltaE > target.grayDeltaELimit) {
    const { a, b } = grayWorst.lab;
    const ref = grayWorst.ref;
    const da = a - ref.a;
    const db = b - ref.b;
    const dirs: string[] = [];
    if (db > 1.5) dirs.push('偏黄：Y 墨键下调 3–5% 或 C 墨略增');
    if (db < -1.5) dirs.push('偏蓝：Y 墨键上调 3–5%');
    if (da > 1.5) dirs.push('偏红：M 墨键下调 3–5% 或 C 墨略增');
    if (da < -1.5) dirs.push('偏绿：M 墨键上调 3–5%');
    if (dirs.length) {
      advices.push({
        ink: 'GRAY' as InkName,
        severity: grayWorst.deltaE > target.grayDeltaELimit * 1.5 ? 'fail' : 'warn',
        message: `${grayWorst.label} 灰平衡 ΔE=${grayWorst.deltaE.toFixed(1)}：${dirs.join('；')}`,
        keyAdjust: 0,
      });
    }
  }
  return advices;
}

/** 计算全部色块的 TVI（供结果表展示） */
export function patchTvi(m: PatchMeasurement, solidDensity: number): number | undefined {
  if (m.patch.kind !== 'tint') return undefined;
  const ink = dominantInk(m.patch);
  if (!ink) return undefined;
  const ch = INK_DENSITY_CHANNEL[ink];
  const area = murrayDavies(m.densities[ch], solidDensity);
  const nominal = m.patch.coverage[ink] * 100;
  return area - nominal;
}

export function dominantInk(spec: PatchSpec): InkName | undefined {
  let best: InkName | undefined;
  let bestV = 0;
  for (const ink of ['C', 'M', 'Y', 'K'] as InkName[]) {
    if (spec.coverage[ink] > bestV) {
      bestV = spec.coverage[ink];
      best = ink;
    }
  }
  return best;
}

export { TINT_NOMINAL };
