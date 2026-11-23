// 机台页: 各印刷机状态、最近测量、合格率、墨键调整一览

import type { AppContext } from '../app';
import { PRESSES, lastOf, passRate } from '../store';
import { h, fmt, fmtSigned, badge, clear } from './dom';

export function pressPage(
  _ctx: AppContext,
  nav: { toMeasure(pressId: string): void }
): { el: HTMLElement; refresh(): void } {
  const list = h('div', { class: 'press-grid' });

  function refresh(): void {
    clear(list);
    for (const p of PRESSES) {
      const last = lastOf(p.id);
      const rate = passRate(p.id);
      const card = h(
        'div',
        { class: 'card press-card' },
        h(
          'div',
          { class: 'press-head' },
          h('h3', {}, `${p.name} · ${p.model}`),
          h('span', { class: `status st-${p.status}` }, p.status)
        ),
        h('div', { class: 'meta' }, `工单: ${p.job} · 纸张: ${p.stock}`),
        last
          ? h(
              'div',
              { class: 'press-last' },
              h(
                'div',
                { class: 'meta' },
                `最近检测: ${new Date(last.time).toLocaleString()} · 耗时 ${fmt(last.ms, 0)}ms`
              ),
              h(
                'div',
                { class: 'solid-chips small' },
                ...last.judge.solids.map((s) =>
                  h(
                    'div',
                    { class: `chip ink-${s.ink}` },
                    h('div', { class: 'chip-ink' }, s.ink),
                    h('div', { class: 'chip-dens' }, fmt(s.dens)),
                    h('div', { class: 'chip-sub' }, fmtSigned(s.dD))
                  )
                )
              ),
              h(
                'div',
                { class: 'press-line' },
                badge(last.judge.pass, '本张合格', '本张超差'),
                rate !== null
                  ? h('span', { class: 'meta' }, ` 近 20 张合格率 ${fmt(rate * 100, 0)}%`)
                  : ''
              ),
              last.judge.advice.length > 0 && !last.judge.pass
                ? h('div', { class: 'meta advice-line' }, `建议: ${last.judge.advice[0]}`)
                : ''
            )
          : h('div', { class: 'meta' }, '暂无检测数据'),
        h(
          'button',
          { class: 'primary', onclick: () => nav.toMeasure(p.id) },
          '去检测'
        )
      );
      list.append(card);
    }
  }

  refresh();
  return { el: h('div', { class: 'page' }, list), refresh };
}
