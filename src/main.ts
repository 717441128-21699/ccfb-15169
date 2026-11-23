// 应用入口: 标签页导航

import { createApp } from './app';
import { pressPage } from './ui/pressPage';
import { measurePage } from './ui/measurePage';
import { trendPage } from './ui/trendPage';
import { calibPage } from './ui/calibPage';
import { PRESSES } from './store';
import { h } from './ui/dom';

const ctx = createApp();

let currentPress = PRESSES[0].id;

const tabs = [
  { id: 'press', label: '机台' },
  { id: 'measure', label: '检测' },
  { id: 'trend', label: '趋势' },
  { id: 'calib', label: '色卡校准' },
];

const measure = measurePage(ctx, { initialPress: () => currentPress });
const press = pressPage(ctx, {
  toMeasure(id: string) {
    currentPress = id;
    measure.setPress(id);
    showTab('measure');
  },
});
const trend = trendPage(ctx);
const calib = calibPage(ctx);

const pages: Record<string, { el: HTMLElement; refresh(): void }> = {
  press,
  measure,
  trend,
  calib,
};

const content = h('div', { id: 'content' });
const tabBar = h(
  'div',
  { class: 'tabbar' },
  ...tabs.map((t) =>
    h(
      'button',
      {
        class: 'tab',
        'data-tab': t.id,
        onclick: () => showTab(t.id),
      },
      t.label
    )
  )
);

function showTab(id: string): void {
  for (const btn of tabBar.querySelectorAll('.tab')) {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === id);
  }
  content.replaceChildren(pages[id].el);
  pages[id].refresh();
}

document.body.append(
  h(
    'header',
    {},
    h('h1', {}, '扫描仪在线测控系统'),
    h(
      'span',
      { class: 'meta' },
      `平板扫描仪 · WebGL2 检测管线 · ISO 12647-2 ${ctx.gpuOk ? '' : '· (GPU 不可用, CPU 兜底)'}`
    )
  ),
  tabBar,
  content
);

showTab('press');
