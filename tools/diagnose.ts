// 诊断: 无噪声/有噪声下校准拟合残差定位(纯计算, 不依赖 canvas)
import { calibTargetPatches, fitCalibration, applyCalibration } from '../src/calib/calibration';
import { bandToScanner, makeRng, gauss, SCAN_NOISE } from '../src/sim/scanner';
import { patchReflectance, STRIP, ZERO_DEV } from '../src/sim/model';
import { bandToLab, deltaE00, densitiesFromBand } from '../src/color/colorscience';
import type { Vec3 } from '../src/color/colorscience';

function run(noise: boolean, label: string): void {
  const rng = makeRng(7);
  const patches = calibTargetPatches();
  const measured: Vec3[] = patches.map((p) => {
    const s = bandToScanner(p.truth);
    if (!noise) return s;
    return s.map((v) => Math.min(1, Math.max(0, v + (gauss(rng) * SCAN_NOISE) / 40))) as Vec3;
    // /40 模拟 1600 像素平均
  });
  const cal = fitCalibration(measured, patches);
  console.log(`\n=== ${label} ===`);
  console.log('校准复测:', cal.residual);

  // 残差最大的色卡块
  const errs = patches.map((p, i) => {
    const band = applyCalibration(cal, measured[i]);
    return { i, de: deltaE00(bandToLab(band), bandToLab(p.truth)), truth: p.truth };
  });
  errs.sort((a, b) => b.de - a.de);
  console.log('色卡最差 5 块:');
  for (const e of errs.slice(0, 5)) {
    console.log(`  #${e.i} truth=${e.truth.map((v) => v.toFixed(3))} ΔE=${e.de.toFixed(3)}`);
  }

  // 印张色块(基准)
  console.log('印张色块(基准场景):');
  for (const spec of STRIP) {
    const truth = patchReflectance(spec, ZERO_DEV);
    const enc = bandToScanner(truth);
    const band = applyCalibration(cal, enc);
    const de = deltaE00(bandToLab(band), bandToLab(truth));
    const td = densitiesFromBand(truth);
    const md = densitiesFromBand(band);
    const dd = Math.max(
      Math.abs(td.C - md.C),
      Math.abs(td.M - md.M),
      Math.abs(td.Y - md.Y),
      Math.abs(td.K - md.K)
    );
    console.log(`  ${spec.id.padEnd(6)} ΔE=${de.toFixed(3)} maxΔD=${dd.toFixed(4)}`);
  }
}

run(false, '无噪声');
run(true, '有噪声(平均后)');
