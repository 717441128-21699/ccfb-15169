// 诊断2: 完整链路模拟 —— 8bit 量化 + 暗角 + 噪声 + 平均, 复现浏览器端误差
import {
  calibTargetPatches,
  fitCalibration,
  applyCalibration,
  lutLookup,
} from '../src/calib/calibration';
import { bandToScanner, makeRng, gauss, SCAN_NOISE } from '../src/sim/scanner';
import { patchReflectance, STRIP, ZERO_DEV } from '../src/sim/model';
import { bandToLab, deltaE00, densitiesFromBand } from '../src/color/colorscience';
import type { Vec3 } from '../src/color/colorscience';

const rng = makeRng(42);

// 模拟 canvas: 值 -> 8bit -> (暗角+噪声+量化) -> 平均 N 像素
function simulatePatch(truth: Vec3, vig: number, nPix: number): Vec3 {
  const enc = bandToScanner(truth);
  const base = enc.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)); // css round
  const acc = [0, 0, 0];
  for (let i = 0; i < nPix; i++) {
    for (let ch = 0; ch < 3; ch++) {
      let v = base[ch] * vig + gauss(rng) * SCAN_NOISE * 255;
      v = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      acc[ch] += v / 255 / vig;
    }
  }
  return [acc[0] / nPix, acc[1] / nPix, acc[2] / nPix];
}

// 校准(色卡块带量化+噪声)
const patches = calibTargetPatches();
const measured = patches.map((p) => simulatePatch(p.truth, 0.98, 1681));
const cal = fitCalibration(measured, patches);
console.log('校准复测:', {
  maxDD: +cal.residual.maxDD.toFixed(4),
  maxDE: +cal.residual.maxDE.toFixed(3),
});

// LUT 与解析逆伽马的偏差(分通道)
const ana = (v: number) => Math.pow(v, 1 / 0.45);
for (let ch = 0; ch < 3; ch++) {
  let maxErr = 0;
  let at = 0;
  for (let v = 1; v < 256; v++) {
    const e = Math.abs(lutLookup(cal.lut[ch], v / 255) - ana(v / 255));
    if (e > maxErr) {
      maxErr = e;
      at = v / 255;
    }
  }
  console.log(`LUT ch${ch} vs 解析逆伽马: maxErr=${maxErr.toFixed(5)} @v=${at.toFixed(2)}`);
}

// 印张基准场景
console.log('\n印张色块(完整链路):');
for (const spec of STRIP) {
  const truth = patchReflectance(spec, ZERO_DEV);
  const enc = simulatePatch(truth, 0.965, 1089);
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
