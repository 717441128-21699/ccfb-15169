/** 检测页：合成/导入印张 → WebGL2 检测 → 指标判定 → 调墨建议 */
import { h, clear, toast, fmt, tag, swatch } from '../dom.ts';
import { store } from '../../core/store.ts';
import { SCENARIOS } from '../../core/scenarios.ts';
import { makeInspectionSheet } from '../../core/synthesis.ts';
import { runInspection, type InspectionOutput } from '../../core/measurement.ts';
import { cpuBackend, gpuBackend, type ImagingBackend } from '../../imaging/detect.ts';
import { GlBackend } from '../../imaging/gl-backend.ts';
import { detectControlBar } from '../../imaging/detect.ts';
import { renderRgbToCanvas } from '../canvas-util.ts';
import { loadImageFile } from './calibration-page.ts';
import type { InkName, InspectionRecord, RGBImage } from '../../core/types.ts';

let gl: GlBackend | null = null;
let lastOutput: InspectionOutput | null = null;

export function renderInspectPage(root: HTMLElement): void {
  clear(root);
  const press = activePress();
  const profile = store.getProfile();

  if (!press || !profile) {
    root.append(h('div', { class: 'card' },
      h('h2', {}, '检测前准备'),
      h('p', { class: 'muted' },
        !press ? '请先在机台页选择当前机台。' : '请先在色卡校准页完成扫描仪特性化。',
      ),
    ));
    return;
  }

  const scenarioSelect = h('select', {},
    ...SCENARIOS.map((s) => h('option', { value: s.id }, `${s.name} — ${s.description}`)),
  ) as HTMLSelectElement;

  const enginePill = h('span', { class: 'pill' }, detectGl() ? 'WebGL2 已就绪' : 'WebGL2 不可用，使用 CPU');
  const canvasHost = h('div', { class: 'canvas-wrap' });
  const resultHost = h('div', {});

  const run = async (image: RGBImage, scenario?: string, seed = 42): Promise<void> => {
    const backend: ImagingBackend = detectGl() && gl ? gpuBackend(gl) : cpuBackend;
    const engineName = detectGl() && gl ? 'webgl2' : 'cpu';
    if (gl) gl.gpuTimeMs = 0;
    try {
      const output = runInspection(image, press, profile, backend, {
        engine: engineName,
        scenario,
      });
      lastOutput = output;
      store.addHistory(output.record);
      // 叠加定位框
      const det = detectControlBar(image, backend);
      renderRgbToCanvas(det.corrected, canvasHost, 0.55, det.located);
      renderResult(resultHost, output);
      toast(output.record.overallPass ? '检测完成：整体合格' : '检测完成：存在超差项');
      void seed;
    } catch (e) {
      toast(`检测失败：${(e as Error).message}`, 4000);
    }
  };

  const controls = h('div', { class: 'card' },
    h('h2', {}, '印张检测'),
    h('div', { class: 'row' },
      h('span', { class: 'pill' }, `机台：${press.name}`),
      h('span', { class: 'pill' }, `特性文件：ΔE RMSE ${fmt(profile.fitResidualLab, 2)}`),
      enginePill,
    ),
    h('div', { class: 'row', style: 'margin-top:12px' },
      scenarioSelect,
      h('button', {
        class: 'btn',
        onclick: () => {
          const sc = SCENARIOS.find((s) => s.id === scenarioSelect.value)!;
          const { image } = makeInspectionSheet(sc.bias, 42, 1400, 900, 1.2);
          void run(image, sc.name);
        },
      }, '合成测试印张并检测'),
      h('button', {
        class: 'btn secondary',
        onclick: () => {
          const input = h('input', {
            type: 'file',
            accept: 'image/*',
            style: 'display:none',
            onchange: async () => {
              const file = (input as HTMLInputElement).files?.[0];
              if (!file) return;
              const image = await loadImageFile(file);
              renderRgbToCanvas(image, canvasHost, 0.55);
              await run(image, file.name);
            },
          }) as HTMLInputElement;
          input.click();
        },
      }, '导入扫描图'),
      h('button', {
        class: 'btn secondary',
        onclick: async () => {
          // GPU/CPU 一致性自检
          if (!gl) return toast('当前环境无 WebGL2');
          const sc = SCENARIOS[0];
          const { image } = makeInspectionSheet(sc.bias, 42);
          const a = detectControlBar(image, cpuBackend);
          const b = detectControlBar(image, gpuBackend(gl));
          const angleDiff = Math.abs(a.angleDeg - b.angleDeg);
          const locDiff = Math.max(
            ...a.located.map((p, i) => Math.hypot(p.cx - b.located[i].cx, p.cy - b.located[i].cy)),
          );
          toast(`自检：角度差 ${fmt(angleDiff, 2)}°，定位最大偏差 ${fmt(locDiff, 1)}px`);
        },
      }, 'GPU/CPU 一致性自检'),
    ),
  );

  root.append(controls, h('div', { class: 'card' }, h('h2', {}, '扫描图与色块定位'), canvasHost), resultHost);
}

function activePress() {
  const id = store.getActivePressId();
  return store.getPresses().find((p) => p.id === id) ?? null;
}

function detectGl(): boolean {
  if (gl) return true;
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2');
    if (!g) return false;
    gl = new GlBackend(c);
    return true;
  } catch {
    return false;
  }
}

function renderResult(host: HTMLElement, output: InspectionOutput): void {
  clear(host);
  const r = output.record;
  host.append(
    h('div', { class: 'card' },
      h('h2', {}, '总体结论'),
      h('div', { class: 'row' },
        tag(r.overallPass, r.overallPass ? '整体合格' : '存在超差'),
        h('span', { class: 'pill' }, `耗时 ${fmt(r.durationMs, 0)} ms（目标 < 1000 ms）`),
        h('span', { class: 'pill' }, `引擎：${r.engine === 'webgl2' ? 'WebGL2 GPU' : 'CPU'}`),
        r.scenario ? h('span', { class: 'pill' }, `场景：${r.scenario}`) : null,
      ),
      r.grayWorst
        ? h('div', { class: 'row', style: 'margin-top:10px' },
            h('span', { class: 'muted' }, `灰平衡最差：${r.grayWorst.label} ΔE=${fmt(r.grayWorst.deltaE, 2)}`),
            tag(r.grayWorst.deltaE <= 3),
          )
        : null,
    ),
    solidCard(r),
    trapCard(output),
    adviceCard(output),
    patchTableCard(r),
  );
}

function solidCard(r: InspectionRecord): HTMLElement {
  return h('div', { class: 'card' },
    h('h2', {}, '四色实地与网点扩大'),
    h('div', { class: 'scroll-x' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '墨色'), h('th', { class: 'num' }, '实地密度'), h('th', {}, '密度判定'),
          h('th', { class: 'num' }, 'ΔE00'), h('th', {}, '色差判定'),
          h('th', { class: 'num' }, 'TVI50'), h('th', {}, 'TVI 判定'),
          h('th', {}, '实测 Lab'),
        )),
        h('tbody', {}, ...r.solidSummary.map((s) => h('tr', {},
          h('td', {}, inkDot(s.ink), s.ink),
          h('td', { class: 'num' }, `${fmt(s.density)} / 目标 ${fmt(s.densityAim)}`),
          h('td', {}, tag(s.passDensity)),
          h('td', { class: 'num' }, fmt(s.deltaE)),
          h('td', {}, tag(s.passDeltaE)),
          h('td', { class: 'num' }, `${fmt(s.tvi50, 1)}% / ${fmt(s.tviAim50, 0)}%`),
          h('td', {}, tag(s.passTvi)),
          h('td', { class: 'num' }, `L${fmt(s.lab.L)} a${fmt(s.lab.a)} b${fmt(s.lab.b)}`),
        ))),
      ),
    ),
  );
}

function trapCard(output: InspectionOutput): HTMLElement {
  return h('div', { class: 'card' },
    h('h2', {}, '叠印率（Preucil）'),
    h('div', { class: 'grid-4' }, ...output.traps.map((t) =>
      h('div', { class: 'metric' },
        h('div', { class: 'k' }, t.label),
        h('div', { class: 'v' }, `${fmt(t.value, 1)}%`),
        h('div', { class: 'sub' }, tag(t.pass, t.pass ? '达标' : '偏低')),
      ),
    )),
  );
}

function adviceCard(output: InspectionOutput): HTMLElement {
  return h('div', { class: 'card' },
    h('h2', {}, '调墨建议'),
    ...output.advices.map((a) =>
      h('div', { class: `advice ${a.severity}` },
        h('div', { style: 'font-weight:600;margin-bottom:3px' },
          inkDot(a.ink), `${a.ink} 墨键`, a.keyAdjust !== 0
            ? h('span', { class: 'pill', style: 'margin-left:8px' }, `${a.keyAdjust > 0 ? '+' : ''}${a.keyAdjust}%`)
            : null,
        ),
        h('div', {}, a.message),
      ),
    ),
  );
}

function patchTableCard(r: InspectionRecord): HTMLElement {
  return h('div', { class: 'card' },
    h('h2', {}, '逐色块测量明细'),
    h('div', { class: 'scroll-x' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '色块'), h('th', {}, '颜色'),
          h('th', { class: 'num' }, 'R'), h('th', { class: 'num' }, 'G'), h('th', { class: 'num' }, 'B'),
          h('th', { class: 'num' }, 'L'), h('th', { class: 'num' }, 'a'), h('th', { class: 'num' }, 'b'),
          h('th', { class: 'num' }, 'ΔE'), h('th', {}, '判定'),
        )),
        h('tbody', {}, ...r.patches.map((p) => h('tr', {},
          h('td', {}, p.patch.label),
          h('td', {}, swatch(p.rgb)),
          h('td', { class: 'num' }, String(Math.round(p.rgb[0]))),
          h('td', { class: 'num' }, String(Math.round(p.rgb[1]))),
          h('td', { class: 'num' }, String(Math.round(p.rgb[2]))),
          h('td', { class: 'num' }, fmt(p.lab.L)),
          h('td', { class: 'num' }, fmt(p.lab.a)),
          h('td', { class: 'num' }, fmt(p.lab.b)),
          h('td', { class: 'num' }, fmt(p.deltaE)),
          h('td', {}, tag(p.deltaE <= (p.patch.kind === 'gray' ? 3 : 5))),
        ))),
      ),
    ),
  );
}

const INK_COLORS: Record<InkName, string> = {
  C: 'rgb(0,160,200)',
  M: 'rgb(220,0,120)',
  Y: 'rgb(245,210,0)',
  K: 'rgb(30,30,30)',
};
function inkDot(ink: InkName): HTMLElement {
  return h('span', { class: 'swatch', style: `background:${INK_COLORS[ink]}` });
}
