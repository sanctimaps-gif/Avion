import type { GameState, Pt } from '../sim/types';

/** Contrat commun aux vues graphiques (la vue intérieure est un mode de la vue 3D). */
export type ViewKind = 'top' | '3d' | 'iso' | 'hybrid' | 'inside';

export interface Camera {
  cx: number;
  cy: number;
  /** Pixels par case (2D / iso). */
  zoom: number;
  /** Rotation (radians) — continue en 3D, par quarts de tour en isométrique. */
  rot: number;
  pitch: number;
}

export interface Ghost {
  type: string;
  x: number;
  y: number;
  rot: 0 | 1;
  ok: boolean;
  /** Pour les tracés linéaires : cases et validité. */
  cells?: { p: Pt; ok: boolean }[];
}

export type Quality = 'low' | 'medium' | 'high';

export interface FrameInfo {
  frac: number;
  prev: Map<number, { x: number; y: number; hdg: number; alt: number }>;
  ghost: Ghost | null;
  selectedBuilding: number | null;
  selectedFlight: number | null;
  layers: Set<string>;
  parcelMode: boolean;
  quality: Quality;
  realTime: number;
  /** Vitesse de la simulation (0 = pause). */
  simSpeed?: number;
}

export interface GameView {
  kind: ViewKind;
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, dpr: number): void;
  render(s: GameState, cam: Camera, f: FrameInfo): void;
  /** Coordonnées écran (px CSS) → coordonnées case (flottantes). */
  screenToTile(s: GameState, cam: Camera, x: number, y: number): Pt | null;
  /** Déplacement écran → déplacement caméra. */
  pan(cam: Camera, dx: number, dy: number): void;
  zoom(cam: Camera, factor: number, x: number, y: number, s: GameState): void;
  rotate(cam: Camera, d: number): void;
  dispose(): void;
}

export const ZOOM_MIN = 5;
export const ZOOM_MAX = 80;
