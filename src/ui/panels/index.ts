import type { App } from '../app';
import { buildPanel } from './build';
import { flightsPanel } from './flights';
import { airlinesPanel } from './airlines';
import { financePanel } from './finance';
import { staffPanel } from './staff';
import { incidentsPanel } from './incidents';
import { researchPanel } from './research';
import { progressPanel } from './progress';
import { menuPanel, savesPanel, newGamePanel, settingsPanel, logPanel } from './menu';

/** Registre des écrans de gestion. */
export type PanelId =
  | 'build' | 'flights' | 'airlines' | 'finance' | 'staff' | 'incidents' | 'research' | 'progress'
  | 'menu' | 'saves' | 'newgame' | 'settings' | 'log' | 'selection';

export const PANELS: Record<PanelId, { title: string; tall?: boolean }> = {
  build: { title: 'nav.build' },
  flights: { title: 'panel.flights', tall: true },
  airlines: { title: 'panel.airlines', tall: true },
  finance: { title: 'panel.finance', tall: true },
  staff: { title: 'panel.staff', tall: true },
  incidents: { title: 'panel.incidents', tall: true },
  research: { title: 'panel.research', tall: true },
  progress: { title: 'panel.progress', tall: true },
  menu: { title: 'menu.title' },
  saves: { title: 'menu.saves', tall: true },
  newgame: { title: 'menu.new', tall: true },
  settings: { title: 'menu.settings', tall: true },
  log: { title: 'menu.log', tall: true },
  selection: { title: '' },
};

export function renderPanel(id: PanelId, app: App): HTMLElement {
  switch (id) {
    case 'build': return buildPanel(app);
    case 'flights': return flightsPanel(app);
    case 'airlines': return airlinesPanel(app);
    case 'finance': return financePanel(app);
    case 'staff': return staffPanel(app);
    case 'incidents': return incidentsPanel(app);
    case 'research': return researchPanel(app);
    case 'progress': return progressPanel(app);
    case 'menu': return menuPanel(app);
    case 'saves': return savesPanel(app);
    case 'newgame': return newGamePanel(app);
    case 'settings': return settingsPanel(app);
    case 'log': return logPanel(app);
    default: return document.createElement('div');
  }
}
