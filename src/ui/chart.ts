import { h } from './dom';

/** Petit graphique en courbe (canvas) pour les tableaux de bord. */
export function sparkline(values: number[], opts: { color?: string; zero?: boolean; label?: string } = {}): HTMLElement {
  const c = h('canvas', { class: 'spark' });
  const draw = () => {
    const w = c.clientWidth || 300;
    const hh = c.clientHeight || 70;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = hh * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hh);
    if (values.length < 2) {
      ctx.fillStyle = '#9fb6d3';
      ctx.font = '12px system-ui';
      ctx.fillText('—', 4, hh / 2);
      return;
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (opts.zero) min = Math.min(0, min);
    if (max === min) max = min + 1;
    const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
    const y = (v: number) => hh - 4 - ((v - min) / (max - min)) * (hh - 18);
    if (opts.zero && min < 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, y(0));
      ctx.lineTo(w, y(0));
      ctx.stroke();
    }
    ctx.strokeStyle = opts.color ?? '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
    ctx.lineTo(x(values.length - 1), hh);
    ctx.lineTo(x(0), hh);
    ctx.closePath();
    ctx.fillStyle = (opts.color ?? '#38bdf8') + '22';
    ctx.fill();
    if (opts.label) {
      ctx.fillStyle = '#9fb6d3';
      ctx.font = '11px system-ui';
      ctx.fillText(opts.label, 4, 11);
    }
  };
  requestAnimationFrame(draw);
  return c;
}
