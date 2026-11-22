/**
 * 多项式岭回归：扫描仪 RGB → Lab / 密度
 * 2 次项 10 基、3 次项 20 基；输入先标准化，SVD 求解正规方程。
 */

export type Degree = 2 | 3 | 4;

/** 构造多项式基（输入为标准化后的 r,g,b ∈ 约[-2,2]） */
export function polynomialBasis(r: number, g: number, b: number, degree: Degree): number[] {
  const terms: number[] = [1, r, g, b];
  const r2 = r * r, g2 = g * g, b2 = b * b;
  const rg = r * g, rb = r * b, gb = g * b;
  // 二阶（10 项）
  terms.push(rg, rb, gb, r2, g2, b2);
  if (degree === 2) return terms;
  const r3 = r2 * r, g3 = g2 * g, b3 = b2 * b;
  // 三阶（+10 项，共 20）
  terms.push(r3, g3, b3, r2 * g, r2 * b, g2 * r, g2 * b, b2 * r, b2 * g, rg * b);
  if (degree === 3) return terms;
  // 四阶（+15 项，共 35）：所有次数和为 4 的单项式
  const r4 = r2 * r2, g4 = g2 * g2, b4 = b2 * b2;
  terms.push(
    r4, g4, b4,
    r3 * g, r3 * b, g3 * r, g3 * b, b3 * r, b3 * g,
    r2 * g2, r2 * b2, g2 * b2,
    r2 * gb, g2 * rb, b2 * rg,
  );
  return terms;
}

export function basisSize(degree: Degree): number {
  return degree === 2 ? 10 : degree === 3 ? 20 : 35;
}

/** 均值/标准差 */
export function stats3(samples: Array<[number, number, number]>): {
  mean: [number, number, number];
  std: [number, number, number];
} {
  const n = samples.length;
  const sum: [number, number, number] = [0, 0, 0];
  for (const s of samples) for (let i = 0; i < 3; i++) sum[i] += s[i];
  const mean = sum.map((v) => v / n) as [number, number, number];
  const vari: [number, number, number] = [0, 0, 0];
  for (const s of samples) for (let i = 0; i < 3; i++) vari[i] += (s[i] - mean[i]) ** 2;
  const std = vari.map((v) => Math.sqrt(v / n) || 1) as [number, number, number];
  return { mean, std };
}

export function standardize(
  rgb: [number, number, number],
  mean: [number, number, number],
  std: [number, number, number],
): [number, number, number] {
  return [
    (rgb[0] - mean[0]) / std[0],
    (rgb[1] - mean[1]) / std[1],
    (rgb[2] - mean[2]) / std[2],
  ];
}

/** 对称矩阵的 Jacobi 特征分解（A = Q Λ Qᵀ），返回 { values, vectors } */
function jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const Q: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  const m = a.map((row) => [...row]);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let qq = p + 1; qq < n; qq++) off += m[p][qq] * m[p][qq];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let qq = p + 1; qq < n; qq++) {
        if (Math.abs(m[p][qq]) < 1e-14) continue;
        const theta = (0.5 * Math.atan2(2 * m[p][qq], m[qq][qq] - m[p][p]));
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][qq];
          m[k][p] = c * mkp - s * mkq;
          m[k][qq] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[qq][k];
          m[p][k] = c * mpk - s * mqk;
          m[qq][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const qkp = Q[k][p];
          const qkq = Q[k][qq];
          Q[k][p] = c * qkp - s * qkq;
          Q[k][qq] = s * qkp + c * qkq;
        }
      }
    }
  }
  const values = m.map((row, i) => row[i]);
  return { values, vectors: Q };
}

/**
 * 岭回归拟合 Y = X·B
 * @param x 设计矩阵（每行一个基向量）
 * @param y 目标矩阵（每行多输出）
 * @param lambda 岭参数
 */
export function ridgeFit(
  x: number[][],
  y: number[][],
  lambda: number,
): number[][] {
  const n = x.length;
  const p = x[0].length;
  const outCnt = y[0].length;
  // A = XᵀX / n
  const a = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < p; r++) {
      const xr = x[i][r];
      for (let c = 0; c < p; c++) a[r][c] += xr * x[i][c];
    }
  }
  for (let r = 0; r < p; r++) a[r][r] += lambda * n;
  // 特征分解 A = Q diag(λ) Qᵀ
  const { values, vectors } = jacobiEigen(a);
  // XᵀY
  const xty = Array.from({ length: p }, () => new Array<number>(outCnt).fill(0));
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < p; r++) {
      const xr = x[i][r];
      for (let c = 0; c < outCnt; c++) xty[r][c] += xr * y[i][c];
    }
  }
  // B = Q diag(1/(λ)) Qᵀ (XᵀY)
  const qtxty = Array.from({ length: p }, () => new Array<number>(outCnt).fill(0));
  for (let r = 0; r < p; r++) {
    for (let c = 0; c < outCnt; c++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += vectors[k][r] * xty[k][c];
      qtxty[r][c] = s / values[r];
    }
  }
  const beta = Array.from({ length: p }, () => new Array<number>(outCnt).fill(0));
  for (let r = 0; r < p; r++) {
    for (let c = 0; c < outCnt; c++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += vectors[r][k] * qtxty[k][c];
      beta[r][c] = s;
    }
  }
  return beta;
}

export function predict(beta: number[][], basis: number[]): number[] {
  const out = new Array<number>(beta[0].length).fill(0);
  for (let r = 0; r < beta.length; r++) {
    const xr = basis[r];
    for (let c = 0; c < out.length; c++) out[c] += xr * beta[r][c];
  }
  return out;
}

/** RMSE */
export function rmse(values: number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
}
