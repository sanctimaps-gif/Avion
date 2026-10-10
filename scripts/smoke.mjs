// Test de fumée : ouvre le jeu compilé (fichier unique) dans Chromium avec
// le réseau totalement bloqué, vérifie le démarrage direct, les 4 vues,
// les panneaux et la sauvegarde, et enregistre des captures d'écran.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const out = resolve(process.argv[2] || 'screenshots');
mkdirSync(out, { recursive: true });
const url = 'file://' + resolve('dist/index.html');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  requests.push(u);
  return route.abort();
});
await page.goto(url);
await page.waitForTimeout(2500);
const hasCanvas = await page.evaluate(() => !!document.querySelector('#stage canvas'));
const title = await page.evaluate(() => document.querySelector('.topbar .name')?.textContent);
console.log('canvas:', hasCanvas, '| airport:', title);
await page.screenshot({ path: `${out}/01-iso.png` });
// Accélère le temps pour voir des avions.
await page.evaluate(() => { const g = window.game; g.clock.speed = 4; for (let i = 0; i < 2; i++) g.clock.advance(g.s, 0.25); g.clock.speed = 1; });
await page.waitForTimeout(400);
for (const [label, file] of [['2D', '02-2d'], ['3D', '03-3d'], ['HYB', '04-hybrid'], ['ISO', '05-iso']]) {
  await page.locator('.viewbar button', { hasText: label }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${file}.png` });
}
for (const [id, file] of [['build', '06-build'], ['flights', '07-flights'], ['airlines', '08-airlines'], ['finance', '09-finance'], ['staff', '10-staff'], ['incidents', '11-incidents'], ['research', '12-research'], ['progress', '13-progress']]) {
  await page.locator(`.navbtn[data-id="${id}"]`).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${file}.png` });
}
await page.locator('.navbtn[data-id="progress"]').click();
// Construction : sélectionne un café puis valide
await page.locator('.navbtn[data-id="build"]').click();
await page.locator('.tab', { hasText: /Commerces|Retail/ }).click();
await page.locator('.build-item', { hasText: /Café/ }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/14-placement.png` });
await page.locator('.iconbtn', { hasText: '✕' }).last().click();
// Sauvegarde + menu des parties
await page.locator('.topbar .iconbtn').first().click();
await page.locator('.build-item', { hasText: /Sauvegarder|Save now/ }).click();
await page.waitForTimeout(500);
await page.locator('.build-item', { hasText: /Mes parties|My games/ }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/15-saves.png` });
const slots = await page.locator('.slot').count();
console.log('save slots:', slots);
// Rechargement : la partie doit reprendre directement
await page.reload();
await page.waitForTimeout(2000);
const day = await page.evaluate(() => window.game.s.time);
console.log('time after reload:', day);
await page.screenshot({ path: `${out}/16-reload.png` });
// Paysage
await page.setViewportSize({ width: 915, height: 412 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/17-landscape.png` });
console.log('external requests:', requests.length ? requests : 'none');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length || requests.length || !hasCanvas) process.exit(1);
