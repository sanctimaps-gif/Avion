/** Destinations (villes réelles, données géographiques approximatives). */
export interface DestDef {
  id: string;
  city: string;
  code: string;
  dist: number; // km depuis l'aéroport du joueur (monde fictif)
  demand: number; // demande relative
  intl: boolean;
  tier: number;
}

const L: DestDef[] = [
  { id: 'lyo', city: 'Lyon', code: 'LYO', dist: 420, demand: 1, intl: false, tier: 0 },
  { id: 'mrs', city: 'Marseille', code: 'MRS', dist: 600, demand: 1.1, intl: false, tier: 0 },
  { id: 'bod', city: 'Bordeaux', code: 'BOD', dist: 500, demand: 0.9, intl: false, tier: 0 },
  { id: 'nce', city: 'Nice', code: 'NCE', dist: 680, demand: 1.1, intl: false, tier: 0 },
  { id: 'tls', city: 'Toulouse', code: 'TLS', dist: 580, demand: 0.95, intl: false, tier: 0 },
  { id: 'nte', city: 'Nantes', code: 'NTE', dist: 380, demand: 0.8, intl: false, tier: 0 },
  { id: 'par', city: 'Paris', code: 'PAR', dist: 350, demand: 1.6, intl: false, tier: 0 },
  { id: 'ajc', city: 'Ajaccio', code: 'AJC', dist: 880, demand: 0.8, intl: false, tier: 1 },
  { id: 'bru', city: 'Bruxelles', code: 'BRU', dist: 520, demand: 1, intl: true, tier: 1 },
  { id: 'gva', city: 'Genève', code: 'GVA', dist: 450, demand: 0.9, intl: true, tier: 1 },
  { id: 'lon', city: 'Londres', code: 'LON', dist: 700, demand: 1.5, intl: true, tier: 2 },
  { id: 'mad', city: 'Madrid', code: 'MAD', dist: 1050, demand: 1.2, intl: true, tier: 2 },
  { id: 'bcn', city: 'Barcelone', code: 'BCN', dist: 820, demand: 1.3, intl: true, tier: 2 },
  { id: 'rom', city: 'Rome', code: 'ROM', dist: 1100, demand: 1.2, intl: true, tier: 2 },
  { id: 'ams', city: 'Amsterdam', code: 'AMS', dist: 800, demand: 1.1, intl: true, tier: 2 },
  { id: 'lis', city: 'Lisbonne', code: 'LIS', dist: 1450, demand: 1.1, intl: true, tier: 2 },
  { id: 'ber', city: 'Berlin', code: 'BER', dist: 1050, demand: 1.1, intl: true, tier: 3 },
  { id: 'ath', city: 'Athènes', code: 'ATH', dist: 2100, demand: 1, intl: true, tier: 3 },
  { id: 'ist', city: 'Istanbul', code: 'IST', dist: 2300, demand: 1.3, intl: true, tier: 3 },
  { id: 'cmn', city: 'Casablanca', code: 'CMN', dist: 1900, demand: 1.1, intl: true, tier: 3 },
  { id: 'tun', city: 'Tunis', code: 'TUN', dist: 1500, demand: 1, intl: true, tier: 3 },
  { id: 'dxb', city: 'Dubaï', code: 'DXB', dist: 5200, demand: 1.4, intl: true, tier: 4 },
  { id: 'nyc', city: 'New York', code: 'NYC', dist: 5900, demand: 1.6, intl: true, tier: 4 },
  { id: 'yul', city: 'Montréal', code: 'YUL', dist: 5600, demand: 1.2, intl: true, tier: 4 },
  { id: 'dkr', city: 'Dakar', code: 'DKR', dist: 4200, demand: 1, intl: true, tier: 4 },
  { id: 'cai', city: 'Le Caire', code: 'CAI', dist: 3200, demand: 1, intl: true, tier: 4 },
  { id: 'sin', city: 'Singapour', code: 'SIN', dist: 10700, demand: 1.3, intl: true, tier: 5 },
  { id: 'tyo', city: 'Tokyo', code: 'TYO', dist: 9800, demand: 1.4, intl: true, tier: 5 },
  { id: 'gru', city: 'São Paulo', code: 'GRU', dist: 9400, demand: 1.2, intl: true, tier: 5 },
  { id: 'lax', city: 'Los Angeles', code: 'LAX', dist: 9100, demand: 1.3, intl: true, tier: 5 },
  { id: 'hkg', city: 'Hong Kong', code: 'HKG', dist: 9600, demand: 1.3, intl: true, tier: 5 },
  { id: 'syd', city: 'Sydney', code: 'SYD', dist: 14500, demand: 1.1, intl: true, tier: 6 },
  { id: 'jnb', city: 'Johannesburg', code: 'JNB', dist: 8700, demand: 1, intl: true, tier: 6 },
];

export const DESTINATIONS: Record<string, DestDef> = Object.fromEntries(L.map((d) => [d.id, d]));
export const DEST_LIST = L;
