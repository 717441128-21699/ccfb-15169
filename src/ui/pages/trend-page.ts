/** 趋势页：历史检测记录、密度/TVI/ΔE 控制图、合格率统计 */
import { h, clear, fmt, tag } from '../dom.ts';
import { store } from '../../core/store.ts';
import { getIsoTarget } from '../../core/iso.ts';
import type { InkName, InspectionRecord } from '../../core/types.ts';

const INKS: InkName[] = ['C', 'M', 'Y', 'K'];

export function renderTrendPage(root: HTMLElement): void {
  clear(root);
  const history = store.getHistory();
  if (history.length === 0) {
    root.append(h('div', { class: 'card' },
      h('h2', {}, '趋势分析'),
      h('p', { class: 'muted' }, '暂无检测记录，请到检测页执行印张检测。'),
    ));
    return;
  }

  const passCount = history.filter((r) => r.overallPass).length;
  const stats = h('div', { class: 'card' },
    h('h2', {}, '质量统计'),
    h('div', { class: 'grid-4' },
      metric('检测总张数', String(history.length)),
      metric('合格张数', String(passCount)),
      metric('合格率', `${fmt((passCount / history.length) * 100, 1)}%`),
      metric('平均耗时', `${fmt(history.reduce((s, r) => s + r.durationMs, 0) / history.length, 0)} ms`),
    ),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', {
        class: 'btn danger',
        onclick: () => {
          store.clearHistory();
          renderTrendPage(root);
        },
      }, '清空历史'),
    ),
  );

  const charts = h('div', { class: 'card' },
    h('h2', {}, '实地密度控制图'),
    h('canvas', { class: 'chart', id: 'chart-density' }),
    h('h2', {}, '实地色差 ΔE00 控制图'),
    h('canvas', { class: 'chart', id: 'chart-de' }),
    h('h2', {}, '50% 网点扩大 TVI 控制图'),
    h('canvas', { class: 'chart', id: 'chart-tvi' }),
  );

  const table = h('div', { class: 'card' },
    h('h2', {}, '历史记录'),
    h('div', { class: 'scroll-x' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '时间'), h('th', {}, '场景/来源'), h('th', {}, '结论'),
          h('th', { class: 'num' }, '耗时'), h('th', { class: 'num' }, '最差 ΔE'),
          h('th', { class: 'num' }, '灰平衡 ΔE'), h('th', {}, '引擎'),
        )),
        h('tbody', {}, ...history.map((r) => h('tr', {},
          h('td', {}, new Date(r.timestamp).toLocaleString('zh-CN')),
          h('td', {}, r.scenario ?? '扫描导入'),
          h('td', {}, tag(r.overallPass)),
          h('td', { class: 'num' }, `${fmt(r.durationMs, 0)} ms`),
          h('td', { class: 'num' }, fmt(Math.max(...r.solidSummary.map((s) => s.deltaE)), 2)),
          h('td', { class: 'num' }, r.grayWorst ? fmt(r.grayWorst.deltaE, 2) : '—'),
          h('td', {}, r.engine === 'webgl2' ? 'WebGL2' : 'CPU'),
        ))),
      ),
    ),
  );

  root.append(stats, charts, table);
  requestAnimationFrame(() => drawCharts(history));
}

function metric(k: string, v: string): HTMLElement {
  return h('div', { class: 'metric' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
}

interface Series {
  name: string;
  color: string;
  values: number[];
  limit?: [number, number];
  aim?: number;
}

function drawCharts(history: InspectionRecord[]): void {
  const rev = [...history].reverse(); // 时间正序
  const target = getIsoTarget('PT1_PT2_coated');

  const densitySeries: Series[] = INKS.map((ink) => ({
    name: ink,
    color: inkColor(ink),
    values: rev.map((r) => r.solidSummary.find((s) => s.ink === ink)?.density ?? NaN),
    aim: target.solidDensityAim[ink],
    limit: [
      target.solidDensityAim[ink] - target.densityTolerance,
      target.solidDensityAim[ink] + target.densityTolerance,
    ],
  }));
  drawSeries(document.getElementById('chart-density') as HTMLCanvasElement, densitySeries, '密度 D');

  const deSeries: Series[] = INKS.map((ink) => ({
    name: ink,
    color: inkColor(ink),
    values: rev.map((r) => r.solidSummary.find((s) => s.ink === ink)?.deltaE ?? NaN),
    limit: [0, target.solidDeltaELimit],
  }));
  drawSeries(document.getElementById('chart-de') as HTMLCanvasElement, deSeries, 'ΔE00');

  const tviSeries: Series[] = INKS.map((ink) => ({
    name: ink,
    color: inkColor(ink),
    values: rev.map((r) => r.solidSummary.find((s) => s.ink === ink)?.tvi50 ?? NaN),
    aim: target.tviAim[ink][50],
    limit: [
      target.tviAim[ink][50] - target.tviTolerance,
      target.tviAim[ink][50] + target.tviTolerance,
    ],
  }));
  drawSeries(document.getElementById('chart-tvi') as HTMLCanvasElement, tviSeries, 'TVI %');
}

function inkColor(ink: InkName): string {
  return { C: '#29b6d8', M: '#e2479b', Y: '#e8c531', K: '#cfd6dd' }[ink];
}

function drawSeries(canvas: HTMLCanvasElement, series: Series[], yLabel: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const styles = getComputedStyle(document.documentElement);
  const fg = styles.getPropertyValue('--fg').trim() || '#333';
  const muted = styles.getPropertyValue('--muted').trim() || '#888';
  const border = styles.getPropertyValue('--border').trim() || '#ccc';

  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let yMin = Math.min(...all, ...series.flatMap((s) => (s.limit ? [s.limit[0]] : [])));
  let yMax = Math.max(...all, ...series.flatMap((s) => (s.limit ? [s.limit[1]] : [])));
  const pad = (yMax - yMin) * 0.12 || 1;
  yMin -= pad;
  yMax += pad;
  const n = Math.max(...series.map((s) => s.values.length));
  const ml = 48;
  const mr = 12;
  const mt = 14;
  const mb = 28;
  const x = (i: number): number => ml + ((n <= 1 ? 0.5 : i / (n - 1)) * (w - ml - mr));
  const y = (v: number): number => mt + (1 - (v - yMin) / (yMax - yMin)) * (h - mt - mb);

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ml, mt);
  ctx.lineTo(ml, h - mb);
  ctx.lineTo(w - mr, h - mb);
  ctx.stroke();

  // y 轴刻度
  ctx.fillStyle = muted;
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const yy = y(v);
    ctx.fillText(v.toFixed(2), 4, yy + 3);
    ctx.strokeStyle = border;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(ml, yy);
    ctx.lineTo(w - mr, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillText(yLabel, 4, mt - 2);

  // 限界/目标线（取第一条 series 的 limit 示意，全部绘制）
  for (const s of series) {
    if (s.limit) {
      for (const lv of s.limit) {
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ml, y(lv));
        ctx.lineTo(w - mr, y(lv));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const px = x(i);
      const py = y(v);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      ctx.beginPath();
      ctx.arc(x(i), y(v), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // 图例
  let lx = ml;
  ctx.font = '12px sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, h - 12, 10, 3);
    ctx.fillStyle = fg;
    ctx.fillText(s.name, lx + 14, h - 6);
    lx += 42;
  }
}
