import { NodeIO } from '@gltf-transform/core';
import { prune, weld, simplify, dedup, textureCompress, flatten, join, center } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const [src, outDir] = process.argv.slice(2);
// nom du nœud → [fichier, ratio de simplification]
const PARTS = {
  '02.ControlTower': ['tour_controle_bs', 1],
  '04.Hangar': ['hangar_bs', 0.6],
  '07.Modulo1': ['terminal_module1_bs', 0.25],
  '07.Modulo2': ['terminal_module2_bs', 0.5],
  '06.Tunnel': ['passerelle_bs', 0.4],
  '18.1.Airplane': ['avion1_bs', 0.25],
  '18.2.Airplane': ['avion2_bs', 0.2],
  '18.3.Airplane': ['avion3_bs', 0.25],
  '18.4.Airplane': ['avion4_bs', 0.25],
  '19.Firetruck': ['pompiers_bs', 0.12],
  '20.PassengerBus': ['bus_bs', 0.15],
  '21.1.BaggageTruck': ['bagages_bs', 0.15],
  '03.AirplaneStairs': ['escalier_bs', 0.2],
  '05.Container': ['conteneur_bs', 0.5],
};
await MeshoptSimplifier.ready;
const io = new NodeIO();
mkdirSync(outDir, { recursive: true });
for (const [nodeName, [file, ratio]] of Object.entries(PARTS)) {
  const doc = await io.read(src);
  const scene = doc.getRoot().getDefaultScene();
  const all = doc.getRoot().listNodes();
  const keep = all.find((n) => n.getName() === nodeName);
  if (!keep) { console.log('absent', nodeName); continue; }
  // Détache la pièce : elle devient la seule racine de la scène, avec sa transformation monde.
  const wm = keep.getWorldMatrix();
  for (const c of scene.listChildren()) scene.removeChild(c);
  keep.getParentNode()?.removeChild(keep);
  keep.setMatrix(wm);
  scene.addChild(keep);
  await doc.transform(
    prune(), dedup(), flatten(), join(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
    center({ pivot: 'below' }),
    textureCompress({ encoder: sharp, targetFormat: 'png', resize: [512, 512] }),
    prune(),
  );
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const path = `${outDir}/${file}.glb`;
  await io.write(path, doc);
  const { statSync } = await import('node:fs');
  console.log(file.padEnd(22), String(Math.round(tris)).padStart(6), 'tris', Math.round(statSync(path).size / 1024), 'Ko');
}
