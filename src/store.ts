// 测量记录与机台数据(内存 + localStorage 持久化)

import type { Densities } from './color/colorscience';
import type { JudgeResult } from './color/iso12647';
import type { PatchSample } from './detect/geometry';

export interface Press {
  id: string;
  name: string;
  model: string;
  stock: string;
  job: string;
  status: '运行' | '待机' | '换单';
}

export const PRESSES: Press[] = [
  { id: 'p1', name: '1号机', model: '海德堡 CD102-4', stock: '157g 铜版纸', job: '画册《山海》封面', status: '运行' },
  { id: 'p2', name: '2号机', model: '小森 LS-440', stock: '128g 哑粉纸', job: '产品目录内页', status: '运行' },
  { id: 'p3', name: '3号机', model: '罗兰 R705', stock: '200g 铜版卡', job: '化妆品盒面纸', status: '换单' },
  { id: 'p4', name: '4号机', model: '海德堡 SM74-5', stock: '105g 铜版纸', job: '期刊插页', status: '待机' },
];

export interface Measurement {
  id: string;
  time: number;
  pressId: string;
  scenario: string;
  samples: PatchSample[];
  judge: JudgeResult;
  ms: number;
}

const KEY = 'scanpress-measurements-v1';
const MAX_KEEP = 300;

let cache: Measurement[] | null = null;

export function allMeasurements(): Measurement[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Measurement[];
  } catch {
    cache = [];
  }
  return cache;
}

export function addMeasurement(m: Measurement): void {
  const list = allMeasurements();
  list.push(m);
  while (list.length > MAX_KEEP) list.shift();
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储满则只留内存 */
  }
}

export function byPress(pressId: string): Measurement[] {
  return allMeasurements().filter((m) => m.pressId === pressId);
}

export function lastOf(pressId: string): Measurement | undefined {
  const list = byPress(pressId);
  return list[list.length - 1];
}

export function passRate(pressId: string, n = 20): number | null {
  const list = byPress(pressId).slice(-n);
  if (list.length === 0) return null;
  return list.filter((m) => m.judge.pass).length / list.length;
}

export function solidDensSeries(
  pressId: string,
  ink: keyof Densities,
  n = 50
): { t: number; v: number }[] {
  return byPress(pressId)
    .slice(-n)
    .map((m) => {
      const s = m.judge.solids.find((x) => x.ink === ink);
      return { t: m.time, v: s ? s.dens : NaN };
    })
    .filter((p) => !isNaN(p.v));
}
