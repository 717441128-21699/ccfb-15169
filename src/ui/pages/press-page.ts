/** 机台页：机台增删改、纸张类型与色控条规格、当前选中机台 */
import { h, clear, toast } from '../dom.ts';
import { store } from '../../core/store.ts';
import type { Press } from '../../core/types.ts';

export function renderPressPage(root: HTMLElement): void {
  clear(root);
  const presses = store.getPresses();
  const activeId = store.getActivePressId();

  const list = h('div', { class: 'card' });
  list.append(h('h2', {}, '机台列表'));
  if (presses.length === 0) {
    list.append(h('p', { class: 'muted' }, '尚未配置机台，请在下方添加。'));
  }
  for (const p of presses) {
    const row = h('div', { class: 'row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)' });
    const left = h('div', {},
      h('strong', {}, p.name),
      h('div', { class: 'muted', style: 'font-size:12.5px;margin-top:2px' },
        `${paperLabel(p.paperType)} · 色控条：${p.controlBar}`,
        p.id === activeId ? h('span', { class: 'pill', style: 'margin-left:10px' }, '当前机台') : null,
      ),
    );
    const actions = h('div', { class: 'row' },
      h('button', {
        class: 'btn secondary',
        onclick: () => {
          store.setActivePressId(p.id);
          toast(`已切换到 ${p.name}`);
          renderPressPage(root);
        },
      }, '设为当前'),
      h('button', {
        class: 'btn danger',
        onclick: () => {
          store.savePresses(presses.filter((x) => x.id !== p.id));
          if (activeId === p.id) store.setActivePressId(null);
          renderPressPage(root);
        },
      }, '删除'),
    );
    row.append(left, actions);
    list.append(row);
  }

  // 新增表单
  const nameInput = h('input', { placeholder: '例如：海德堡 CD102 #3' }) as HTMLInputElement;
  const paperSelect = h('select', {},
    h('option', { value: 'PT1_PT2_coated' }, 'PT1/PT2 铜版纸（光面/亚光）'),
    h('option', { value: 'PT4_uncoated' }, 'PT4 非涂布纸'),
  ) as HTMLSelectElement;
  const barSelect = h('select', {},
    h('option', { value: 'ISO-23 块标准色控条' }, 'ISO 23 块标准色控条（默认）'),
  ) as HTMLSelectElement;
  const form = h('div', { class: 'card' },
    h('h2', {}, '新增机台'),
    h('label', { class: 'field' }, h('span', {}, '机台名称'), nameInput),
    h('label', { class: 'field' }, h('span', {}, '纸张类型（决定 ISO 12647 目标值）'), paperSelect),
    h('label', { class: 'field' }, h('span', {}, '色控条规格'), barSelect),
    h('button', {
      class: 'btn',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) return toast('请填写机台名称');
        const press: Press = {
          id: `press-${Date.now()}`,
          name,
          paperType: paperSelect.value as Press['paperType'],
          controlBar: barSelect.value,
          createdAt: Date.now(),
        };
        const all = store.getPresses();
        all.push(press);
        store.savePresses(all);
        if (!store.getActivePressId()) store.setActivePressId(press.id);
        toast('机台已添加');
        renderPressPage(root);
      },
    }, '添加机台'),
  );

  root.append(list, form, isoInfoCard());
}

function paperLabel(t: Press['paperType']): string {
  return t === 'PT4_uncoated' ? 'PT4 非涂布纸' : 'PT1/PT2 铜版纸';
}

function isoInfoCard(): HTMLElement {
  return h('div', { class: 'card' },
    h('h2', {}, '判定依据：ISO 12647-2:2013'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '实地色差'), h('span', {}, 'ΔE00 ≤ 5（内控目标 ≤ 1.5 对应特性化精度）'),
        h('span', { class: 'k' }, '实地密度'), h('span', {}, '按纸张类型目标值，允差 ±0.08D'),
        h('span', { class: 'k' }, '网点扩大 TVI'), h('span', {}, '50% 处目标 ±4 个百分点'),
      ),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '灰平衡'), h('span', {}, 'ΔE00 ≤ 3'),
        h('span', { class: 'k' }, '叠印率'), h('span', {}, '铜版纸 ≥ 80%，非涂布 ≥ 75%'),
        h('span', { class: 'k' }, '测量口径'), h('span', {}, 'Status T 密度，D50/2°，相对纸白'),
      ),
    ),
  );
}
