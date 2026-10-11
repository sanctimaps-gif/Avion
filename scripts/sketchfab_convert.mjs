// Conversion des modèles Sketchfab (lot 3) : simplification, textures réduites, mise à l'échelle.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld, simplify, dedup, flatten, join, center, quantize, textureCompress, normals, compactPrimitive, getBounds, unpartition, mergeDocuments } from '@gltf-transform/functions';
import { getBounds as gb } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const [inDir, outDir, only] = process.argv.slice(2);
// ratio : part de triangles gardée ; tex : taille max des textures ; loose : simplification sans normales
// len : longueur cible en mètres selon l'axe long (véhicules) ; rotY : rotation (rad) ; copies : [n, pas en m] le long de X
const JOBS = {
  // Mobilier de la vue intérieure (Airport Pack Total), couleurs de sommets
  int_comptoir: { src: 'comptoir.glb', ratio: 0.12, tex: 64, loose: true, bake: true, err: 0.05 },
  int_surete: { src: 'surete.glb', ratio: 0.1, tex: 64, loose: true, bake: true, err: 0.05 },
  int_sieges: { src: 'sieges.glb', ratio: 0.035, tex: 64, loose: true, bake: true, err: 0.05 },
  int_porte: { src: 'porte.glb', ratio: 0.15, tex: 64, loose: true, bake: true, err: 0.05 },
  int_kiosque: { src: 'kiosque.glb', ratio: 0.1, tex: 64, loose: true, bake: true, err: 0.05 },
  int_poubelle: { src: 'poubelle.glb', ratio: 0.4, tex: 64, loose: true, bake: true, err: 0.05 },
  int_pub: { src: 'pub.glb', ratio: 0.25, tex: 64, loose: true, bake: true, err: 0.05 },
  int_panneau: { src: 'panneau.glb', ratio: 0.35, tex: 64, loose: true, bake: true, err: 0.05 },
  int_dab: { src: 'dab.glb', ratio: 0.4, tex: 64, loose: true, bake: true, err: 0.05 },
  int_plante: { src: 'plante.glb', ratio: 0.06, tex: 64, loose: true, bake: true, err: 0.05 },
  int_poteau: { src: 'poteau.glb', ratio: 0.5, tex: 64, loose: true, bake: true, err: 0.05 },
  int_valise: { src: 'valise.glb', ratio: 0.08, tex: 64, loose: true, bake: true, err: 0.05 },

  // Lot 5 (exp5 : exports GLB)
  q400: { src: 'q400.glb', ratio: 0.5, tex: 1024, swapTex: ['livery_Body.png', 'livery_Wings.png', 'livery_Engine.png'].map((f) => '../pack5/bombardier-dash-q400-qantas-link/textures/' + f) },
  tapis_bagages: { src: 'belt.glb', ratio: 1, tex: 256, len: 8 },
  catering: { src: 'catering.glb', ratio: 0.08, tex: 256, loose: true, len: 9, metal: true, flip: true, recolor: { M_Glass: [0.06, 0.09, 0.15], M_Mirror: [0.2, 0.2, 0.22] } },
  voiture_s13: { src: 'nissan.glb', ratio: 0.012, tex: 256, loose: true, len: 4.5, flip: true, rename: { 'Primary Body Paint': 'red' } },
  // Lot 4 (dossier exp4 : exports GLB des fichiers OBJ/DAE/FBX)
  a380: { src: 'a380.glb', ratio: 0.015, tex: 512, loose: true, bake: true },
  entrepot: { src: 'entrepot.glb', ratio: 0.1, tex: 256, loose: true },
  centrale: { src: 'centrale.glb', ratio: 0.12, tex: 256, loose: true, bake: true, ground: 0, minZ: -21 },
  immeuble: { src: 'immeuble.glb', ratio: 0.06, tex: 256, loose: true, bake: true },
  solaire: { src: 'solaire.glb', ratio: 0.15, tex: 256, loose: true },
  station: { src: 'station.glb', ratio: 0.08, tex: 256, loose: true, bake: true },
  hangar_fret: { src: 'hangar_src.glb', ratio: 1, tex: 256, drop: /^(Plane_Body|Body_Plane|cardboard|Tape|0046_Gold|edge_color|Steel_Roughness)/ },
  boutique: { src: 'corner_shop__stylized_tier_i/scene.gltf', ratio: 0.01, tex: 512, loose: true, bake: true },
  cafe: { src: 'caffe_bernini/f1fb4934-caffe_bernini.glb', ratio: 0.12, err: 0.05, loose: true, bake: true, bakeEmissive: true, gain: 2.2, tex: 512, drop: /^(Inside|Stuff|Glass|Aeropress)/ },
  hors_taxes: { src: 'woolworths_big_w_australian_commercial_building/4a4ba12e-woolworths_big_w_australian_commercial_building.glb', ratio: 0.5, tex: 256 },
  batiment_marin: { src: 'batiment_marin/3b12e63d-batiment_marin.glb', ratio: 0.08, tex: 512, loose: true },
  parking: { src: 'modern_parking_area/scene.gltf', ratio: 1, tex: 512, drop: /^Props_Atlas/ },
  abribus: { src: 'abribus_bus_stop_bus_station/scene.gltf', ratio: 0.5, tex: 256, copies: [3, 4] },
  gare: { src: 'train_station/scene.gltf', ratio: 0.012, tex: 256, loose: true, align: true },
  foret: { src: 'forest/scene.gltf', ratio: 0.2, tex: 256, drop: /^(Floor|Kust|Paporotnik)/ },
  bus_ville: { src: 'japanese_bus_nagoya_city_bus_aichi/scene.gltf', ratio: 1, tex: 512, len: 11 },
  police: { src: 'police_car/scene.gltf', ratio: 0.015, tex: 256, loose: true, len: 4.9 },
  train_sf: { src: 'train/scene.gltf', ratio: 0.2, tex: 256, len: 20.5, metal: true, copies: [3, 0.3, 2], frontAtOrigin: true },
};
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(outDir, { recursive: true });
const triCount = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3; return Math.round(t); };
for (const [out, j] of Object.entries(JOBS)) {
  if (only && !only.split(',').includes(out)) continue;
  const doc = await io.read(`${inDir}/${j.src}`);
  // Nuages de points et lignes : supprimés.
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (p.getMode() !== 4) p.dispose();
  if (j.rename) for (const m of doc.getRoot().listMaterials()) if (j.rename[m.getName()]) m.setName(j.rename[m.getName()]);
  if (j.recolor) for (const m of doc.getRoot().listMaterials()) if (j.recolor[m.getName()]) m.setBaseColorFactor([...j.recolor[m.getName()], 1]);
  if (j.drop) for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (j.drop.test(p.getMaterial()?.getName() ?? '')) p.dispose();
  if (j.ground !== undefined) {
    // Parties souterraines et grand sol plat retirés (le sol du jeu les remplace).
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue; const wm = node.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const a = p.getAttribute('POSITION'); let lo = 1e9, hi = -1e9, zlo = 1e9; const v = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); const y = wm[1] * v[0] + wm[5] * v[1] + wm[9] * v[2] + wm[13]; lo = Math.min(lo, y); hi = Math.max(hi, y); zlo = Math.min(zlo, wm[2] * v[0] + wm[6] * v[1] + wm[10] * v[2] + wm[14]); }
        const n = (p.getIndices()?.getCount() ?? a.getCount()) / 3;
        if (lo < j.ground - 0.5 || (hi - lo < 0.05 && n > 10000) || (j.minZ !== undefined && zlo < j.minZ)) p.dispose();
      }
    }
  }
  const before = triCount(doc);
  await doc.transform(prune(), dedup(), flatten(), join());
  if (j.metal) for (const mt of doc.getRoot().listMaterials()) { mt.setMetallicFactor(Math.min(mt.getMetallicFactor(), 0.2)); mt.setMetallicRoughnessTexture(null); }
  if (j.bake) {
    // Photogrammétrie : la texture est échantillonnée en couleurs de sommets, puis UV et texture supprimées
    // (les coutures d'UV bloqueraient la simplification).
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const mt = p.getMaterial(); const sg = mt?.getExtension('KHR_materials_pbrSpecularGlossiness');
      const tex = (j.bakeEmissive && mt?.getEmissiveTexture()) || (mt?.getBaseColorTexture() ?? sg?.getDiffuseTexture() ?? mt?.getEmissiveTexture()); const uv = p.getAttribute('TEXCOORD_0');
      if (!tex || !uv) continue;
      const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const n = uv.getCount(); const col = new Float32Array(n * 3); const t = [0, 0];
      const lin = (c) => { c /= 255; return Math.min(1, (j.gain ?? 1) * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); };
      for (let i = 0; i < n; i++) {
        uv.getElement(i, t);
        const x = Math.min(info.width - 1, Math.max(0, Math.floor((t[0] - Math.floor(t[0])) * info.width)));
        const y = Math.min(info.height - 1, Math.max(0, Math.floor((t[1] - Math.floor(t[1])) * info.height)));
        const o = (y * info.width + x) * 3;
        col[i * 3] = lin(data[o]); col[i * 3 + 1] = lin(data[o + 1]); col[i * 3 + 2] = lin(data[o + 2]);
      }
      p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(uv.getBuffer()));
      p.setAttribute('TEXCOORD_0', null); mt.setBaseColorTexture(null); mt.setEmissiveTexture(null); mt.setEmissiveFactor([0, 0, 0]);
      if (sg) { mt.setExtension('KHR_materials_pbrSpecularGlossiness', null); mt.setRoughnessFactor(0.85); mt.setMetallicFactor(0); }
      mt.setExtension('KHR_materials_emissive_strength', null);
      // Fusion par position seule (les couleurs de part et d'autre d'une couture diffèrent un peu).
      const pos = p.getAttribute('POSITION'); const idx = p.getIndices(); const map = new Map(); const remap = new Uint32Array(pos.getCount()); const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const k = v.map((c) => Math.round(c * 1e5)).join(','); if (!map.has(k)) map.set(k, i); remap[i] = map.get(k); }
      const arr = new Uint32Array(idx.getCount()); for (let i = 0; i < arr.length; i++) arr[i] = remap[idx.getScalar(i)];
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(idx.getBuffer()));
    }
  }
  if (j.loose) {
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      p.setAttribute('NORMAL', null); p.setAttribute('TANGENT', null);
      if (!p.getMaterial()?.getBaseColorTexture()) p.setAttribute('TEXCOORD_0', null);
    }
    for (const mt of doc.getRoot().listMaterials()) mt.setNormalTexture(null);
    await doc.transform(weld());
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(); const n = idx.getCount(); if (n < 300) continue;
      const pos = new Float32Array(p.getAttribute('POSITION').getArray());
      const target = Math.max(36, Math.floor((n * j.ratio) / 3) * 3);
      let res;
      try { res = MeshoptSimplifier.simplify(new Uint32Array(idx.getArray()), pos, 3, target, j.err ?? 0.2, j.noPrune ? [] : ['Prune']); }
      catch { res = MeshoptSimplifier.simplify(new Uint32Array(idx.getArray()), pos, 3, target, 0.2, []); }
      idx.setArray(new Uint32Array(res[0])); compactPrimitive(p);
    }
    await doc.transform(normals({ overwrite: true }));
  } else if (j.ratio < 1) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: j.ratio, error: j.err ?? 0.02 }));
  }
  for (const mt of doc.getRoot().listMaterials()) { mt.setNormalTexture(null); mt.setOcclusionTexture(null); }
  const sc = doc.getRoot().getDefaultScene();
  if (j.align) {
    // Modèle tourné dans son fichier : axe principal (ACP sur X/Z) aligné sur Z.
    let n = 0, mx = 0, mz = 0, sxx = 0, szz = 0, sxz = 0; const pts = [];
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue; const wm = node.getWorldMatrix();
      for (const p of mesh.listPrimitives()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i += 7) { a.getElement(i, v); const x = wm[0] * v[0] + wm[4] * v[1] + wm[8] * v[2] + wm[12]; const z = wm[2] * v[0] + wm[6] * v[1] + wm[10] * v[2] + wm[14]; pts.push([x, z]); } }
    }
    for (const [x, z] of pts) { mx += x; mz += z; n++; } mx /= n; mz /= n;
    for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // direction principale (depuis +X)
    const rot = Math.PI / 2 - ang; // la ramener sur +Z : rotation autour de Y
    const pivot = doc.createNode('align').setRotation([0, Math.sin(-rot / 2), 0, Math.cos(-rot / 2)]);
    for (const c of sc.listChildren()) { sc.removeChild(c); pivot.addChild(c); }
    sc.addChild(pivot); await doc.transform(flatten());
    console.log('  alignement', (ang * 180 / Math.PI).toFixed(1), '°');
  }
  // Axe long horizontal → Z (convention véhicules), puis échelle en mètres.
  const b0 = gb(sc); const sx = b0.max[0] - b0.min[0], sz = b0.max[2] - b0.min[2];
  if (j.len) {
    const pivot = doc.createNode('pivot');
    const long = Math.max(sx, sz); const s = j.len / long;
    pivot.setScale([s, s, s]);
    // Axe long → Z ; `flip` : demi-tour (avant du véhicule vers +Z).
    const q1 = sx > sz ? [0, Math.SQRT1_2, 0, Math.SQRT1_2] : [0, 0, 0, 1];
    pivot.setRotation(j.flip ? [0, q1[3], 0, -q1[1]] : q1);
    for (const n of sc.listChildren()) { sc.removeChild(n); pivot.addChild(n); }
    sc.addChild(pivot);
    await doc.transform(flatten());
  }
  await doc.transform(center({ pivot: 'below' }));
  if (j.copies) {
    const [n, step, axis = 0] = j.copies; const kids = sc.listChildren(); const w = (gb(sc).max[axis] - gb(sc).min[axis]) + step;
    for (let k = 1; k < n; k++) for (const c of kids) { const cl = doc.createNode(c.getName()).setMesh(c.getMesh()).setMatrix(c.getMatrix()); const t = cl.getTranslation(); t[axis] -= k * w; cl.setTranslation(t); sc.addChild(cl); }
    await doc.transform(center({ pivot: 'below' }));
    if (j.frontAtOrigin) { const zmax = gb(sc).max[2]; for (const c of sc.listChildren()) { const t = c.getTranslation(); c.setTranslation([t[0], t[1], t[2] - zmax]); } }
  }
  await doc.transform(textureCompress({ encoder: sharp, resize: [j.tex, j.tex] }), ...(j.swapTex ? [] : [textureCompress({ encoder: sharp, targetFormat: 'jpeg' })]), prune(), quantize());
  // (après la compression : celle-ci retirerait l'alpha d'un matériau opaque)
  if (j.swapTex) {
    // Textures RGBA (masque de livrée dans l'alpha) : le navigateur les a exportées sans alpha ;
    // chaque texture est remplacée par le fichier d'origine dont la couleur moyenne est la plus proche.
    const files = await Promise.all(j.swapTex.map(async (f) => ({ f, buf: await readFile(f), mean: (await sharp(f).removeAlpha().stats()).channels.map((c) => c.mean) })));
    for (const tx of doc.getRoot().listTextures()) {
      const st = await sharp(Buffer.from(tx.getImage())).removeAlpha().stats();
      const m = st.channels.map((c) => c.mean);
      let best = null, bd = Infinity;
      for (const c of files) { const d = [0, 1, 2].reduce((a, i) => a + (c.mean[i] - m[i]) ** 2, 0); if (d < bd) { bd = d; best = c; } }
      if (best && bd < 400) { tx.setImage(new Uint8Array(best.buf)); tx.setMimeType('image/png'); }
    }
  }
  const path = `${outDir}/${out}.glb`;
  await io.write(path, doc);
  const b = gb(doc.getRoot().getDefaultScene());
  console.log(out.padEnd(16), String(before).padStart(8), '→', String(triCount(doc)).padStart(6), 'tris', String(Math.round(statSync(path).size / 1024)).padStart(5), 'Ko', b.max.map((v, i) => +(v - b.min[i]).toFixed(1)).join('×'));
}
