// 轻量 DOM 构建工具

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

export function h(
  tag: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), v as EventListener);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(c);
  }
  return el;
}

export function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function fmtSigned(n: number, digits = 2): string {
  return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

export function badge(pass: boolean, okText = '合格', ngText = '超差'): HTMLElement {
  return h('span', { class: `badge ${pass ? 'ok' : 'ng'}` }, pass ? okText : ngText);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
