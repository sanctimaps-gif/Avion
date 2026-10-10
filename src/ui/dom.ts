/** Mini-utilitaire de création d'éléments DOM (sans dépendance). */
type Attrs = Record<string, unknown> & { class?: string; style?: string; onclick?: (e: MouseEvent) => void };
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function btn(label: Child, onclick: () => void, cls = '', disabled = false, title?: string): HTMLButtonElement {
  return h('button', { class: 'btn ' + cls, onclick: (e: MouseEvent) => { e.stopPropagation(); onclick(); }, disabled, title }, label);
}

export function bar(v: number, color?: string): HTMLElement {
  const pct = Math.max(0, Math.min(1, v)) * 100;
  return h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${pct}%;${color ? 'background:' + color : ''}` }));
}

export function kv(k: Child, v: Child, cls = ''): HTMLElement {
  return h('div', { class: 'kv ' + cls }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
}

export function section(title: Child, ...children: Child[]): HTMLElement {
  return h('section', { class: 'sec' }, h('h3', null, title), ...children);
}

export function tabs(items: { id: string; label: string }[], active: string, onSelect: (id: string) => void): HTMLElement {
  return h('div', { class: 'tabs' }, items.map((it) => h('button', { class: 'tab' + (it.id === active ? ' active' : ''), onclick: () => onSelect(it.id) }, it.label)));
}
