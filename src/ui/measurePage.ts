// 检测页: 合成/扫描印张 -> WebGL2 检测 -> ISO 判定 -> 调墨建议 -> 精度自检

import type { AppContext } from '../app';
import { judge } from '../color/iso12647';
import { STRIP, type PressDeviation } from '../sim/model';
import { renderSheet, PATCH_SIZE, STRIP_CY, SHEET_W, SHEET_H } from '../sim/sheetSynth';
import { detectStrip, type StripGeometry } from '../detect/geometry';
import { CpuSampler } from '../detect/cpuSampler';
import {
  SCENARIOS,
  randomScenario,
  runSelfTest,
  SPEC,
  type SelfTestReport,
} from '../detect/selftest';
import { makeRng } from '../sim/scanner';
import { addMeasurement, PRESSES } from '../store';
import { h, fmt, fmtSigned, badge, clear } from './dom';

let seedCounter = 42;

export interface MeasureNav {
  getPressId(): string;
}

export function measurePage(
  ctx: AppContext,
  nav: { initialPress: () => string }
): { el: HTMLElement; setPress(id: string): void; refresh(): void } {
  let pressId = nav.initialPress();
  let scenarioIdx = 0;
  let lastPass: boolean[] = [];

  const pressSel = h(
    'select',
    {
      onchange: (e) => {
        pressId = (e.target as HTMLSelectElement).value;
      },
    },
    ...PRESSES.map((p) =>
      h('option', { value: p.id, selected: p.id === pressId }, `${p.name} ${p.model}`)
    )
  ) as HTMLSelectElement;

  const scenarioSel = h(
    'select',
    {
      onchange: (e) => {
        scenarioIdx = (e.target as HTMLSelectElement).selectedIndex;
      },
    },
    ...SCENARIOS.map((s, i) => h('option', { value: i }, s.name)),
    h('option', { value: 'rand' }, '随机偏差')
  ) as HTMLSelectElement;

  const metaLine = h('div', { class: 'meta' }, '尚未扫描');
  const preview = h('canvas', { class: 'sheet-preview' }) as HTMLCanvasElement;
  const resultsEl = h('div', { class: 'results' });
  const selftestEl = h('div', { class: 'selftest' });

  function currentDev(): { dev: PressDeviation; name: string } {
    if (scenarioIdx === SCENARIOS.length) {
      const sc = randomScenario(makeRng((seedCounter * 131 + 7) >>> 0), 0);
      return { dev: sc.dev, name: '随机偏差' };
    }
    return { dev: SCENARIOS[scenarioIdx].dev, name: SCENARIOS[scenarioIdx].name };
  }

  function scan(): void {
    const { dev, name } = currentDev();
    seedCounter++;
    const sheet = renderSheet(dev, (seedCounter * 7919) % 100000);
    ctx.sampler.setImage(sheet.image);
    const t0 = performance.now();
    const geom = detectStrip(ctx.sampler);
    if (!geom) {
      metaLine.textContent = '未找到色控条, 请检查印张';
      return;
    }
    const samples = ctx.sampler.measure(geom, 16);
    const ms = performance.now() - t0;
    const j = judge(samples);
    addMeasurement({
      id: `m${Date.now()}`,
      time: Date.now(),
      pressId,
      scenario: name,
      samples,
      judge: j,
      ms,
    });
    lastPass = STRIP.map((s) => {
      if (s.kind === 'solid') {
        const r = j.solids.find((x) => x.ink === s.id[0]);
        return r ? r.pass : true;
      }
      return true;
    });
    drawPreview(sheet.image, geom, lastPass);
    renderResults(j.solids.length, ms, j, name, geom);
  }

  function renderResults(
    _n: number,
    ms: number,
    j: ReturnType<typeof judge>,
    scenarioName: string,
    geom: StripGeometry
  ): void {
    clear(resultsEl);
    metaLine.textContent =
      `场景「${scenarioName}」 · 检测耗时 ${fmt(ms, 0)} ms ` +
      `(${ctx.sampler.kind === 'gpu' ? 'WebGL2' : 'CPU'} 管线) · 纠偏角 ${fmt(geom.angleDeg, 2)}°`;

    // 实地密度卡片
    const solidsCard = h(
      'div',
      { class: 'card' },
      h('h3', {}, '实地密度 / 色差'),
      h(
        'div',
        { class: 'solid-chips' },
        ...j.solids.map((s) =>
          h(
            'div',
            { class: `chip ink-${s.ink}` },
            h('div', { class: 'chip-ink' }, s.ink),
            h('div', { class: 'chip-dens' }, fmt(s.dens)),
            h('div', { class: 'chip-sub' }, `目标 ${fmt(s.targetDens)} · ${fmtSigned(s.dD)}`),
            h('div', { class: 'chip-sub' }, `ΔE00 ${fmt(s.dE, 2)}`),
            badge(s.pass)
          )
        )
      )
    );

    // TVI 表
    const tviCard = h(
      'div',
      { class: 'card' },
      h('h3', {}, '网点扩大 (Yule-Nielsen)'),
      h(
        'table',
        {},
        h('tr', {}, h('th', {}, '色'), h('th', {}, '40% 实测'), h('th', {}, '40% 标称'), h('th', {}, '80% 实测'), h('th', {}, '')),
        ...j.tvis.map((t) =>
          h(
            'tr',
            {},
            h('td', {}, t.ink),
            h('td', {}, `${fmt(t.at40 * 100, 1)}%`),
            h('td', {}, `${fmt(t.nominal40 * 100, 1)}%`),
            h('td', {}, `${fmt(t.at80 * 100, 1)}%`),
            h('td', {}, badge(t.pass))
          )
        )
      )
    );

    // 叠印率
    const trapCard = h(
      'div',
      { class: 'card' },
      h('h3', {}, '叠印率 (Preucil)'),
      h(
        'table',
        {},
        h('tr', {}, h('th', {}, '叠印'), h('th', {}, '实测'), h('th', {}, '标称'), h('th', {}, '')),
        ...j.traps.map((t) =>
          h(
            'tr',
            {},
            h('td', {}, t.label),
            h('td', {}, `${fmt(t.trap * 100, 1)}%`),
            h('td', {}, `${fmt(t.nominal * 100, 0)}%`),
            h('td', {}, badge(t.pass))
          )
        )
      )
    );

    // 灰平衡
    const grayCard = h(
      'div',
      { class: 'card' },
      h('h3', {}, '灰平衡 (C50/M40/Y40)'),
      h(
        'table',
        {},
        h('tr', {}, h('th', {}, 'a*'), h('th', {}, 'b*'), h('th', {}, 'ΔE00'), h('th', {}, '')),
        h(
          'tr',
          {},
          h('td', {}, fmtSigned(j.gray.a, 1)),
          h('td', {}, fmtSigned(j.gray.b, 1)),
          h('td', {}, fmt(j.gray.dE, 2)),
          h('td', {}, badge(j.gray.pass))
        )
      )
    );

    // 调墨建议
    const adviceCard = h(
      'div',
      { class: `card advice ${j.pass ? '' : 'warn'}` },
      h('h3', {}, `调墨建议 ${j.pass ? '· 本张合格' : '· 本张超差'}`),
      h('ul', {}, ...j.advice.map((a) => h('li', {}, a)))
    );

    resultsEl.append(solidsCard, tviCard, trapCard, grayCard, adviceCard);
  }

  function drawPreview(img: ImageData, geom: StripGeometry, passes: boolean[]): void {
    const scale = 480 / SHEET_W;
    preview.width = Math.round(SHEET_W * scale);
    preview.height = Math.round(SHEET_H * scale);
    const g = preview.getContext('2d')!;
    const tmp = document.createElement('canvas');
    tmp.width = SHEET_W;
    tmp.height = SHEET_H;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0, preview.width, preview.height);
    // 叠加检测框
    geom.centers.forEach((c, i) => {
      g.strokeStyle = passes[i] ? '#3f6' : '#f44';
      g.lineWidth = 1.5;
      const s = (PATCH_SIZE / 2) * scale;
      g.strokeRect(c.x * scale - s, c.y * scale - s, s * 2, s * 2);
    });
    g.strokeStyle = '#4af';
    for (const m of [geom.markL, geom.markR]) {
      g.beginPath();
      g.arc(m.x * scale, m.y * scale, 8 * scale * 3, 0, Math.PI * 2);
      g.stroke();
    }
    // 标注条带位置
    g.fillStyle = '#4af';
    g.font = '11px system-ui';
    g.fillText(`色控条 y≈${STRIP_CY}`, 6, geom.stripY0 * scale - 4);
  }

  function selftest(): void {
    clear(selftestEl);
    selftestEl.append(h('div', { class: 'meta' }, '自检运行中(合成 12 张偏差印张)…'));
    // 让 UI 先渲染
    setTimeout(() => {
      const rng = makeRng(20261124);
      const scenarios = [...SCENARIOS, ...Array.from({ length: 6 }, (_, i) => randomScenario(rng, i))];
      const rep: SelfTestReport = runSelfTest(ctx.sampler, scenarios);
      // GPU/CPU 交叉校验
      let cross = '';
      if (ctx.sampler.kind === 'gpu') {
        const cpu = new CpuSampler(ctx.getCal());
        const repCpu = runSelfTest(cpu, [SCENARIOS[0]], 1000);
        const a = rep.rows[0];
        const b = repCpu.rows[0];
        cross = `GPU/CPU 交叉校验: 密度差 ${fmt(Math.abs(a.maxDD - b.maxDD), 4)}, ` +
          `CPU 侧 maxΔD ${fmt(b.maxDD, 4)} / maxΔE ${fmt(b.maxDE, 3)}`;
      }
      clear(selftestEl);
      selftestEl.append(
        h(
          'div',
          { class: `card ${rep.pass ? '' : 'warn'}` },
          h('h3', {}, `精度自检 ${rep.pass ? '通过' : '未通过'} (${rep.samplerKind.toUpperCase()} 管线)`),
          h(
            'div',
            { class: 'spec-line' },
            `指标: 密度差 ≤${SPEC.maxDD} · ΔE00 ≤${SPEC.maxDE} · 单张 <${SPEC.maxMs}ms —— ` +
              `实测最差: 密度差 ${fmt(rep.maxDD, 4)} · ΔE00 ${fmt(rep.maxDE, 3)} · ${fmt(rep.maxMs, 0)}ms`
          ),
          h(
            'table',
            {},
            h(
              'tr',
              {},
              h('th', {}, '偏差场景'),
              h('th', {}, '最大密度差'),
              h('th', {}, '最大 ΔE00'),
              h('th', {}, '耗时'),
              h('th', {}, '')
            ),
            ...rep.rows.map((r) =>
              h(
                'tr',
                {},
                h('td', {}, r.scenario),
                h('td', {}, fmt(r.maxDD, 4)),
                h('td', {}, fmt(r.maxDE, 3)),
                h('td', {}, `${fmt(r.ms, 0)} ms`),
                h('td', {}, badge(r.pass, '达标', '超标'))
              )
            )
          ),
          cross ? h('div', { class: 'meta' }, cross) : ''
        )
      );
    }, 30);
  }

  const el = h(
    'div',
    { class: 'page measure-page' },
    h(
      'div',
      { class: 'card controls' },
      h('label', {}, '机台 ', pressSel),
      h('label', {}, ' 偏差场景 ', scenarioSel),
      h('button', { class: 'primary', onclick: scan }, '扫描印张并检测'),
      h('button', { onclick: selftest }, '精度自检(合成偏差印张)'),
      metaLine
    ),
    h('div', { class: 'card' }, h('h3', {}, '扫描图与色控条定位'), preview),
    resultsEl,
    selftestEl
  );

  return {
    el,
    setPress(id: string) {
      pressId = id;
      pressSel.value = id;
    },
    refresh() {},
  };
}
