/** 应用入口：外壳、导航、页面挂载 */
import './styles.css';
import { h } from './dom.ts';
import { currentRoute, navigate, onRouteChange, type Route } from './router.ts';
import { renderPressPage } from './pages/press-page.ts';
import { renderInspectPage } from './pages/inspect-page.ts';
import { renderTrendPage } from './pages/trend-page.ts';
import { renderCalibrationPage } from './pages/calibration-page.ts';

const TABS: Array<{ route: Route; label: string }> = [
  { route: 'press', label: '机台' },
  { route: 'inspect', label: '检测' },
  { route: 'trend', label: '趋势' },
  { route: 'calibration', label: '色卡校准' },
];

function shell(): void {
  const app = document.getElementById('app')!;
  app.replaceChildren();
  const nav = h('nav', { class: 'tabs' },
    ...TABS.map((t) =>
      h('button', {
        class: currentRoute() === t.route ? 'active' : '',
        dataset: { route: t.route },
        onclick: () => navigate(t.route),
      }, t.label),
    ),
  );
  const header = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, '扫描测色管控系统', h('small', {}, 'ISO 12647-2 · Status T · WebGL2')),
    nav,
    h('div', { class: 'spacer' }),
  );
  const main = h('main', { id: 'view' });
  app.append(header, main);
  renderCurrent();
}

function renderCurrent(): void {
  const route = currentRoute();
  const main = document.getElementById('view')!;
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.route === route);
  });
  switch (route) {
    case 'press':
      renderPressPage(main);
      break;
    case 'inspect':
      renderInspectPage(main);
      break;
    case 'trend':
      renderTrendPage(main);
      break;
    case 'calibration':
      renderCalibrationPage(main);
      break;
  }
}

onRouteChange(() => renderCurrent());
if (!location.hash) location.hash = '#/press';
shell();
