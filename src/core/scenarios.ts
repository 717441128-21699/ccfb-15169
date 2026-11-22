/** 合成测试印张的墨量偏差场景（覆盖单墨/多墨、正反方向与网点扩大异常） */
import type { InkBias } from './types.ts';

export interface Scenario {
  id: string;
  name: string;
  description: string;
  bias: InkBias;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'nominal',
    name: '标准合格印张',
    description: '零偏差基准，应全部判合格',
    bias: { solidDelta: {}, tviDelta: {} },
  },
  {
    id: 'cyan-high',
    name: '青墨偏浓',
    description: 'C 墨膜增厚约 +0.18D，密度应明显超上限并提示减墨',
    bias: { solidDelta: { C: 0.18 }, tviDelta: {} },
  },
  {
    id: 'magenta-low',
    name: '品红偏淡',
    description: 'M 墨膜减薄约 -0.2D，密度明显不足并提示加墨',
    bias: { solidDelta: { M: -0.2 }, tviDelta: {} },
  },
  {
    id: 'yellow-tvi-high',
    name: '黄墨网点扩大超标',
    description: 'Y 实地正常但 TVI +10 个百分点',
    bias: { solidDelta: {}, tviDelta: { Y: 10 } },
  },
  {
    id: 'black-both',
    name: '黑墨偏浓且网点扩大',
    description: 'K 墨膜 +0.16D 且 TVI +8 个百分点',
    bias: { solidDelta: { K: 0.16 }, tviDelta: { K: 8 } },
  },
  {
    id: 'multi-drift',
    name: '多墨综合漂移',
    description: 'C 偏浓、M 偏淡、Y 网点扩大，模拟长时间未校准',
    bias: { solidDelta: { C: 0.16, M: -0.16 }, tviDelta: { Y: 8 } },
  },
  {
    id: 'global-light',
    name: '整体墨量偏轻',
    description: '四色实地同步减薄 -0.14D',
    bias: {
      solidDelta: { C: -0.14, M: -0.14, Y: -0.14, K: -0.14 },
      tviDelta: {},
    },
  },
];
