// Parcours tactile de construction dans le jeu compilé (réseau bloqué).
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { serve } from './serve.mjs';

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const out = resolve(process.argv[2] || 'screenshots');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const srv = await serve('.');
await page.route('**/*', (r) => (r.request().url().startsWith(srv.url) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
await page.goto(srv.url);
await page.waitForTimeout(1500);
await page.locator('.viewbar button', { hasText: '2D' }).click();
// Écran de la case (x, y) en vue 2D.
const toScreen = (x, y) => page.evaluate(([x, y]) => { const g = window.game; return { sx: (x - g.cam.cx) * g.cam.zoom + innerWidth / 2, sy: (y - g.cam.cy) * g.cam.zoom + innerHeight / 2 }; }, [x, y]);
const count = () => page.evaluate(() => window.game.s.buildings.length);
const check = (label, cond) => { console.log((cond ? '✔ ' : '✘ ') + label); if (!cond) errors.push(label); };

// 1. Poste S placé au toucher puis validé
const n0 = await count();
await page.evaluate(() => { const g = window.game; g.cam.cx = 46; g.cam.cy = 48; g.cam.zoom = 22; });
await page.locator('.navbtn[data-id="build"]').click();
await page.locator('.build-item', { hasText: 'Poste S' }).click();
let p = await toScreen(47.5, 46.5);
await page.touchscreen.tap(p.sx, p.sy);
await page.waitForTimeout(200);
const ghostOk = await page.evaluate(() => window.game.mode.kind === 'place' && window.game.mode.x === 46 && window.game.mode.y === 45);
check('fantôme positionné au toucher', ghostOk);
await page.screenshot({ path: `${out}/20-ghost.png` });
await page.locator('.placebar .iconbtn.active').click();
await page.waitForTimeout(200);
check('poste construit', (await count()) === n0 + 1);
await page.locator('.placebar .iconbtn', { hasText: '✕' }).click();

// 2. Taxiway tracé en L
const n1 = await count();
await page.locator('.navbtn[data-id="build"]').click();
await page.locator('.build-item', { hasText: 'Taxiway' }).click();
p = await toScreen(51.5, 45.5); await page.touchscreen.tap(p.sx, p.sy);
p = await toScreen(51.5, 49.5); await page.touchscreen.tap(p.sx, p.sy);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/21-line.png` });
await page.locator('.placebar .iconbtn.active').click();
await page.waitForTimeout(200);
check('taxiway tracé (5 cases)', (await count()) === n1 + 5);
await page.locator('.placebar .iconbtn', { hasText: '✕' }).click();

// 3. Sélection d'un bâtiment + amélioration
p = await toScreen(47, 50);
await page.touchscreen.tap(p.sx, p.sy);
await page.waitForTimeout(300);
const selTitle = await page.locator('.panel-head h2').textContent();
check('fiche du café ouverte : ' + selTitle, /Café/.test(selTitle ?? ''));
await page.locator('.panel .btn', { hasText: 'Améliorer' }).click();
await page.waitForTimeout(200);
check('café amélioré', await page.evaluate(() => window.game.s.buildings.find((b) => b.type === 'cafe').level === 2));
await page.screenshot({ path: `${out}/22-selection.png` });

// 4. Déplacement par glisser du fantôme
await page.locator('.panel .btn', { hasText: 'Déplacer' }).click();
const from = await toScreen(47, 50);
const to = await toScreen(47, 53);
const cdp = await ctx.newCDPSession(page);
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.sx, y: q.sy })) });
await touch('touchStart', [from]);
for (let i = 1; i <= 6; i++) await touch('touchMove', [{ sx: from.sx, sy: from.sy + ((to.sy - from.sy) * i) / 6 }]);
await touch('touchEnd', []);
await page.waitForTimeout(200);
const mv = await page.evaluate(() => window.game.mode);
check('fantôme déplacé par glisser (y=' + mv.y + ')', mv.kind === 'move' && mv.y === 52);
await page.locator('.placebar .iconbtn', { hasText: '✕' }).click();

// 5. Pincement pour zoomer
const z0 = await page.evaluate(() => window.game.cam.zoom);
await touch('touchStart', [{ sx: 150, sy: 400 }, { sx: 250, sy: 400 }]);
for (let i = 1; i <= 5; i++) await touch('touchMove', [{ sx: 150 - i * 15, sy: 400 }, { sx: 250 + i * 15, sy: 400 }]);
await touch('touchEnd', []);
const z1 = await page.evaluate(() => window.game.cam.zoom);
check(`zoom par pincement (${z0.toFixed(1)} → ${z1.toFixed(1)})`, z1 > z0 * 1.3);

// 6. Accepter une offre
await page.locator('.navbtn[data-id="airlines"]').click();
const c0 = await page.evaluate(() => window.game.s.contracts.length);
await page.locator('.panel .btn', { hasText: 'Accepter' }).first().click();
check('offre acceptée', (await page.evaluate(() => window.game.s.contracts.length)) === c0 + 1);
await page.screenshot({ path: `${out}/23-fr.png` });

// Mode contrôleur (activé par défaut dans une nouvelle partie) : colonne des vols, ordre de poste
check('mode contrôleur actif', (await page.evaluate(() => window.game.s.settings.control)) === 'manual' && (await page.locator('.strips').isVisible()));
await page.evaluate(() => { const g = window.game; for (let i = 0; i < 4000 && !document.querySelector('.strip.need, .strip.urgent'); i++) { g.clock.advance(g.s, 0.25, undefined, 1); if (i % 20 === 0) g.act(); } });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.strip.need, .strip.urgent')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.standcard:not(.off)')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('.ctl .btn')].find((b) => b.textContent.includes('Confirmer'))?.click());
await page.waitForTimeout(300);
check('poste attribué par le joueur', (await page.evaluate(() => window.game.s.flights.find((f) => f.id === window.game.selectedFlight)?.standId ?? null)) !== null);
await page.screenshot({ path: `${out}/25-controleur.png` });

// Vue intérieure (aérogare en coupe, foule)
await page.keyboard.press('Escape');
await page.locator('.viewbar button', { hasText: 'INT' }).click();
await page.waitForTimeout(2500);
check('vue intérieure active', (await page.evaluate(() => window.game.viewKind)) === 'inside' && (await page.locator('.layers .chip').count()) === 5);
await page.screenshot({ path: `${out}/24-inside.png` });
await page.locator('.viewbar button', { hasText: '3D' }).click();
await page.waitForTimeout(800);
check('retour en 3D depuis l\'intérieur', (await page.evaluate(() => window.game.viewKind)) === '3d');

console.log(errors.length ? 'ERREURS: ' + errors.join(' | ') : 'OK');
await browser.close();
srv.close();
process.exit(errors.length ? 1 : 0);
