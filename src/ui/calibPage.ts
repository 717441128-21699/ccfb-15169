// 色卡校准页: 扫描仪特性化(标准色卡 -> LUT + 3x3 矩阵), 残差与矩阵展示

import type { AppContext } from '../app';
import { renderCalibTarget, CALIB_W, CALIB_H } from '../calib/calibration';
import { h, fmt, clear } from './dom';

export function calibPage(ctx: AppContext): { el: HTMLElement; refresh(): void } {
  const statusEl = h('div', {});
  const preview = h('canvas', { class: 'calib-preview' }) as HTMLCanvasElement;

  function drawTarget(): void {
    const img = renderCalibTarget();
    const scale = Math.min(1, 560 / CALIB_W);
    preview.width = Math.round(CALIB_W * scale);
    preview.height = Math.round(CALIB_H * scale);
    const tmp = document.createElement('canvas');
    tmp.width = CALIB_W;
    tmp.height = CALIB_H;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    preview.getContext('2d')!.drawImage(tmp, 0, 0, preview.width, preview.height);
  }

  function renderStatus(): void {
    const cal = ctx.getCal();
    clear(statusEl);
    const m = cal.matrix;
    const row = (r: number) =>
      h(
        'tr',
        {},
        h('td', {}, fmt(m[r * 3], 4)),
        h('td', {}, fmt(m[r * 3 + 1], 4)),
        h('td', {}, fmt(m[r * 3 + 2], 4)),
        h('td', {}, fmt(cal.offset[r], 4))
      );
    statusEl.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, '当前特性化'),
        h(
          'table',
          {},
          h('tr', {}, h('th', {}, '校准时间'), h('td', {}, cal.createdAt ? new Date(cal.createdAt).toLocaleString() : '-')),
          h('tr', {}, h('th', {}, '复测最大密度差'), h('td', {}, fmt(cal.residual.maxDD, 4))),
          h('tr', {}, h('th', {}, '复测平均密度差'), h('td', {}, fmt(cal.residual.meanDD, 4))),
          h('tr', {}, h('th', {}, '复测最大 ΔE00'), h('td', {}, fmt(cal.residual.maxDE, 3))),
          h('tr', {}, h('th', {}, '复测平均 ΔE00'), h('td', {}, fmt(cal.residual.meanDE, 3))),
          h('tr', {}, h('th', {}, '计算管线'), h('td', {}, ctx.gpuOk ? 'WebGL2 (GPU)' : 'CPU 兜底'))
        )
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, '特性化矩阵(线性域 → 三波段反射率)'),
        h(
          'table',
          {},
          h('tr', {}, h('th', {}, ''), h('th', {}, 'R'), h('th', {}, 'G'), h('th', {}, 'B'), h('th', {}, '偏移')),
          row(0),
          row(1),
          row(2)
        ),
        h(
          'div',
          { class: 'meta' },
          '流程: 扫描标准色卡(32 级中性梯尺 + 64 色 CMY 网格 + 4 级 K) → ' +
            '逐通道逆色调曲线 LUT(256 级) → 最小二乘 3×3 矩阵。' +
            '检测时由 WebGL2 着色器实时应用 LUT 与矩阵。'
        )
      )
    );
  }

  const el = h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'card controls' },
      h(
        'button',
        {
          class: 'primary',
          onclick: () => {
            ctx.recalibrate();
            renderStatus();
          },
        },
        '扫描标准色卡并校准'
      ),
      h(
        'button',
        {
          onclick: () => {
            ctx.resetCalibration();
            renderStatus();
          },
        },
        '恢复默认校准'
      )
    ),
    statusEl,
    h('div', { class: 'card' }, h('h3', {}, '标准色卡(模拟扫描件)'), preview)
  );

  drawTarget();
  renderStatus();
  return { el, refresh: renderStatus };
}
