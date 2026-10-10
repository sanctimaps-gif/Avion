/**
 * Contrôles tactiles (Pointer Events) : un doigt = déplacement,
 * pincement = zoom, rotation à deux doigts, appui court = sélection.
 * Molette / clic droit gérés pour le confort sur ordinateur.
 */
export interface ControlHandlers {
  pan(dx: number, dy: number): void;
  zoom(factor: number, x: number, y: number): void;
  rotate(dAngle: number): void;
  tilt?(d: number): void;
  tap(x: number, y: number): void;
  /** Renvoie true pour capturer le glisser (ex. déplacer un fantôme de construction). */
  dragStart?(x: number, y: number): boolean;
  drag?(x: number, y: number): void;
  dragEnd?(x: number, y: number): void;
  gestureEnd?(): void;
}

export class Controls {
  private pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private moved = false;
  private capturing = false;
  private lastDist = 0;
  private lastAng = 0;
  private lastMid = { x: 0, y: 0 };
  private rightDrag = false;

  constructor(private el: HTMLElement, private h: ControlHandlers) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('pointerleave', this.leave);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.el.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    this.rightDrag = e.button === 2;
    if (this.pts.size === 1) {
      this.moved = false;
      this.capturing = !this.rightDrag && !!this.h.dragStart?.(p.x, p.y);
    } else if (this.pts.size === 2) {
      if (this.capturing) {
        this.capturing = false;
        this.h.dragEnd?.(p.x, p.y);
      }
      const [a, b] = [...this.pts.values()];
      this.lastDist = Math.hypot(b.x - a.x, b.y - a.y);
      this.lastAng = Math.atan2(b.y - a.y, b.x - a.x);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.moved = true;
    }
  };

  private move = (e: PointerEvent) => {
    const pt = this.pts.get(e.pointerId);
    if (!pt) return;
    const p = this.local(e);
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    pt.x = p.x;
    pt.y = p.y;
    if (Math.hypot(p.x - pt.sx, p.y - pt.sy) > 8) this.moved = true;
    if (this.pts.size === 1) {
      if (this.capturing) this.h.drag?.(p.x, p.y);
      else if (this.rightDrag) {
        this.h.rotate(dx * 0.01);
        this.h.tilt?.(dy * 0.005);
      } else if (this.moved) this.h.pan(dx, dy);
    } else if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastDist > 0) this.h.zoom(dist / this.lastDist, mid.x, mid.y);
      let da = ang - this.lastAng;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.h.rotate(da);
      this.h.pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
      this.lastDist = dist;
      this.lastAng = ang;
      this.lastMid = mid;
    }
  };

  private up = (e: PointerEvent) => {
    const pt = this.pts.get(e.pointerId);
    if (!pt) return;
    const p = this.local(e);
    const wasSingle = this.pts.size === 1;
    this.pts.delete(e.pointerId);
    if (wasSingle) {
      if (this.capturing) this.h.dragEnd?.(p.x, p.y);
      else if (!this.moved && !this.rightDrag && performance.now() - pt.t < 600) this.h.tap(p.x, p.y);
      this.capturing = false;
      this.h.gestureEnd?.();
    }
    if (this.pts.size === 1) {
      const rest = [...this.pts.values()][0];
      rest.sx = rest.x;
      rest.sy = rest.y;
    }
  };

  private leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !this.pts.has(e.pointerId)) return;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.h.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
}
