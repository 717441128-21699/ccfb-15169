// 趋势页: 密度 / ΔE / 网点扩大 控制图

import type { AppContext } from '../app';
import { PRESSES, byPress } from '../store';
import { TARGET_DENS, TOL } from '../color/iso12647';
import { INKS, TVI50_NOMINAL } from '../sim/model';
import { drawChart, type Series } from './charts';
import { h } from './dom';

const INK_COLOR: Record<string, string> = { C: '#0af', M: '#e3c', Y: '#dc0', K: '#999' };

type Metric = 'dens' | 'de' | 'tvi';

export function trendPage(_ctx: AppContext): { el: HTMLElement; refresh(): void } {
  let pressId = PRESSES[0].id;
  let metric: Metric = 'dens';

  const canvas = h('canvas', { class: 'trend-chart' }) as HTMLCanvasElement;

  function render(): void {
    const list = byPress(pressId).slice(-50);
    let series: Series[] = [];
    let yLabel = '';
    let limits: { v: number; label: string; color?: string }[] = [];
    if (metric === 'dens') {
      yLabel = '实地密度';
      series = INKS.map((ink) => ({
        label: ink,
        color: INK_COLOR[ink],
        points: list
          .map((m) => {
            const s = m.judge.solids.find((x) => x.ink === ink);
            return { t: m.time, v: s ? s.dens : NaN };
          })
          .filter((p) => !isNaN(p.v)),
      }));
      for (const ink of INKS) {
        limits.push(
          { v: TARGET_DENS[ink] + TOL.solidDD, label: `${ink} 上限`, color: INK_COLOR[ink] },
          { v: TARGET_DENS[ink] - TOL.solidDD, label: `${ink} 下限`, color: INK_COLOR[ink] }
        );
      }
    } else if (metric === 'de') {
      yLabel = '实地 ΔE00';
      series = INKS.map((ink) => ({
        label: ink,
        color: INK_COLOR[ink],
        points: list
          .map((m) => {
            const s = m.judge.solids.find((x) => x.ink === ink);
            return { t: m.time, v: s ? s.dE : NaN };
          })
          .filter((p) => !isNaN(p.v)),
      }));
      limits = [{ v: TOL.solidDE, label: 'ΔE 限', color: '#c66' }];
    } else {
      yLabel = '网点扩大(40%)';
      series = INKS.map((ink) => ({
        label: ink,
        color: INK_COLOR[ink],
        points: list
          .map((m) => {
            const t = m.judge.tvis.find((x) => x.ink === ink);
            return { t: m.time, v: t ? t.at40 * 100 : NaN };
          })
          .filter((p) => !isNaN(p.v)),
      }));
      const nom = (TVI50_NOMINAL.C * (1 - 0.04)) * 100;
      limits = [
        { v: nom + TOL.tvi * 100, label: '上限', color: '#c66' },
        { v: nom - TOL.tvi * 100, label: '下限', color: '#c66' },
      ];
    }
    drawChart(canvas, series, { yLabel, limits });
  }

  const pressSel = h(
    'select',
    {
      onchange: (e) => {
        pressId = (e.target as HTMLSelectElement).value;
        render();
      },
    },
    ...PRESSES.map((p) => h('option', { value: p.id }, `${p.name} ${p.model}`))
  );

  const metricSel = h(
    'select',
    {
      onchange: (e) => {
        metric = (e.target as HTMLSelectElement).value as Metric;
        render();
      },
    },
    h('option', { value: 'dens' }, '实地密度'),
    h('option', { value: 'de' }, '实地 ΔE00'),
    h('option', { value: 'tvi' }, '网点扩大(40%)')
  );

  const el = h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'card controls' },
      h('label', {}, '机台 ', pressSel),
      h('label', {}, ' 指标 ', metricSel)
    ),
    h('div', { class: 'card' }, canvas)
  );

  return {
    el,
    refresh() {
      render();
    },
  };
}
