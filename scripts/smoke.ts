/**
 * 端到端工作流冒烟测试（Node 环境，CPU 后端）：
 * 色卡特性化 → 七场景检测 → 历史记录，验证完整业务链路无运行时错误
 */
import { makeChartSheet, buildChartSamples } from '../src/core/chart-samples.ts';
import { trainProfile } from '../src/core/profile.ts';
import { makeInspectionSheet } from '../src/core/synthesis.ts';
import { runInspection } from '../src/core/measurement.ts';
import { cpuBackend } from '../src/imaging/detect-internals.ts';
import { SCENARIOS } from '../src/core/scenarios.ts';
import type { Press, ScannerProfile } from '../src/core/types.ts';

const press: Press = {
  id: 'p-smoke',
  name: '冒烟测试机台',
  paperType: 'PT1_PT2_coated',
  controlBar: 'ISO-23',
  createdAt: 0,
};

// 1. 色卡特性化
const t0 = performance.now();
const chart = makeChartSheet(11);
const samples = buildChartSamples(chart.image, cpuBackend);
const trained = trainProfile(samples, 4, '冒烟特性文件');
const profile: ScannerProfile = trained.profile;
console.log(`[1] 特性化完成：${samples.length} 色块，Lab RMSE=${profile.fitResidualLab.toFixed(2)}，耗时 ${(performance.now() - t0).toFixed(0)}ms`);

// 2. 七场景检测
const records = [];
for (const sc of SCENARIOS) {
  const sheet = makeInspectionSheet(sc.bias, 42);
  const out = runInspection(sheet.image, press, profile, cpuBackend, {
    engine: 'cpu',
    scenario: sc.name,
  });
  records.push(out.record);
  const fails = out.record.solidSummary.filter((s) => !(s.passDensity && s.passDeltaE && s.passTvi)).length;
  console.log(`[2] ${sc.name.padEnd(10)} → ${out.record.overallPass ? '合格' : '超差'}，异常墨 ${fails}，建议 ${out.advices.length} 条，${out.record.durationMs.toFixed(0)}ms`);
}

// 3. 历史统计（模拟 store 聚合）
const fails = records.filter((r) => !r.overallPass).length;
const avgMs = records.reduce((s, r) => s + r.durationMs, 0) / records.length;
console.log(`[3] 历史：${records.length} 张，超差 ${fails} 张，平均耗时 ${avgMs.toFixed(0)}ms`);

// 4. 断言关键不变量
const nominal = records[0];
if (!nominal.overallPass) throw new Error('零偏差印张必须判合格');
if (avgMs >= 1000) throw new Error('单张检测必须 <1s');
if (records.some((r) => r.solidSummary.length !== 4)) throw new Error('每印张应有四色实地汇总');
console.log('\n冒烟测试通过：完整工作流运行正常。');
