// Simplification « sloppy » (meshoptimizer) pour les modèles faits de milliers de petites pièces.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld, dedup, flatten, join, center, quantize, textureCompress, compactPrimitive, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';
const [src, out, ratioS, frontX] = process.argv.slice(2);
const ratio = +ratioS;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(prune(), dedup(), flatten(), join());
// Sans normales (et sans UV hors textures), les sommets voisins fusionnent : la simplification n'est plus bloquée par les arêtes vives.
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  p.setAttribute('NORMAL', null);
  if (!p.getMaterial()?.getBaseColorTexture()) p.setAttribute('TEXCOORD_0', null);
}
await doc.transform(weld());
let before = 0, after = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
  const n = idx.getCount(); before += n / 3;
  if (n < 300) { after += n / 3; continue; }
  const src32 = new Uint32Array(idx.getArray());
  const target = Math.max(36, Math.floor((n * ratio) / 3) * 3);
  const scale = MeshoptSimplifier.getScale(new Float32Array(pos.getArray()), 3);
  let res;
  try { res = MeshoptSimplifier.simplify(src32, new Float32Array(pos.getArray()), 3, target, 0.15, ['Prune']); }
  catch { res = MeshoptSimplifier.simplify(src32, new Float32Array(pos.getArray()), 3, target, 0.15, []); }
  const out32 = res[0];
  idx.setArray(new Uint32Array(out32));
  after += out32.length / 3;
  compactPrimitive(p);
}
await doc.transform(normals({ overwrite: true }), center({ pivot: 'below' }), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [256, 256] }), prune(), quantize());
await io.write(out, doc);
console.log(out, Math.round(before), '→', Math.round(after), 'tris', Math.round(statSync(out).size / 1024), 'Ko');
