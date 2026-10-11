import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld, simplify, dedup, textureCompress, flatten, join, center, quantize, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync, mkdirSync } from 'node:fs';
const [inDir, outDir] = process.argv.slice(2);
const A330 = process.argv[4];
// source → [sortie, ratio, taille max texture, format]
const JOBS = {
  terminal_pack1: ['terminal_pack1', 0.35, 256, 'png', 0.05],
  terminal_pack2: ['terminal_pack2', 0.6, 256, 'png'],
  escalier_pack: ['escalier_pack', 0.4, 256, 'png'],
  camion_pompiers_pack: ['camion_pompiers_pack', 0.15, 256, 'png'],
  bus_pack: ['bus_piste_pack', 0.3, 256, 'png'],
  train_bagages_pack: ['train_bagages_pack', 0.18, 256, 'png'],

  a330: ['a330', 0.45, 1024, 'jpeg'],
};
const FRONT_X = new Set(['camion_pompiers_pack', 'bus_piste_pack', 'train_bagages_pack']);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(outDir, { recursive: true });
for (const [src, [out, ratio, tex, fmt, err = 0.02]] of Object.entries(JOBS)) {
  const path = src === 'a330' ? A330 : `${inDir}/${src}.glb`;
  let doc;
  if (src === 'train_bagages_pack') {
    // Tracteur en tête (+X), puis deux chariots.
    doc = await io.read(`${inDir}/tracteur_pack.glb`);
    const parts = [['chariot2_pack', -7.2], ['chariot_pack', -14.3]];
    for (const [f, dx] of parts) {
      const other = await io.read(`${inDir}/${f}.glb`);
      const map = mergeDocuments(doc, other);
      for (const sc of other.getRoot().listScenes()) {
        const msc = map.get(sc);
        for (const n of msc.listChildren()) { n.setTranslation([n.getTranslation()[0] + dx, n.getTranslation()[1], n.getTranslation()[2]]); doc.getRoot().getDefaultScene().addChild(n); }
        msc.dispose();
      }
    }
    await doc.transform(unpartition());
  } else doc = await io.read(path);
  let before = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) before += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  await doc.transform(
    prune(), dedup(), flatten(), join(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: err }),
    center({ pivot: 'below' }),
    textureCompress({ encoder: sharp, targetFormat: fmt, resize: [tex, tex] }),
    prune(),
  );
  if (FRONT_X.has(out)) {
    // Avant du véhicule : +X → +Z (convention du jeu).
    const sc = doc.getRoot().getDefaultScene();
    const pivot = doc.createNode('pivot').setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]);
    for (const n of sc.listChildren()) { sc.removeChild(n); pivot.addChild(n); }
    sc.addChild(pivot);
    await doc.transform(flatten());
  }
  await doc.transform(quantize());
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const o = `${outDir}/${out}.glb`;
  await io.write(o, doc);
  console.log(out.padEnd(22), String(Math.round(before)).padStart(7), '→', String(Math.round(tris)).padStart(6), 'tris', Math.round(statSync(o).size / 1024), 'Ko', doc.getRoot().listMaterials().length, 'mat');
}
