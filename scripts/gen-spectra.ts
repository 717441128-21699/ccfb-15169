import { spectralToDensity, spectralToLab } from '../src/core/spectral/color.ts';
import { PAPER_REFLECTANCE, WAVELENGTHS } from '../src/core/spectral/data.ts';
import type { InkName } from '../src/core/types.ts';

const CH = { C: 'dR', M: 'dG', Y: 'dB', K: 'dV' } as const;
// 中等实地密度：在 8-bit 扫描下仍有良好暗部阶调，同时具工艺区分度
const D_TARGET = { C: 1.15, M: 1.1, Y: 1.0, K: 1.45 };
const PARAMS: Record<InkName, { center: number; width: number }> = {
  C: { center: 645, width: 150 },
  M: { center: 545, width: 135 },
  Y: { center: 455, width: 120 },
  K: { center: 550, width: 320 },
};

function build(ink: InkName, center: number, width: number, floor: number): number[] {
  return WAVELENGTHS.map((w, i) => {
    const paper = PAPER_REFLECTANCE[i];
    const absorb = Math.exp(-0.5 * ((w - center) / width) ** 2);
    return Math.max(floor, paper * (1 - absorb) + floor * absorb);
  });
}

const out: Partial<Record<InkName, number[]>> = {};
for (const ink of ['C', 'M', 'Y', 'K'] as InkName[]) {
  let best = { err: Infinity, spec: [] as number[], floor: 0 };
  for (let floor = 0.004; floor < 0.12; floor += 0.002) {
    const spec = build(ink, PARAMS[ink].center, PARAMS[ink].width, floor);
    const d = spectralToDensity(spec, PAPER_REFLECTANCE)[CH[ink]];
    const err = Math.abs(d - D_TARGET[ink]);
    if (err < best.err) best = { err, spec, floor };
  }
  out[ink] = best.spec;
  const d = spectralToDensity(best.spec, PAPER_REFLECTANCE);
  const lab = spectralToLab(best.spec);
  console.log(ink, 'D', d[CH[ink]].toFixed(3), 'dR/G/B', d.dR.toFixed(2), d.dG.toFixed(2), d.dB.toFixed(2),
    'Lab', lab.L.toFixed(1), lab.a.toFixed(1), lab.b.toFixed(1), 'floor', best.floor.toFixed(3));
}
console.log('\nGENERATED:');
for (const ink of ['C', 'M', 'Y', 'K'] as InkName[]) {
  console.log(`// ${ink}`);
  console.log(JSON.stringify(out[ink]!.map((v) => Math.round(v * 1000) / 1000)) + ',');
}
