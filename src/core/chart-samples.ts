/**
 * 色卡训练样本构建
 * 对合成色卡：光谱模型同时给出扫描 RGB、Lab 真值与 Status T 密度真值。
 * 真实色卡流程中，Lab/密度来自分光密度计对色卡的测量导入（此处保留接口）。
 */
import { detectChart, sampleChart } from '../imaging/detect-chart.ts';
import { cpuBackend, type ImagingBackend } from '../imaging/detect-internals.ts';
import { layoutChart, renderSyntheticSheet } from './synthesis.ts';
import { spectralToDensity, spectralToLab } from './spectral/color.ts';
import { PAPER_REFLECTANCE } from './spectral/data.ts';
import { synthesizeSpectrum } from './spectral/print.ts';
import type { ChartSample, InkBias, RGBImage } from './types.ts';

/** 生成合成标准色卡扫描图（零偏差，代表标准油墨/纸张状态） */
export function makeChartSheet(seed = 11): { image: RGBImage } {
  const layout = layoutChart(0.6);
  const image = renderSyntheticSheet(layout, { solidDelta: {}, tviDelta: {} }, seed, false);
  return { image };
}

/** 从色卡扫描图提取训练样本（真值由光谱模型提供） */
export function buildChartSamples(
  image: RGBImage,
  backend: ImagingBackend = cpuBackend,
): ChartSample[] {
  const { corrected, located } = detectChart(image, backend);
  const sampled = sampleChart(corrected, located);
  return sampled.map(({ spec, rgb }) => {
    const spectrum = synthesizeSpectrum(spec.coverage);
    return {
      rgb,
      lab: spectralToLab(spectrum),
      densities: spectralToDensity(spectrum, PAPER_REFLECTANCE),
      coverage: spec.coverage,
    };
  });
}

/** 直接按布局生成样本（跳过检测，用于快速验证回归精度上限） */
export function idealChartSamples(bias: InkBias = { solidDelta: {}, tviDelta: {} }): ChartSample[] {
  const layout = layoutChart(0);
  return layout.patches.map((p) => {
    const spectrum = synthesizeSpectrum(p.spec.coverage, bias);
    return {
      rgb: [128, 128, 128] as [number, number, number],
      lab: spectralToLab(spectrum),
      densities: spectralToDensity(spectrum, PAPER_REFLECTANCE),
      coverage: p.spec.coverage,
    };
  });
}
