import type { GameState } from '../sim/types';
import type { Quality } from './view';

/** Effets météo plein écran pour les vues 2D / isométrique / hybride. */
export function drawWeather2D(ctx: CanvasRenderingContext2D, s: GameState, w: number, h: number, t: number, q: Quality): void {
  if (!s.settings.weather) return;
  const k = s.weather.current.kind;
  const n = q === 'low' ? 60 : q === 'medium' ? 140 : 260;
  const wind = (s.weather.current.wind / 40) * Math.sin((s.weather.current.windDir * Math.PI) / 180);
  if (k === 'rain' || k === 'thunder' || k === 'storm') {
    ctx.strokeStyle = 'rgba(200,220,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const count = k === 'rain' ? n : n * 1.6;
    for (let i = 0; i < count; i++) {
      const x = (i * 97.3 + t * 0.02 * (1 + wind)) % w;
      const y = (i * 61.7 + t * 0.9) % h;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4 - wind * 10, y + 14);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,40,60,0.18)';
    ctx.fillRect(0, 0, w, h);
  }
  if (k === 'snow' || k === 'blizzard') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const count = k === 'snow' ? n : n * 2;
    for (let i = 0; i < count; i++) {
      const x = (i * 83.1 + Math.sin(t * 0.001 + i) * 20 + t * 0.03 * wind * 5) % w;
      const y = (i * 47.9 + t * (k === 'blizzard' ? 0.25 : 0.08)) % h;
      ctx.fillRect((x + w) % w, y, 2.5, 2.5);
    }
    ctx.fillStyle = k === 'blizzard' ? 'rgba(230,240,255,0.35)' : 'rgba(230,240,255,0.12)';
    ctx.fillRect(0, 0, w, h);
  }
  if (k === 'fog') {
    ctx.fillStyle = 'rgba(220,226,232,0.55)';
    ctx.fillRect(0, 0, w, h);
  } else if (k === 'cloudy') {
    ctx.fillStyle = 'rgba(120,130,150,0.08)';
    ctx.fillRect(0, 0, w, h);
  } else if (k === 'heat') {
    ctx.fillStyle = 'rgba(255,170,60,0.08)';
    ctx.fillRect(0, 0, w, h);
  } else if (k === 'frost') {
    ctx.fillStyle = 'rgba(200,230,255,0.12)';
    ctx.fillRect(0, 0, w, h);
  }
  if ((k === 'thunder' || k === 'storm') && Math.floor(t / 97) % 53 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, 0, w, h);
  }
}
