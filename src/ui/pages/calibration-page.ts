/** 色卡校准页：合成/导入色卡 → 检测取色 → 训练特性文件 → 残差报告 */
import { h, clear, toast, fmt } from '../dom.ts';
import { store } from '../../core/store.ts';
import { buildChartSamples, makeChartSheet } from '../../core/chart-samples.ts';
import { trainProfile } from '../../core/profile.ts';
import { cpuBackend } from '../../imaging/detect-internals.ts';
import { renderRgbToCanvas } from '../canvas-util.ts';
import type { RGBImage, ScannerProfile } from '../../core/types.ts';

export function renderCalibrationPage(root: HTMLElement): void {
  clear(root);
  const existing = store.getProfile();

  const status = h('div', { class: 'card' });
  function renderStatus(): void {
    clear(status);
    const p = store.getProfile();
    status.append(h('h2', {}, '当前特性文件'));
    if (!p) {
      status.append(h('p', { class: 'muted' }, '尚未建立扫描仪特性文件，请先扫描标准色卡或使用合成色卡完成特性化。'));
      return;
    }
    status.append(
      h('div', { class: 'grid-4' },
        metric('多项式阶数', `${p.polynomialDegree} 次`, `${p.basisSize} 个基函数`),
        metric('Lab 校验 RMSE', `ΔE ${fmt(p.fitResidualLab, 2)}`, '目标 ≤ 1.5'),
        metric('密度校验 RMSE', `${fmt(p.fitResidualDensity, 3)}D`, '目标 ≤ 0.03'),
        metric('建立时间', new Date(p.createdAt).toLocaleString('zh-CN'), p.name),
      ),
      h('div', { class: 'kv', style: 'margin-top:12px' },
        h('span', { class: 'k' }, '纸白 RGB'),
        h('span', {}, p.paperRgb.map((v) => Math.round(v)).join(', ')),
      ),
    );
  }
  renderStatus();

  const canvasHost = h('div', { class: 'canvas-wrap' });
  const log = h('div', {});
  function line(text: string): void {
    log.append(h('div', { style: 'padding:3px 0;font-variant-numeric:tabular-nums' }, text));
  }

  const train = async (image: RGBImage, label: string): Promise<void> => {
    clear(log);
    line('① 检测色卡网格与定位标记…');
    await frame();
    const t0 = performance.now();
    const samples = buildChartSamples(image, cpuBackend);
    line(`　 定位 ${samples.length} 个色块，耗时 ${fmt(performance.now() - t0, 0)} ms`);
    line('② 训练多项式岭回归（RGB→Lab、RGB→密度，80/20 校验拆分）…');
    await frame();
    const result = trainProfile(samples, 4, label);
    line(`　 Lab 校验：RMSE ΔE=${fmt(result.profile.fitResidualLab, 2)}，最大 ΔE=${fmt(result.valMaxDeltaE, 2)}`);
    line(`　 密度校验：RMSE=${fmt(result.profile.fitResidualDensity, 3)}D，最大误差=${fmt(result.valMaxDensityErr, 3)}D`);
    const labOk = result.valMaxDeltaE <= 1.5;
    const denOk = result.valMaxDensityErr <= 0.03;
    line(`③ 精度判定：色差 ${labOk ? '✓ 达标' : '✗ 未达标'}（≤1.5），密度 ${denOk ? '✓ 达标' : '✗ 未达标'}（≤0.03）`);
    if (labOk && denOk) {
      store.saveProfile(result.profile);
      line('特性文件已保存，检测页可直接使用。');
      toast('特性化完成并保存');
    } else {
      toast('精度未达标，请检查色卡清洁度后重训', 4000);
    }
    renderStatus();
  };

  const controls = h('div', { class: 'card' },
    h('h2', {}, '特性化流程'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const { image } = makeChartSheet(11);
          renderRgbToCanvas(image, canvasHost, 0.5);
          await train(image, '合成 IT8 风格色卡特性文件');
        },
      }, '生成合成色卡并特性化'),
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
              renderRgbToCanvas(image, canvasHost, 0.5);
              await train(image, file.name);
            },
          }) as HTMLInputElement;
          input.click();
        },
      }, '导入色卡扫描图'),
      existing
        ? h('button', {
            class: 'btn danger',
            onclick: () => {
              localStorage.removeItem('scc.profile');
              renderStatus();
              toast('已删除特性文件');
            },
          }, '删除特性文件')
        : null,
    ),
    h('p', { class: 'muted', style: 'margin-bottom:0' },
      '生产现场流程：先用分光密度计测量标准色卡（如 IT8.7-4）取得 Lab/密度参考，再扫描同一张色卡，系统按色块布局对齐后回归建模。',
    ),
  );

  root.append(status, controls, h('div', { class: 'card' }, h('h2', {}, '色卡预览'), canvasHost, log));
}

function metric(k: string, v: string, sub = ''): HTMLElement {
  return h('div', { class: 'metric' },
    h('div', { class: 'k' }, k),
    h('div', { class: 'v' }, v),
    sub ? h('div', { class: 'sub' }, sub) : null,
  );
}

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function loadImageFile(file: File): Promise<RGBImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const raw = ctx.getImageData(0, 0, c.width, c.height).data;
      const data = new Uint8ClampedArray(c.width * c.height * 3);
      for (let i = 0, j = 0; i < raw.length; i += 4, j += 3) {
        data[j] = raw[i];
        data[j + 1] = raw[i + 1];
        data[j + 2] = raw[i + 2];
      }
      URL.revokeObjectURL(url);
      resolve({ width: c.width, height: c.height, data });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export type { ScannerProfile };
