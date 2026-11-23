// 调参脚本:求解纸张三波段反射率与 C/M/Y/K 三波段密度,
// 使合成印张实地 Lab 命中 ISO 12647-2 (涂布纸, D50) 目标值。
// 运行: node tools/tune.mjs

// 波段反射率 -> XYZ(D50): 类 Status T 滤色波段的自定义矩阵
// (红波段对 X 权重大, 使青墨红波段密度 ~1.4, 接近 Status T 实测水平)
const A = [
  [0.62, 0.24, 0.10],
  [0.25, 0.67, 0.08],
  [0.005, 0.02, 0.75],
];
const WP = [0.9642, 1.0, 0.8251]; // D50

function xyzToLab(xyz) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xyz[0] / WP[0]), fy = f(xyz[1] / WP[1]), fz = f(xyz[2] / WP[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function bandToLab(rgb) {
  const xyz = [
    A[0][0] * rgb[0] + A[0][1] * rgb[1] + A[0][2] * rgb[2],
    A[1][0] * rgb[0] + A[1][1] * rgb[1] + A[1][2] * rgb[2],
    A[2][0] * rgb[0] + A[2][1] * rgb[1] + A[2][2] * rgb[2],
  ];
  return xyzToLab(xyz);
}

// x = [pr,pg,pb, cR,cG,cB, mR,mG,mB, yR,yG,yB, kR,kG,kB]
// 纸张为反射率,油墨为三波段密度; 实地反射率 R = paper * 10^(-D)
function residuals(x) {
  const paper = [x[0], x[1], x[2]];
  const inks = [
    [x[3], x[4], x[5]],
    [x[6], x[7], x[8]],
    [x[9], x[10], x[11]],
    [x[12], x[13], x[14]],
  ];
  const targets = [
    [95.0, 0.0, -2.0], // 纸张
    [55.0, -37.0, -50.0], // C
    [48.0, 74.0, -3.0], // M
    [89.0, -5.0, 93.0], // Y
    [16.0, 0.0, 0.0], // K
  ];
  const out = [];
  const labP = bandToLab(paper);
  for (let k = 0; k < 3; k++) out.push(labP[k] - targets[0][k]);
  for (let i = 0; i < 4; i++) {
    const rgb = paper.map((p, b) => p * Math.pow(10, -inks[i][b]));
    const lab = bandToLab(rgb);
    for (let k = 0; k < 3; k++) out.push(lab[k] - targets[i + 1][k]);
  }
  return out;
}

let x = [0.88, 0.9, 0.9, 1.35, 0.4, 0.25, 0.2, 1.35, 0.7, 0.08, 0.2, 1.05, 1.5, 1.5, 1.5];
const lo = x.map((_, i) => (i < 3 ? 0.6 : 0.01));
const hi = x.map((_, i) => (i < 3 ? 0.97 : 3.2));

for (let iter = 0; iter < 200; iter++) {
  const r = residuals(x);
  const err = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  if (err < 1e-9) break;
  const n = x.length, m = r.length;
  const J = [];
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    const x2 = x.slice(); x2[j] += h;
    const r2 = residuals(x2);
    J.push(r2.map((v, i) => (v - r[i]) / h));
  }
  // 解正规方程 (J^T J) d = -J^T r
  const JTJ = Array.from({ length: n }, () => new Array(n).fill(0));
  const JTr = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[i][k] * J[j][k];
      JTJ[i][j] = s;
    }
    let s = 0;
    for (let k = 0; k < m; k++) s += J[i][k] * r[k];
    JTr[i] = s;
  }
  // 高斯消元
  const M = JTJ.map((row, i) => [...row, -JTr[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let rr = c + 1; rr < n; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[p][c])) p = rr;
    [M[c], M[p]] = [M[p], M[c]];
    for (let rr = 0; rr < n; rr++) {
      if (rr === c) continue;
      const f = M[rr][c] / M[c][c];
      for (let cc = c; cc <= n; cc++) M[rr][cc] -= f * M[c][cc];
    }
  }
  const d = M.map((row, i) => row[n] / row[i]);
  for (let i = 0; i < n; i++) x[i] = Math.min(hi[i], Math.max(lo[i], x[i] + d[i]));
}

const r = residuals(x);
console.log('残差 RMS:', Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length).toFixed(5));
const names = ['paper', 'C', 'M', 'Y', 'K'];
for (let i = 0; i < 5; i++) {
  console.log(names[i], 'Lab 残差:', r.slice(i * 3, i * 3 + 3).map((v) => v.toFixed(3)).join(', '));
}
console.log('\n=== 常数 ===');
console.log('PAPER_RGB =', JSON.stringify(x.slice(0, 3).map((v) => +v.toFixed(4))));
console.log('INK_D = {');
console.log('  C:', JSON.stringify(x.slice(3, 6).map((v) => +v.toFixed(4))) + ',');
console.log('  M:', JSON.stringify(x.slice(6, 9).map((v) => +v.toFixed(4))) + ',');
console.log('  Y:', JSON.stringify(x.slice(9, 12).map((v) => +v.toFixed(4))) + ',');
console.log('  K:', JSON.stringify(x.slice(12, 15).map((v) => +v.toFixed(4))) + ',');
console.log('}');
