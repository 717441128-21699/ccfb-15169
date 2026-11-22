/** DOM 构造助手 */
type AttrValue = string | number | boolean | undefined | Record<string, unknown> | ((ev: Event) => void);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (typeof v !== 'object' && typeof v !== 'function') {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(message: string, ms = 2600): void {
  const t = h('div', { class: 'toast' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function tag(pass: boolean | null, label?: string): HTMLElement {
  if (pass === null) return h('span', { class: 'tag warn' }, label ?? '关注');
  return h(
    'span',
    { class: `tag ${pass ? 'ok' : 'fail'}` },
    label ?? (pass ? '合格' : '超差'),
  );
}

export function swatch(rgb: [number, number, number]): HTMLElement {
  return h('span', {
    class: 'swatch',
    style: `background:rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`,
  });
}
