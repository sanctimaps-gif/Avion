"""Génère des modèles 3D low-poly (.glb) pour un jeu d'aéroport.

Aucune dépendance hormis numpy. Unités : mètres, Y vers le haut,
avant des avions vers +Z. Chaque pièce est un nœud séparé (les hélices
ont leur pivot au moyeu pour pouvoir tourner).

Usage : python generate_assets.py [dossier_sortie]
"""
import json, math, os, struct, sys
import numpy as np

# ---------------------------------------------------------------- palette
PALETTE = {
    "concrete":   ((0.78, 0.77, 0.74), 0.0, 0.9),
    "concrete_d": ((0.55, 0.55, 0.53), 0.0, 0.9),
    "white":      ((0.94, 0.94, 0.95), 0.0, 0.6),
    "glass":      ((0.33, 0.55, 0.72), 0.3, 0.2),
    "glass_d":    ((0.12, 0.18, 0.25), 0.3, 0.2),
    "metal":      ((0.60, 0.64, 0.68), 0.6, 0.4),
    "metal_d":    ((0.30, 0.33, 0.36), 0.6, 0.5),
    "roof":       ((0.42, 0.45, 0.48), 0.1, 0.8),
    "red":        ((0.80, 0.14, 0.12), 0.0, 0.6),
    "orange":     ((0.95, 0.52, 0.10), 0.0, 0.6),
    "yellow":     ((0.95, 0.80, 0.15), 0.0, 0.6),
    "blue":       ((0.12, 0.32, 0.65), 0.0, 0.6),
    "navy":       ((0.08, 0.14, 0.32), 0.0, 0.6),
    "green":      ((0.25, 0.55, 0.30), 0.0, 0.8),
    "asphalt":    ((0.22, 0.22, 0.24), 0.0, 0.95),
    "rubber":     ((0.08, 0.08, 0.09), 0.0, 0.9),
    "brick":      ((0.62, 0.33, 0.25), 0.0, 0.9),
}

# ---------------------------------------------------------------- géométrie
def rot(axis, ang):
    c, s = math.cos(ang), math.sin(ang)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _orient(t, ref):
    a, b, c = t
    n = np.cross(b - a, c - a)
    if np.linalg.norm(n) < 1e-9:
        return None
    return [a, c, b] if np.dot(n, (a + b + c) / 3 - ref) < 0 else [a, b, c]


def loft(rings, cap=True):
    """Relie des anneaux convexes successifs (même nb de points) en un solide."""
    rings = [np.asarray(r, float) for r in rings]
    cents = [r.mean(axis=0) for r in rings]
    n = len(rings[0])
    out = []
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        ref = (cents[k] + cents[k + 1]) / 2
        for i in range(n):
            j = (i + 1) % n
            for t in ([A[i], A[j], B[j]], [A[i], B[j], B[i]]):
                o = _orient(t, ref)
                if o:
                    out.append(o)
    if cap:
        for idx, other in ((0, 1), (-1, -2)):
            R, c = rings[idx], cents[idx]
            for i in range(n):
                o = _orient([c, R[i], R[(i + 1) % n]], cents[other])
                if o:
                    out.append(o)
    return out


def ring(center, axis, r, n=12, ry=None, phase=0.0):
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis)
    up = np.array([0, 1.0, 0]) if abs(axis[1]) < 0.9 else np.array([0, 0, 1.0])
    u = np.cross(up, axis); u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ry = r if ry is None else ry
    c = np.asarray(center, float)
    return [c + r * math.cos(phase + 2 * math.pi * i / n) * u
              + ry * math.sin(phase + 2 * math.pi * i / n) * v for i in range(n)]


def cyl(p0, p1, r0, r1=None, n=12, phase=0.0):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ax = p1 - p0
    return loft([ring(p0, ax, r0, n, phase=phase),
                 ring(p1, ax, r0 if r1 is None else r1, n, phase=phase)])


def box(center, size, R=None, pivot=None):
    cx, cy, cz = center; sx, sy, sz = (s / 2 for s in size)
    bot = [(cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
           (cx + sx, cy - sy, cz + sz), (cx - sx, cy - sy, cz + sz)]
    top = [(x, cy + sy, z) for x, _, z in bot]
    rings = [np.array(bot, float), np.array(top, float)]
    if R is not None:
        pv = np.asarray(center if pivot is None else pivot, float)
        rings = [(r - pv) @ R.T + pv for r in rings]
    return loft(rings)


def boxmm(x0, y0, z0, x1, y1, z1):
    return box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
               (x1 - x0, y1 - y0, z1 - z0))


# ---------------------------------------------------------------- modèle
class Model:
    def __init__(self, name):
        self.name, self.parts = name, {}

    def add(self, tris, color, part="body", origin=None):
        p = self.parts.setdefault(part, {"origin": np.zeros(3), "tris": {}})
        if origin is not None:
            p["origin"] = np.asarray(origin, float)
        p["tris"].setdefault(color, []).extend(tris)

    def bounds(self):
        pts = np.concatenate([np.array(t).reshape(-1, 3)
                              for p in self.parts.values() for t in p["tris"].values()])
        return pts.min(0), pts.max(0)


CREASE_DEG = 42   # au-delà de cet angle entre faces, l'arête reste vive


def smooth_normals(T, crease_deg=CREASE_DEG):
    """Normales lissées par sommet, en gardant vives les arêtes marquées."""
    raw = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    unit = raw / np.linalg.norm(raw, axis=1, keepdims=True)
    keys = [tuple(k) for k in np.round(T.reshape(-1, 3) * 1e4).astype(np.int64)]
    groups = {}
    for vi, k in enumerate(keys):
        groups.setdefault(k, []).append(vi // 3)
    cosc = math.cos(math.radians(crease_deg))
    out = np.empty((len(keys), 3))
    for vi, k in enumerate(keys):
        f = vi // 3
        faces = groups[k]
        mask = unit[faces] @ unit[f] > cosc
        n = raw[faces][mask].sum(0)
        out[vi] = n / (np.linalg.norm(n) or 1)
    return out


def export_glb(model, path):
    binbuf = bytearray()
    views, accs, meshes, nodes, mats, matidx = [], [], [], [], [], {}

    def view(data, target):
        while len(binbuf) % 4:
            binbuf.append(0)
        views.append({"buffer": 0, "byteOffset": len(binbuf),
                      "byteLength": len(data), "target": target})
        binbuf.extend(data)
        return len(views) - 1

    def acc(arr, with_minmax):
        a = {"bufferView": view(arr.tobytes(), 34962), "componentType": 5126,
             "count": len(arr), "type": "VEC3"}
        if with_minmax:
            a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1

    children = []
    for pname, p in model.parts.items():
        prims = []
        for color, tris in p["tris"].items():
            if color not in matidx:
                rgb, met, rough = PALETTE[color]
                matidx[color] = len(mats)
                mats.append({"name": color, "pbrMetallicRoughness": {
                    "baseColorFactor": [*rgb, 1.0], "metallicFactor": met,
                    "roughnessFactor": rough}})
            T = np.array(tris, float) - p["origin"]
            pos = T.reshape(-1, 3).astype(np.float32)
            nor = smooth_normals(T).astype(np.float32)
            prims.append({"attributes": {"POSITION": acc(pos, True),
                                         "NORMAL": acc(nor, False)},
                          "material": matidx[color]})
        meshes.append({"name": pname, "primitives": prims})
        nodes.append({"name": pname, "mesh": len(meshes) - 1,
                      "translation": [float(v) for v in p["origin"]]})
        children.append(len(nodes) - 1)
    nodes.append({"name": model.name, "children": children})

    gltf = {"asset": {"version": "2.0", "generator": "airport low-poly generator"},
            "scene": 0, "scenes": [{"name": model.name, "nodes": [len(nodes) - 1]}],
            "nodes": nodes, "meshes": meshes, "materials": mats,
            "accessors": accs, "bufferViews": views,
            "buffers": [{"byteLength": len(binbuf)}]}
    while len(binbuf) % 4:
        binbuf.append(0)
    gltf["buffers"][0]["byteLength"] = len(binbuf)
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binbuf), 0x004E4942)); f.write(binbuf)


# ================================================================ BÂTIMENTS
def terminal():
    m = Model("terminal")
    m.add(boxmm(-40, 0, -15, 40, 4, 15), "concrete")
    m.add(boxmm(-39.5, 4, -14.5, 39.5, 12, 14.5), "glass")
    for y in (7.8,):
        m.add(boxmm(-40, y, -15, 40, y + 0.6, 15), "white")
    for x in range(-36, 37, 8):           # meneaux
        m.add(boxmm(x - 0.3, 4, -15, x + 0.3, 12, 15), "white")
    m.add(boxmm(-42, 12, -17, 42, 13.2, 17), "white")        # toit débordant
    m.add(boxmm(-20, 13.2, -6, 20, 16, 6), "roof")            # bloc technique
    # auvent côté ville (-Z)
    m.add(boxmm(-18, 5, -24, 18, 5.6, -15), "white")
    for x in (-16, -6, 6, 16):
        m.add(cyl((x, 0, -23), (x, 5, -23), 0.35, n=8), "metal")
    # passerelles côté piste (+Z)
    for x in (-24, 0, 24):
        m.add(boxmm(x - 1.6, 4.5, 15, x + 1.6, 7.5, 31), "metal")
        m.add(boxmm(x - 2.2, 4.0, 31, x + 2.2, 8.0, 34), "metal_d")
        m.add(cyl((x, 0, 28), (x, 4.5, 28), 0.4, n=8), "metal_d")
        m.add(boxmm(x - 1.2, 0, 27.4, x + 1.2, 0.8, 28.6), "rubber")
    return m


def tower():
    m = Model("tour_controle")
    m.add(boxmm(-7, 0, -5, 7, 6, 5), "concrete")
    m.add(boxmm(-6.5, 1, -5.1, 6.5, 5, 5.1), "glass")
    m.add(cyl((0, 6, 0), (0, 34, 0), 2.6, 2.2, n=12), "concrete")
    m.add(cyl((0, 33, 0), (0, 34.6, 0), 2.4, 4.4, n=8, phase=math.pi / 8), "concrete_d")
    m.add(cyl((0, 34.6, 0), (0, 35.4, 0), 4.4, n=8, phase=math.pi / 8), "white")
    m.add(cyl((0, 35.4, 0), (0, 40, 0), 3.7, 4.4, n=8, phase=math.pi / 8), "glass_d")
    m.add(cyl((0, 40, 0), (0, 41.2, 0), 4.7, 4.2, n=8, phase=math.pi / 8), "white")
    m.add(cyl((0, 41.2, 0), (0, 47, 0), 0.15, 0.08, n=6), "metal")
    m.add(cyl((0, 46.6, 0), (0, 47.2, 0), 0.3, n=6), "red")
    m.add(box((1.8, 41.9, 1.2), (0.3, 1.4, 0.3)), "metal")
    m.add(cyl((1.8, 42.6, 1.2), (1.8, 43, 1.2), 0.9, n=10), "white")   # radar
    return m


def hangar():
    m = Model("hangar")
    W, D, H = 50, 40, 5
    m.add(boxmm(-W / 2, 0, -D / 2, W / 2, H, D / 2), "metal")
    arc = [(W / 2 * math.cos(a), H + 12 * math.sin(a))
           for a in np.linspace(0, math.pi, 11)]
    rings = [np.array([[x, y, z] for x, y in arc]) for z in (-D / 2 - 0.5, D / 2 + 0.5)]
    m.add(loft(rings), "roof")
    # porte coulissante en panneaux
    for i, x in enumerate(np.linspace(-21, 21, 7)):
        m.add(boxmm(x - 2.9, 0, D / 2, x + 2.9, 11, D / 2 + 0.4),
              "metal_d" if i % 2 else "metal")
    m.add(boxmm(-24, 11, D / 2, 24, 12, D / 2 + 0.6), "yellow")
    m.add(boxmm(-W / 2 - 4, 0, -10, -W / 2, 4, 2), "concrete")  # bureaux
    m.add(boxmm(-W / 2 - 3.9, 1.5, -9, -W / 2 - 3.8, 3, 1), "glass")
    m.add(boxmm(-W / 2 - 4.4, 4, -10.4, -W / 2, 4.4, 2.4), "white")
    m.add(boxmm(-26, -0.02, D / 2, 26, 0.05, D / 2 + 20), "concrete_d")  # parvis
    return m


def fire_station():
    m = Model("caserne_pompiers")
    m.add(boxmm(-15, 0, -9, 15, 8, 9), "brick")
    m.add(boxmm(-15.6, 8, -9.6, 15.6, 9, 9.6), "red")
    m.add(boxmm(-14, 9, -8, 14, 9.6, 8), "roof")
    for x in (-9, 0, 9):                                        # portes
        m.add(boxmm(x - 3.5, 0, 9, x + 3.5, 6, 9.3), "red")
        for y in (1.5, 3, 4.5):
            m.add(boxmm(x - 3.4, y, 9.3, x + 3.4, y + 0.15, 9.4), "white")
    for x in (-13.5, -4.5, 4.5, 13.5):
        m.add(boxmm(x - 0.5, 0, 9, x + 0.5, 6.5, 9.4), "white")
    m.add(boxmm(-12, 6.6, 9, 12, 7.6, 9.2), "white")            # bandeau
    m.add(boxmm(-14, 6.6, -9.2, -6, 7.6, -9), "glass")
    m.add(boxmm(15, 0, -6, 21, 18, 0), "brick")                 # tour d'exercice
    m.add(boxmm(14.6, 18, -6.4, 21.4, 19, 0.4), "red")
    for y in (5, 9, 13):
        m.add(boxmm(16.5, y, 0, 19.5, y + 2, 0.2), "glass_d")
    m.add(cyl((-10, 9.6, 0), (-10, 13, 0), 0.25, n=6), "metal")  # sirène
    m.add(box((-10, 13.2, 0), (0.8, 0.5, 0.8)), "red")
    m.add(boxmm(-16, -0.02, 9, 16, 0.05, 22), "concrete_d")     # aire de sortie
    for x in (-9, 0, 9):
        m.add(boxmm(x - 0.15, 0.05, 10, x + 0.15, 0.07, 21), "yellow")
    return m


def parking():
    m = Model("parking")
    rng = np.random.default_rng(7)
    W, D, lv = 40, 30, 3.2
    car_colors = ["red", "blue", "white", "metal", "yellow", "navy", "green"]
    for k in range(4):
        y = k * lv
        m.add(boxmm(-W / 2, y, -D / 2, W / 2, y + 0.5, D / 2),
              "asphalt" if k == 0 else "concrete")
        if k:   # garde-corps
            for z0, z1 in ((-D / 2, -D / 2 + 0.3), (D / 2 - 0.3, D / 2)):
                m.add(boxmm(-W / 2, y + 0.5, z0, W / 2, y + 1.6, z1), "concrete_d")
            m.add(boxmm(W / 2 - 0.3, y + 0.5, -D / 2, W / 2, y + 1.6, D / 2), "concrete_d")
        for x in np.arange(-W / 2 + 2.5, W / 2 - 4, 2.6):        # voitures
            for zr in (-D / 2 + 3, D / 2 - 3):
                if rng.random() < 0.55:
                    c = car_colors[rng.integers(len(car_colors))]
                    m.add(box((x, y + 1.0, zr), (1.8, 0.8, 4.2)), c)
                    m.add(box((x, y + 1.7, zr + 0.2), (1.6, 0.6, 2.2)), "glass_d")
        for x in np.arange(-W / 2 + 1, W / 2, 1.3 * 2):           # marquages
            if k < 3:
                for zr in (-D / 2 + 3, D / 2 - 3):
                    m.add(boxmm(x - 0.06, y + 0.5, zr - 2.4, x + 0.06, y + 0.52, zr + 2.4), "white")
    for x in (-18, -6, 6, 18):                                   # poteaux
        for z in (-13, 0, 13):
            m.add(boxmm(x - 0.35, 0, z - 0.35, x + 0.35, 3 * lv, z + 0.35), "concrete_d")
    ang = math.atan2(lv, 14)                                     # rampe
    for k in range(3):
        m.add(box((-W / 2 - 2.5, k * lv + lv / 2 + 0.25, 0), (4.5, 0.4, 14.4),
                  R=rot("x", -ang if k % 2 == 0 else ang)), "concrete")
    m.add(boxmm(W / 2 - 4, 3 * lv, -D / 2, W / 2, 3 * lv + 3.5, -D / 2 + 4), "brick")  # escalier
    m.add(boxmm(W / 2 - 3.5, 3 * lv + 3.5, -D / 2 + 0.5, W / 2 - 0.5, 3 * lv + 4, -D / 2 + 3.5), "yellow")
    return m


def hotel():
    m = Model("hotel")
    m.add(boxmm(-18, 0, -12, 18, 6, 12), "concrete")
    m.add(boxmm(-17.5, 0, -12.1, 17.5, 5, 12.1), "glass")
    m.add(boxmm(-19, 6, -13, 19, 6.8, 13), "white")
    m.add(boxmm(-8, 4.5, 12, 8, 5, 18), "white")                 # marquise
    for x in (-7, 7):
        m.add(cyl((x, 0, 17), (x, 4.5, 17), 0.25, n=8), "metal")
    floors, fh = 12, 3.2
    top = 6.8 + floors * fh
    m.add(boxmm(-11.6, 6.8, -7.6, 11.6, top, 7.6), "glass")
    for i in range(floors + 1):
        y = 6.8 + i * fh
        m.add(boxmm(-12, y, -8, 12, y + 0.45, 8), "white")
    for x in (-12, 12):
        m.add(boxmm(x - 1.2 if x > 0 else x, 6.8, -8, x if x > 0 else x + 1.2, top, 8), "concrete")
    m.add(boxmm(-6, top + 0.45, -4, 6, top + 3.5, 4), "concrete_d")  # local technique
    m.add(boxmm(-5, top + 3.5, 4, 5, top + 6, 4.4), "red")           # enseigne
    m.add(boxmm(-4.4, top + 4.2, 4.4, 4.4, top + 5.3, 4.5), "white")
    return m


# ================================================================ AVIONS
def fuselage(m, L, R, cy, nose_len, tail_len, tail_rise, color, n=14):
    z0, z1 = -L / 2, L / 2
    st = []
    for f in (0.0, 0.12, 0.3, 0.55, 0.8, 1.0):           # nez -> pleine section
        r = R * max(0.1, math.sqrt(1 - (1 - f) ** 2))
        st.append((z1 - nose_len * (1 - f), r, -0.25 * R * (1 - f)))
    for g in (0.0, 0.4, 0.75, 1.0):                       # queue relevée
        st.append((z0 + tail_len * (1 - g), R * (1 - 0.85 * g), tail_rise * g))
    st.sort()
    rings = [ring((0, cy + dy, z), (0, 0, 1), r, n, phase=math.pi / n) for z, r, dy in st]
    m.add(loft(rings), color, "fuselage")
    # bande de hublots + cockpit
    za, zb = z0 + tail_len * 0.9, z1 - nose_len * 1.05
    for s in (-1, 1):
        m.add(boxmm(s * R * 0.97 - 0.03, cy + 0.15 * R, za, s * R * 0.97 + 0.03, cy + 0.38 * R, zb), "glass_d", "fuselage")
    m.add(box((0, cy + 0.3 * R, z1 - nose_len * 0.45), (R * 1.1, R * 0.28, nose_len * 0.25),
              R=rot("x", -0.35)), "glass_d", "fuselage")


def wing(m, s, root, tip, color, part="ailes"):
    """root/tip = (x, z_bord_attaque, corde, y, épaisseur)"""
    def sec(x, zf, c, y, t):
        pts = [(zf, y), (zf - .25 * c, y + t), (zf - .6 * c, y + .8 * t),
               (zf - c, y), (zf - .6 * c, y - .3 * t), (zf - .25 * c, y - .5 * t)]
        return np.array([[s * x, yy, zz] for zz, yy in pts])
    m.add(loft([sec(*root), sec(*tip)]), color, part)


def fin(m, root, tip, color, part="empennage"):
    """Dérive verticale : (y, z_bord_attaque, corde, demi-épaisseur)"""
    def sec(y, zf, c, t):
        return np.array([[0, y, zf], [t, y, zf - .3 * c], [0, y, zf - c], [-t, y, zf - .3 * c]])
    m.add(loft([sec(*root), sec(*tip)]), color, part)


def engine(m, x, y, z, r, L, color, accent):
    m.add(loft([ring((x, y, z), (0, 0, 1), r * .92, 12),
                ring((x, y, z - .3 * L), (0, 0, 1), r, 12),
                ring((x, y, z - L), (0, 0, 1), r * .62, 12)]), color, "moteurs")
    m.add(cyl((x, y, z + .02), (x, y, z - .2), r * .8, n=12), "metal_d", "moteurs")
    m.add(cyl((x, y, z - L + .05), (x, y, z - L - .4), r * .55, r * .3, n=10), "metal_d", "moteurs")
    m.add(box((x, y + r * .95, z - .2 * L), (0.06, 0.06, L * .3)), accent, "moteurs")


def gear(m, x, z, h, wheel_r, n_wheels=2, wheel_w=0.3):
    m.add(cyl((x, wheel_r, z), (x, h, z), 0.12 + wheel_r * .1, n=6), "metal", "train")
    for k in range(n_wheels):
        dx = (k - (n_wheels - 1) / 2) * (wheel_w + 0.1)
        m.add(cyl((x + dx - wheel_w / 2, wheel_r, z), (x + dx + wheel_w / 2, wheel_r, z),
                  wheel_r, n=10), "rubber", "train")


def turboprop():
    m = Model("turbopropulseur")
    L, R, cy = 27, 1.35, 2.3
    fuselage(m, L, R, cy, 3.2, 8, 1.1, "white")
    m.add(box((0, cy - R * .2, 0), (2 * R + .1, .35, L * .75)), "blue", "fuselage")  # liseré
    wy = cy + R + .15
    for s in (-1, 1):
        wing(m, s, (0, 2.0, 2.4, wy, .32), (13.5, 1.5, 1.4, wy - .1, .16), "white")
        x = 4.1
        m.add(loft([ring((s * x, wy - .55, 2.4), (0, 0, 1), .42, 10),
                    ring((s * x, wy - .55, 1.4), (0, 0, 1), .58, 10),
                    ring((s * x, wy - .4, -1.6), (0, 0, 1), .35, 10)]), "white", "moteurs")
        hub = np.array([s * x, wy - .55, 2.75])
        pname = "helice_" + ("droite" if s < 0 else "gauche")
        m.add(cyl(hub - [0, 0, .35], hub + [0, 0, .45], .3, .05, n=8), "metal_d", pname, origin=hub)
        for k in range(6):
            m.add(box(hub + [0, .95, 0], (.22, 1.75, .06), R=rot("z", k * math.pi / 3), pivot=hub),
                  "rubber", pname)
    # empennage en T
    fin(m, (cy + R * .6, -L / 2 + 6.2, 5.2, .18), (cy + 4.6, -L / 2 + 2.2, 2.6, .1), "blue")
    for s in (-1, 1):
        wing(m, s, (0, -L / 2 + 3, 2.2, cy + 4.5, .14), (3.9, -L / 2 + 2.1, 1.2, cy + 4.6, .08), "blue", "empennage")
    gear(m, 0, L / 2 - 3.4, cy - R * .6, .32, 2, .2)
    for s in (-1, 1):
        gear(m, s * 1.6, -0.6, cy - R * .5, .42, 2, .25)
    return m


def jet(name, L, R, cy, span, root_c, tip_c, sweep, eng_pos, eng_r, eng_L,
        accent, tail_c, gear_cfg, upper_deck=False):
    m = Model(name)
    fuselage(m, L, R, cy, R * 2.1, L * .26, R * .9, "white")
    m.add(box((0, cy - R * .78, -L * .02), (R * 1.25, R * .45, L * .6)), "metal", "fuselage")  # ventre
    if upper_deck:
        z1, zl = L / 2 - R * 1.6, L * .3
        m.add(loft([ring((0, cy + R * .25 + y_off, z), (0, 0, 1), r, 12, ry=r * .9)
                    for z, r, y_off in ((z1, .3, .2), (z1 - 2.5, R * .72, .45),
                                        (z1 - zl, R * .72, .45), (z1 - zl - 4, .4, .2))]),
              "white", "fuselage")
    wy, zf = cy - R * .55, L * .1
    for s in (-1, 1):
        wing(m, s, (0, zf, root_c, wy, root_c * .07),
             (span / 2, zf - sweep, tip_c, wy + span * .035, tip_c * .06), "white")
        tx, tz, ty = span / 2, zf - sweep, wy + span * .035
        fin_tip = np.array([[s * tx, ty, tz - tip_c * .15], [s * (tx + .05), ty, tz - tip_c * .5],
                            [s * tx, ty, tz - tip_c * .95], [s * (tx - .05), ty, tz - tip_c * .5]])
        m.add(loft([fin_tip, fin_tip + [s * .3, span * .045, -tip_c * .5]]), accent, "ailes")  # winglet
        for ex in eng_pos:
            frac = ex / (span / 2)
            ez = zf - sweep * frac + eng_L * .55
            ey = wy + span * .035 * frac - eng_r * 1.25
            engine(m, s * ex, ey, ez, eng_r, eng_L, "white", accent)
            m.add(box((s * ex, ey + eng_r * .9, ez - eng_L * .55), (eng_r * .25, eng_r * .7, eng_L * .7)),
                  "metal", "moteurs")   # mât
    zt = -L / 2
    fin(m, (cy + R * .7, zt + tail_c * 1.9, tail_c * 1.3, R * .1),
        (cy + R * 3.6, zt + tail_c * .45, tail_c * .65, R * .05), accent)
    for s in (-1, 1):
        wing(m, s, (0, zt + tail_c * 1.3, tail_c, cy + R * .35, tail_c * .08),
             (span * .19, zt + tail_c * .45, tail_c * .4, cy + R * .7, tail_c * .04), "white", "empennage")
    nz, nh, mx, mz, mh, mw = gear_cfg
    gear(m, 0, L / 2 - R * 2.4, nh, .42, 2, .25)
    for x in mx:
        for s in (-1, 1):
            gear(m, s * x, mz, mh, mw, 2 if len(mx) == 1 else 2, .4)
    return m


def medium_haul():
    return jet("moyen_courrier", L=37.6, R=2.0, cy=3.2, span=34, root_c=6.2, tip_c=1.6,
               sweep=6.5, eng_pos=[5.8], eng_r=1.0, eng_L=4.2, accent="red", tail_c=4.0,
               gear_cfg=(0, 2.2, [3.8], -2.4, 2.5, .55))


def wide_body():
    return jet("gros_porteur", L=68, R=3.2, cy=4.9, span=64, root_c=12.5, tip_c=3.0,
               sweep=17, eng_pos=[11.5, 21], eng_r=1.45, eng_L=6.0, accent="navy", tail_c=7.0,
               gear_cfg=(0, 3.1, [3.0, 5.6], -4.8, 3.6, .65), upper_deck=True)


# ================================================================ VÉHICULES
# Avant vers +Z, origine au sol. Chaque carrosserie est définie par ses profils
# réels (vue de côté : dessus et dessous ; vue de dessus : demi-largeur),
# interpolés par des courbes, avec passages de roues découpés.

import bisect


def cr(ctrl, z):
    """Courbe d'interpolation (Hermite / Catmull-Rom non uniforme) sur [(z, v), ...]."""
    zs = [c[0] for c in ctrl]; vs = [c[1] for c in ctrl]; n = len(zs)
    if z <= zs[0]:
        return vs[0]
    if z >= zs[-1]:
        return vs[-1]
    i = bisect.bisect_right(zs, z) - 1
    h = zs[i + 1] - zs[i]
    t = (z - zs[i]) / h
    p1, p2 = vs[i], vs[i + 1]
    m1 = (p2 - vs[i - 1]) / (zs[i + 1] - zs[i - 1]) * h if i > 0 else p2 - p1
    m2 = (vs[i + 2] - p1) / (zs[i + 2] - zs[i]) * h if i + 2 < n else p2 - p1
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2


def se_ring(z, hw, yb, yt, p=4.0, n=18, taper=0.0, ref=None):
    """Section en super-ellipse ; taper resserre le haut (retrait de caisse)."""
    hh, yc = (yt - yb) / 2, (yt + yb) / 2
    pts = []
    for i in range(n):
        a = 2 * math.pi * (i + .5) / n
        c, s = math.cos(a), math.sin(a)
        pts.append([hw * math.copysign(abs(c) ** (2 / p), c),
                    yc + hh * math.copysign(abs(s) ** (2 / p), s), z])
    pts = np.array(pts)
    if taper:
        rb, rt = ref if ref else (yb, yt)
        f = np.clip((pts[:, 1] - rb) / max(rt - rb, 1e-3), 0, 1)
        pts[:, 0] *= 1 - taper * f
    return pts


def spline_body(z0, z1, top, bot, hw, arches=(), p=4.0, taper=0.0, n=18, dz=.1,
                yclip=None, off=0.0, push=(False, False), dtop=0.0, dbot=0.0, R=None, t=(0, 0, 0)):
    """Volume défini par profils. yclip/off/push servent aux bandes (vitres, liserés)
    qui épousent la carrosserie en étant légèrement gonflées."""
    zs = set(np.linspace(z0, z1, max(2, int(math.ceil((z1 - z0) / dz)) + 1)).tolist())
    for ctrl in (top, bot, hw):
        zs |= {c[0] for c in ctrl if z0 < c[0] < z1}
    for zw, ra, _ in arches:
        for a in np.linspace(0, math.pi, 11):
            zz = zw + ra * .999 * math.cos(a)
            if z0 < zz < z1:
                zs.add(zz)
    rings = []
    for z in sorted(zs):
        b0, tp, w = cr(bot, z) + dbot, cr(top, z) + dtop, cr(hw, z)
        b = b0
        for zw, ra, cy in arches:
            if abs(z - zw) < ra:
                b = max(b, cy + math.sqrt(ra * ra - (z - zw) ** 2))
        yb, yt = b - off, tp + off
        if yclip:
            yb, yt = max(yb, yclip[0]), min(yt, yclip[1])
        if yt - yb < .02:
            continue
        rings.append(se_ring(z, w + off, yb, yt, p, n, taper, (b0, tp)))
    if push[0]:
        rings[0] = rings[0] - [0, 0, off]
    if push[1]:
        rings[-1] = rings[-1] + [0, 0, off]
    if R is not None:
        rings = [r @ R.T for r in rings]
    return loft([r + np.asarray(t, float) for r in rings])


def side_x(hw_ctrl, top, bot, z, y, taper, p=4.0):
    """Abscisse de la paroi latérale à (z, y), pour y poser portes et panneaux."""
    w, b, tp = cr(hw_ctrl, z), cr(bot, z), cr(top, z)
    s = (y - (b + tp) / 2) / ((tp - b) / 2)
    x = w * max(0.0, 1 - abs(s) ** p) ** (1 / p)
    return x * (1 - taper * min(max((y - b) / (tp - b), 0), 1))


def blob(center, rx, ry, rz, n=12):
    """Ellipsoïde (phares, gyrophares, rétroviseurs...)."""
    cx, cy, cz = center
    st = [(cz + rz * math.sin(a), rx * math.cos(a), cy - ry * math.cos(a), cy + ry * math.cos(a))
          for a in np.linspace(-math.pi / 2 + .25, math.pi / 2 - .25, 7)]
    rings = [se_ring(z, w, yb, yt, 2.0, n) + [cx, 0, 0] for z, w, yb, yt in st]
    return loft(rings)


def rod(p0, p1, r, n=8):
    return cyl(p0, p1, r, n=n)


_AX = {"x": ((1, 0, 0), (0, 0, 1), (0, 1, 0)),
       "z": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
       "y": ((0, 1, 0), (1, 0, 0), (0, 0, 1))}


def _rr_ring(c, u, v, hu, hv, r, nc=3):
    r = min(r, hu * .99, hv * .99)
    pts = []
    for su, sv, a0 in ((1, 1, 0), (-1, 1, math.pi / 2), (-1, -1, math.pi), (1, -1, 1.5 * math.pi)):
        cu, cv = su * (hu - r), sv * (hv - r)
        for j in range(nc + 1):
            a = a0 + j * (math.pi / 2) / nc
            pts.append(c + (cu + r * math.cos(a)) * u + (cv + r * math.sin(a)) * v)
    return np.array(pts)


def pad(center, axis, sign, hu, hv, r, th=.05):
    """Plaque à coins arrondis posée sur une face (portes, calandres, coffres)."""
    nrm, u, v = (np.array(a, float) for a in _AX[axis])
    c = np.asarray(center, float) - sign * .01 * nrm
    return loft([_rr_ring(c, u, v, hu, hv, r), _rr_ring(c + sign * (th + .01) * nrm, u, v, hu, hv, r)])


def curved_plate(pts_yz, th, half_w, R=None, t=(0, 0, 0)):
    """Plaque cintrée (lame de chasse-neige) : tranches convexes successives."""
    out = []
    for (y0, z0), (y1, z1) in zip(pts_yz[:-1], pts_yz[1:]):
        quad = [(y0, z0), (y1, z1), (y1, z1 - th), (y0, z0 - th)]
        rings = [np.array([[x, y, z] for y, z in quad]) for x in (-half_w, half_w)]
        if R is not None:
            rings = [r @ R.T for r in rings]
        out += loft([r + np.asarray(t, float) for r in rings])
    return out


def tyre(m, x, z, r, w, part="roues", hub="metal"):
    rings = [ring((x + dx, r, z), (1, 0, 0), rr, 14)
             for dx, rr in ((-w / 2, .8 * r), (-w * .32, r), (w * .32, r), (w / 2, .8 * r))]
    m.add(loft(rings), "rubber", part)
    s = 1 if x > 0 else -1
    m.add(cyl((x + s * (w / 2 - .02), r, z), (x + s * (w / 2 + .025), r, z), r * .52, n=14), hub, part)


def tyres(m, xs, zs, r, w, part="roues"):
    for x in xs:
        for z in zs:
            tyre(m, x, z, r, w, part)


def pair(m, fn, color, part):
    for s in (-1, 1):
        m.add(fn(s), color, part)


# ---------------------------------------------------------------- voiture
def car():
    """Compacte 5 portes : 4,30 × 1,79 × 1,46 m, empattement 2,63 m."""
    m = Model("voiture"); C = "carrosserie"
    WZ, R = (1.33, -1.30), .32
    hw = [(-2.15, .64), (-2.05, .81), (-1.75, .885), (-1.0, .895), (1.0, .895), (1.75, .87), (2.05, .78), (2.15, .6)]
    belt = [(-2.15, .6), (-2.1, .8), (-1.95, .92), (-1.6, .97), (-.4, .98), (.7, .96), (1.05, .92),
            (1.6, .84), (1.95, .76), (2.12, .66), (2.15, .55)]
    bot = [(-2.15, .45), (-2.05, .28), (-1.75, .18), (1.75, .18), (2.05, .26), (2.15, .42)]
    arches = [(z, .41, R) for z in WZ]
    m.add(spline_body(-2.15, 2.15, belt, bot, hw, arches, p=3.4, taper=.05, dz=.12, n=16), "red", C)
    # habitacle vitré : pare-brise incliné, pavillon bombé, hayon
    roof = [(-1.99, .95), (-1.92, 1.2), (-1.72, 1.37), (-1.2, 1.45), (-.3, 1.47), (.15, 1.43),
            (.55, 1.25), (1.03, .94)]
    gbot = [(-2.0, .86), (1.05, .86)]
    ghw = [(-2.0, .78), (-1.6, .84), (.6, .84), (1.05, .82)]
    m.add(spline_body(-1.99, 1.03, roof, gbot, ghw, p=3.0, taper=.3, dz=.07), "glass_d", C)
    m.add(spline_body(-1.78, .3, roof, roof, [(-2, .64), (1, .64)], p=2.6, dtop=.018, dbot=-.08, dz=.07), "red", C)
    for z0, z1 in ((-.47, -.33), (-2.0, -1.72)):                      # montants B et C
        m.add(spline_body(z0, z1, roof, gbot, ghw, p=3.0, taper=.3, off=.012, dz=.07), "red", C)
    for s in (-1, 1):
        m.add(blob((s * .6, .7, 2.0), .22, .07, .14), "yellow", C)            # phares
        m.add(blob((s * .64, .86, -2.06), .2, .06, .1), "red", C)              # feux
        m.add(blob((s * .9, .98, .82), .12, .06, .08), "red", C)               # rétros
        m.add(blob((s * .78, .9, -2.07), .14, .05, .06), "red", C)
    m.add(blob((0, .47, 2.08), .48, .1, .08), "metal_d", C)                    # calandre
    m.add(blob((0, .3, -2.1), .55, .06, .06), "metal_d", C)
    tyres(m, (-.77, .77), WZ, R, .22)
    return m


# ---------------------------------------------------------------- bus de piste
def bus():
    """Bus de piste type Cobus 3000 : 14 × 3 × 3 m, plancher bas, vitré tout autour."""
    m = Model("bus"); C = "carrosserie"
    WZ, R = (3.6, -4.3), .45
    top = [(-6.5, 2.55), (-6.4, 2.88), (-6.0, 3.02), (5.8, 3.02), (6.3, 2.9), (6.5, 2.6)]
    bot = [(-6.5, .6), (-6.35, .32), (6.35, .32), (6.5, .6)]
    hw = [(-6.5, 1.3), (-6.3, 1.48), (6.1, 1.5), (6.42, 1.42), (6.5, 1.25)]
    arches = [(z, .58, R) for z in WZ]
    kw = dict(p=6, taper=.05, dz=.6, n=16)
    m.add(spline_body(-6.5, 6.5, top, bot, hw, arches, **kw), "white", C)
    m.add(spline_body(-6.38, 6.5, top, bot, hw, arches, yclip=(.95, 2.72), off=.015, push=(False, True), **kw), "glass_d", C)
    m.add(spline_body(-6.5, 6.5, top, bot, hw, arches, yclip=(.3, .9), off=.018, push=(True, True), **kw), "blue", C)
    m.add(spline_body(-4.0, 2.6, [(-4, 3.3), (-3.7, 3.42), (2.3, 3.42), (2.6, 3.3)], [(-4, 2.95), (2.6, 2.95)],
                      [(-4, .8), (-3.7, .95), (2.3, .95), (2.6, .8)], p=3, dz=.3), "metal", C)   # climatisation
    for z in (4.75, 1.0, -2.6):                                            # portes doubles, deux côtés
        for s in (-1, 1):
            x = s * (side_x(hw, top, bot, z, 1.55, .05) + .016)
            m.add(pad((x, 1.6, z), "x", s, .72, 1.25, .12, th=.035), "metal_d", C)
            m.add(pad((x + s * .035, 1.65, z), "x", s, .6, 1.1, .08, th=.02), "glass", C)
            m.add(pad((x + s * .035, 1.65, z), "x", s, .02, 1.1, .01, th=.03), "metal_d", C)
    for s in (-1, 1):
        m.add(blob((s * 1.05, .72, 6.47), .2, .08, .06), "yellow", C)
        m.add(blob((s * 1.1, .8, -6.47), .15, .08, .05), "red", C)
        m.add(blob((s * 1.6, 2.5, 6.2), .08, .2, .1), "metal_d", C)            # rétros
    tyres(m, (-1.18, 1.18), WZ, R, .38)
    return m


# ---------------------------------------------------------------- cabine avancée commune
def cabover(m, color, zf=5.0, part="carrosserie"):
    zb = zf - 2.4
    top = [(zb, 2.85), (zb + .12, 3.08), (zf - .5, 3.12), (zf - .15, 2.98), (zf, 2.6)]
    bot = [(zb, .8), (zf - .1, .8), (zf, .95)]
    hw = [(zb, 1.2), (zb + .1, 1.25), (zf - .2, 1.25), (zf, 1.12)]
    arches = [(zf - .95, .62, .52)]
    kw = dict(p=5, taper=.06, dz=.12)
    m.add(spline_body(zb, zf, top, bot, hw, arches, **kw), color, part)
    m.add(spline_body(zf - 1.0, zf, top, bot, hw, arches, yclip=(1.85, 2.9), off=.015, push=(False, True), **kw),
          "glass_d", part)                                                  # pare-brise + vitres de portes
    m.add(spline_body(zf - .35, zf, top, bot, hw, arches, yclip=(.78, 1.08), off=.03, push=(False, True), **kw),
          "metal_d", part)                                                  # pare-chocs
    m.add(pad((0, 1.45, zf), "z", 1, .75, .28, .08, th=.03), "metal_d", part)    # calandre
    for s in (-1, 1):
        m.add(blob((s * .9, 1.28, zf + .01), .18, .08, .04), "yellow", part)
        m.add(rod((s * 1.2, 2.5, zf - .35), (s * 1.45, 2.55, zf - .25), .03), "metal", part)
        m.add(blob((s * 1.48, 2.35, zf - .25), .06, .22, .1), "metal_d", part)
    m.add(blob((0, 3.17, zf - .7), .4, .1, .14), "orange", part)               # gyrophare
    return zb


# ---------------------------------------------------------------- camion-citerne
def fuel_truck():
    """Avitailleur 6×4 : cabine avancée, citerne ovale 20 000 L, armoire de pompage arrière."""
    m = Model("camion_citerne"); C = "citerne"
    cabover(m, "white")
    m.add(boxmm(-1.0, .62, -5.0, 1.0, 1.0, 2.7), "metal_d", "carrosserie")
    top = [(-4.4, 2.2), (-4.25, 2.65), (-3.9, 2.88), (2.0, 2.88), (2.3, 2.65), (2.4, 2.2)]
    bot = [(-4.4, 1.6), (-4.25, 1.3), (-3.9, 1.12), (2.0, 1.12), (2.3, 1.3), (2.4, 1.6)]
    hw = [(-4.4, .9), (-4.25, 1.12), (-3.9, 1.22), (2.0, 1.22), (2.3, 1.12), (2.4, .9)]
    kw = dict(p=2.6, dz=.25)
    m.add(spline_body(-4.4, 2.4, top, bot, hw, **kw), "white", C)
    m.add(spline_body(-4.3, 2.3, top, bot, hw, yclip=(1.85, 2.12), off=.015, **kw), "red", C)
    for x in (-.45, .45):                                                     # garde-corps
        m.add(rod((x, 3.25, -3.6), (x, 3.25, 1.6), .03), "metal", C)
        for z in (-3.6, -1.0, 1.6):
            m.add(rod((x, 2.86, z), (x, 3.25, z), .025), "metal", C)
    m.add(spline_body(-5.15, -4.35, [(-5.15, 2.35), (-5.05, 2.45), (-4.45, 2.45), (-4.35, 2.35)],
                      [(-5.15, .75), (-4.35, .75)], [(-5.15, 1.15), (-5.05, 1.22), (-4.45, 1.22), (-4.35, 1.15)],
                      p=8, dz=.2), "metal", C)                                # armoire de pompage
    for s in (-1, 1):
        m.add(pad((s * 1.22, 1.6, -4.75), "x", s, .32, .7, .05, th=.02), "metal_d", C)
    m.add(cyl((0, 1.6, -5.18), (0, 1.6, -5.25), .45, n=14), "rubber", C)      # enrouleur
    for x in (-.3, .3):                                                       # échelle
        m.add(rod((x, .9, -5.2), (x, 2.8, -4.6), .025), "metal", C)
    for k in range(5):
        y = 1.1 + k * .35; z = -5.2 + (y - .9) / 1.9 * .6
        m.add(rod((-.3, y, z), (.3, y, z), .02), "metal", C)
    tyres(m, (-1.0, 1.0), (4.05, -2.5, -3.75), .52, .42)
    return m


# ---------------------------------------------------------------- tracteur de repoussage
def pushback_tug():
    """Tracteur conventionnel à barre : 6,2 × 2,6 m, très bas, cabine centrale."""
    m = Model("tracteur_repoussage"); C = "carrosserie"
    WZ, R = (2.0, -2.0), .55
    top = [(-3.1, .9), (-2.95, 1.2), (-2.6, 1.32), (2.6, 1.32), (2.95, 1.2), (3.1, .9)]
    bot = [(-3.1, .58), (-2.9, .35), (2.9, .35), (3.1, .58)]
    hw = [(-3.1, 1.2), (-2.9, 1.3), (2.9, 1.3), (3.1, 1.2)]
    arches = [(z, .68, R) for z in WZ]
    kw = dict(p=6, taper=.04, dz=.12)
    m.add(spline_body(-3.1, 3.1, top, bot, hw, arches, **kw), "yellow", C)
    for zz, push in (((2.72, 3.1), (False, True)), ((-3.1, -2.72), (True, False))):
        m.add(spline_body(*zz, top, bot, hw, arches, yclip=(.5, .98), off=.05, push=push, **kw), "rubber", C)
    m.add(spline_body(-3.0, 3.0, top, bot, hw, arches, yclip=(1.05, 1.15), off=.012, **kw), "metal_d", C)
    roof = [(-.7, 1.3), (-.6, 1.95), (-.35, 2.12), (.6, 2.12), (.9, 1.92), (1.0, 1.3)]
    gb, gw = [(-.7, 1.28), (1.0, 1.28)], [(-.7, .66), (-.6, .7), (.9, .7), (1.0, .66)]
    m.add(spline_body(-.7, 1.0, roof, gb, gw, p=3.5, taper=.15, dz=.06), "glass_d", C)
    m.add(spline_body(-.55, .85, roof, roof, [(-1, .6), (1, .6)], p=3, dtop=.02, dbot=-.06, dz=.06), "yellow", C)
    m.add(spline_body(-.05, .05, roof, gb, gw, p=3.5, taper=.15, off=.012, dz=.05), "yellow", C)
    m.add(blob((0, 2.2, .1), .14, .09, .14), "orange", C)
    for s in (-1, 1):
        m.add(blob((s * .95, 1.0, 3.12), .16, .07, .04), "yellow", C)
    m.add(rod((0, .55, 3.15), (0, .55, 7.2), .09, n=10), "metal", "barre_remorquage")
    m.parts["barre_remorquage"]["origin"] = np.array([0, .55, 3.15])
    m.add(blob((0, .55, 7.35), .3, .12, .18), "yellow", "barre_remorquage")
    tyres(m, (-1.0, 1.0), WZ, R, .5)
    return m


# ---------------------------------------------------------------- train de bagages
def baggage_train():
    """Tracteur à bagages électrique + 3 chariots bâchés."""
    m = Model("train_bagages"); T = "tracteur"
    top = [(-1.4, .8), (-1.3, .95), (-.2, .98), (.3, 1.0), (1.1, .95), (1.35, .8), (1.4, .6)]
    bot = [(-1.4, .4), (-1.3, .25), (1.3, .25), (1.4, .4)]
    hw = [(-1.4, .65), (-1.3, .72), (1.3, .72), (1.4, .62)]
    arches = [(z, .38, .3) for z in (.9, -.9)]
    m.add(spline_body(-1.4, 1.4, top, bot, hw, arches, p=4, taper=.08, dz=.07), "orange", T)
    m.parts[T]["origin"] = np.zeros(3)
    m.add(spline_body(-1.2, -.25, [(-1.2, 1.1), (-.25, 1.1)], [(-1.2, .95), (-.25, .95)],
                      [(-1.2, .4), (-1.1, .45), (-.35, .45), (-.25, .4)], p=3, dz=.1), "metal_d", T)  # siège
    m.add(spline_body(-1.22, -1.05, [(-1.22, 1.75), (-1.05, 1.75)], [(-1.22, 1.05), (-1.05, 1.05)],
                      [(-1.22, .42), (-1.05, .42)], p=3, dz=.1), "metal_d", T)
    m.add(rod((0, 1.0, .2), (0, 1.4, -.1), .03), "metal_d", T)               # colonne de direction
    m.add(cyl((0, 1.43, -.13), (0, 1.47, -.17), .18, n=12), "rubber", T)
    for x in (-.66, .66):
        m.add(rod((x, .95, -1.3), (x, 2.08, -1.3), .035), "metal", T)
        m.add(rod((x, 1.0, .55), (x, 2.08, .2), .035), "metal", T)
    m.add(pad((0, 2.08, -.55), "y", 1, .78, .95, .2, th=.07), "orange", T)
    for s in (-1, 1):
        m.add(blob((s * .48, .82, 1.33), .1, .06, .05), "yellow", T)
    tyres(m, (-.63, .63), (.9, -.9), .3, .22, T)

    cols = ["blue", "green", "red", "navy", "orange"]
    z = -1.4
    for k in range(1, 4):
        part = f"chariot_{k}"
        zc = z - 1.0 - 1.45
        m.add(rod((0, .42, z - .05), (0, .42, zc + 1.45), .045), "metal", part)
        m.parts[part]["origin"] = np.array([0, 0, zc])
        m.add(spline_body(zc - 1.45, zc + 1.45, [(zc - 1.45, .64), (zc + 1.45, .64)], [(zc - 1.45, .44), (zc + 1.45, .44)],
                          [(zc - 1.45, .76), (zc - 1.35, .8), (zc + 1.35, .8), (zc + 1.45, .76)], p=8, dz=.5), "metal_d", part)
        for i, bz in enumerate((-.85, 0, .85)):                               # valises
            for j, (bx, h) in enumerate(((-.3, .55), (.33, .45))):
                c = zc + bz + (.05 if j else 0)
                m.add(spline_body(c - .28, c + .28, [(c - .28, .64 + h), (c + .28, .64 + h)], [(c - .28, .64), (c + .28, .64)],
                                  [(c - .28, .25), (c + .28, .25)], p=5, n=12, dz=.56, t=(bx, 0, 0)), cols[(i + j * 2 + k) % 5], part)
        for x in (-.76, .76):
            for zz in (zc - 1.38, zc + 1.38):
                m.add(rod((x, .64, zz), (x, 1.9, zz), .035), "metal", part)
            m.add(rod((x, 1.85, zc - 1.38), (x, 1.85, zc + 1.38), .07, n=10), cols[(k + 3) % 5], part)  # bâche roulée
        m.add(pad((0, 1.9, zc), "y", 1, .84, 1.46, .25, th=.08), "white", part)
        tyres(m, (-.7, .7), (zc - 1.0, zc + 1.0), .22, .16, part)
        z = zc - 1.45
    return m


# ---------------------------------------------------------------- véhicule incendie aéroport
def fire_truck():
    """Véhicule incendie aéroport 6×6 (type Panther) : 12 × 3 × 3,5 m, cabine à pare-brise très incliné."""
    m = Model("camion_pompiers"); C = "carrosserie"
    WZ, R = (3.9, -2.05, -3.75), .68
    top = [(-6.0, 2.9), (-5.85, 3.32), (-5.4, 3.45), (3.0, 3.45), (3.6, 3.4), (4.4, 3.0), (5.3, 2.15), (5.8, 1.5), (6.0, 1.05)]
    bot = [(-6.0, .9), (-5.8, .62), (5.6, .62), (6.0, .85)]
    hw = [(-6.0, 1.38), (-5.8, 1.5), (4.8, 1.5), (5.8, 1.4), (6.0, 1.25)]
    arches = [(z, .82, R) for z in WZ]
    kw = dict(p=6, taper=.04, dz=.5, n=16)
    m.add(spline_body(-6.0, 6.0, top, bot, hw, arches, **kw), "red", C)
    m.add(spline_body(3.0, 6.0, top, bot, hw, arches, yclip=(2.0, 3.12), off=.02, push=(False, True), **kw), "glass_d", C)
    m.add(spline_body(-6.0, 6.0, top, bot, hw, arches, yclip=(1.28, 1.5), off=.016, push=(True, True), **kw), "white", C)
    m.add(spline_body(2.9, 3.05, top, bot, hw, arches, yclip=(1.6, 3.3), off=.02, **kw), "metal_d", C)  # joint cabine
    for z in (-4.9, -3.3, -1.7, -.1, 1.5):                                    # coffres à rideaux
        for s in (-1, 1):
            x = s * side_x(hw, top, bot, z, 2.35, .04, 6)
            m.add(pad((x, 2.35, z), "x", s, .7, .8, .08, th=.03), "metal", C)
            for y in np.arange(1.8, 3.1, .35):
                m.add(pad((x + s * .03, y, z), "x", s, .66, .015, .01, th=.01), "metal_d", C)
    for s in (-1, 1):
        m.add(blob((s * .62, 3.5, 3.55), .32, .1, .13), "blue", C)              # rampe de feux
        m.add(blob((s * 1.05, 1.1, 5.95), .2, .1, .05), "yellow", C)
        m.add(rod((s * 1.45, 2.8, 4.5), (s * 1.75, 2.85, 4.6), .035), "metal", C)
        m.add(blob((s * 1.78, 2.6, 4.6), .07, .25, .12), "metal_d", C)
    m.add(blob((0, .95, 6.05), .22, .14, .15), "yellow", C)                     # lance de pare-chocs
    m.add(cyl((0, 3.42, 2.4), (0, 3.75, 2.4), .32, .26, n=14), "metal", "lance")
    m.parts["lance"]["origin"] = np.array([0, 3.55, 2.4])
    m.add(cyl((0, 3.72, 2.25), (0, 3.98, 3.9), .13, .08, n=12), "yellow", "lance")
    tyres(m, (-1.25, 1.25), WZ, R, .55)
    return m


# ---------------------------------------------------------------- chasse-neige
def snowplow():
    """Chasse-neige de piste : cabine avancée, benne à fondants, lame biaise cintrée de 5 m."""
    m = Model("chasse_neige")
    cabover(m, "orange")
    m.add(boxmm(-1.0, .62, -4.8, 1.0, 1.0, 2.7), "metal_d", "carrosserie")
    top = [(-4.6, 2.55), (-4.5, 2.72), (2.2, 2.72), (2.3, 2.55)]
    bot = [(-4.6, 1.1), (2.3, 1.1)]
    hw = [(-4.6, 1.1), (-4.5, 1.15), (2.2, 1.15), (2.3, 1.1)]
    m.add(spline_body(-4.6, 2.3, top, bot, hw, p=8, taper=-.12, dz=.4), "yellow", "carrosserie")
    m.add(spline_body(-5.1, -4.55, [(-5.1, .95), (-4.55, .95)], [(-5.1, .4), (-4.55, .4)],
                      [(-5.1, .4), (-4.55, .4)], p=2.5, n=14, dz=.25), "metal", "carrosserie")  # épandeur
    for s in (-1, 1):                                                         # bras de poussée
        m.add(rod((s * .6, .7, 4.8), (s * .5, .75, 6.05), .09), "metal_d", "lame")
    m.parts["lame"]["origin"] = np.array([0, .75, 5.0])
    Rb = rot("y", .45)
    arc = [(.12 + 1.45 * a, .5 * a * a) for a in np.linspace(0, 1, 8)]
    m.add(curved_plate(arc, .08, 2.5, R=Rb, t=(0, 0, 6.45)), "orange", "lame")
    m.add(curved_plate([(.02, 0), (.14, 0)], .12, 2.52, R=Rb, t=(0, 0, 6.47)), "rubber", "lame")
    m.add(rod((0, 1.75, 6.9), (0, 2.3, 6.9), .02), "yellow", "lame")           # balises de gabarit
    tyres(m, (-1.02, 1.02), (4.05, -2.6, -3.85), .58, .46)
    return m


# ---------------------------------------------------------------- engin de dégivrage
def deicer():
    """Dégivreuse à nacelle fermée sur flèche télescopique."""
    m = Model("engin_degivrage"); C = "carrosserie"
    cabover(m, "white")
    m.add(boxmm(-1.0, .62, -5.0, 1.0, 1.0, 2.7), "metal_d", C)
    top = [(-4.8, 2.4), (-4.65, 2.72), (-4.3, 2.82), (1.8, 2.82), (2.2, 2.6)]
    bot = [(-4.8, 1.1), (2.2, 1.1)]
    hw = [(-4.8, 1.1), (-4.65, 1.2), (2.0, 1.2), (2.2, 1.1)]
    kw = dict(p=5, taper=.05, dz=.3)
    m.add(spline_body(-4.8, 2.2, top, bot, hw, **kw), "orange", C)
    m.add(spline_body(-4.8, 2.2, top, bot, hw, yclip=(1.7, 1.95), off=.015, push=(True, True), **kw), "white", C)
    m.add(cyl((0, 2.75, -3.5), (0, 3.35, -3.5), .58, .48, n=16), "metal", C)   # tourelle
    piv = np.array([0, 3.3, -3.5])
    Rb = rot("x", -.75)
    F = "fleche"
    m.add(cyl(piv, piv + Rb @ np.array([0, 0, 6.2]), .26, .24, n=12), "white", F)
    m.parts[F]["origin"] = piv
    m.add(cyl(piv + Rb @ np.array([0, 0, 5.9]), piv + Rb @ np.array([0, 0, 9.9]), .19, n=12), "metal", F)
    tip = piv + Rb @ np.array([0, 0, 10.0])
    b0 = tip + [0, -.35, 0]
    btop = [(-.7, .95), (-.6, 1.18), (.55, 1.2), (.7, .95)]
    bbot = [(-.7, .05), (-.6, 0), (.6, 0), (.7, .05)]
    bhw = [(-.7, .7), (-.6, .8), (.6, .8), (.7, .72)]
    m.add(spline_body(-.7, .7, btop, bbot, bhw, p=4, taper=.08, dz=.1, t=b0), "orange", F)
    m.add(spline_body(-.68, .7, btop, bbot, bhw, p=4, taper=.08, dz=.1, yclip=(.48, 1.05), off=.02,
                      push=(False, True), t=b0), "glass_d", F)
    m.add(rod(b0 + [0, .25, .7], b0 + [0, .15, 1.6], .06), "metal", F)       # buse
    m.add(blob(tuple(b0 + [0, 1.25, 0]), .14, .08, .14), "orange", F)
    tyres(m, (-1.02, 1.02), (4.05, -2.6, -3.85), .58, .46)
    return m


# ---------------------------------------------------------------- train
def train():
    """Navette ferroviaire aéroport : 3 voitures de 20 m, nez profilés aux deux extrémités."""
    m = Model("train")
    L, gap = 20.0, .8

    def nose_profiles(z_nose, sgn):
        def mk(lst):
            return sorted((z_nose - sgn * d, v) for d, v in lst)
        top = mk([(L, 3.6), (L - .15, 3.9), (L - .5, 3.95), (6.0, 3.95), (3.8, 3.82), (2.4, 3.4),
                  (1.3, 2.7), (.5, 1.95), (.1, 1.45), (0, 1.2)])
        bot = mk([(L, 1.0), (L - .15, .95), (.6, .95), (0, 1.1)])
        hw = mk([(L, 1.38), (L - .2, 1.45), (3.0, 1.45), (1.5, 1.32), (.6, 1.08), (0, .7)])
        return top, bot, hw

    def mid_profiles(z0, z1):
        top = [(z0, 3.6), (z0 + .15, 3.9), (z0 + .5, 3.95), (z1 - .5, 3.95), (z1 - .15, 3.9), (z1, 3.6)]
        bot = [(z0, 1.0), (z0 + .15, .95), (z1 - .15, .95), (z1, 1.0)]
        hw = [(z0, 1.38), (z0 + .2, 1.45), (z1 - .2, 1.45), (z1, 1.38)]
        return top, bot, hw

    kw = dict(p=5, taper=.1, dz=2.5, n=16)
    z = 0.0
    for k in range(3):
        part = f"voiture_{k + 1}"
        z0, z1 = z - L, z
        if k == 0:
            top, bot, hw = nose_profiles(z1, 1); nose = (z1, 1)
        elif k == 2:
            top, bot, hw = nose_profiles(z0, -1); nose = (z0, -1)
        else:
            top, bot, hw = mid_profiles(z0, z1); nose = None
        m.add(spline_body(z0, z1, top, bot, hw, **kw), "white", part)
        m.parts[part]["origin"] = np.array([0, 0, (z0 + z1) / 2])
        wz0, wz1 = z0 + .5, z1 - .5
        if nose:
            zn, sg = nose
            # pare-brise enveloppant
            a, b = sorted((zn - sg * 3.6, zn))
            m.add(spline_body(a, b, top, bot, hw, yclip=(2.3, 3.62), off=.02,
                              push=(sg < 0, sg > 0), **{**kw, "dz": .3}), "glass_d", part)
            if sg > 0: wz1 = zn - 4.3
            else: wz0 = zn + 4.3
            for s in (-1, 1):
                m.add(blob((s * .62, 1.42, zn - sg * .38), .2, .07, .1), "yellow", part)
        m.add(spline_body(wz0, wz1, top, bot, hw, yclip=(2.35, 3.15), off=.015, **kw), "glass_d", part)
        m.add(spline_body(z0, z1, top, bot, hw, yclip=(1.3, 1.7), off=.02,
                          push=(nose is None or nose[1] > 0, nose is None or nose[1] < 0), **kw), "blue", part)
        m.add(spline_body(z0 + .3, z1 - .3, top, bot, hw, yclip=(.95, 1.25), off=.025, **kw), "metal_d", part)
        for dzd in (z0 + 6.0, z1 - 6.0):                                        # portes louvoyantes
            for s in (-1, 1):
                x = s * (side_x(hw, top, bot, dzd, 2.2, .1, 5) + .02)
                m.add(pad((x, 2.2, dzd), "x", s, .75, 1.05, .1, th=.03), "metal_d", part)
                m.add(pad((x + s * .03, 2.55, dzd), "x", s, .6, .5, .08, th=.02), "glass", part)
        for dzd in (z0 + 3.5, z1 - 3.5):                                        # bogies
            m.add(spline_body(dzd - 1.4, dzd + 1.4, [(dzd - 1.4, 1.0), (dzd + 1.4, 1.0)], [(dzd - 1.4, .35), (dzd + 1.4, .35)],
                              [(dzd - 1.4, 1.0), (dzd + 1.4, 1.0)], p=4, dz=1.4), "metal_d", part)
            for wz in (dzd - 1.05, dzd + 1.05):
                tyre(m, -.75, wz, .43, .14, part, hub="metal_d")
                tyre(m, .75, wz, .43, .14, part, hub="metal_d")
        if k == 1:                                                              # pantographe
            m.add(spline_body(z0 + 8, z0 + 10, [(z0 + 8, 4.1), (z0 + 10, 4.1)], [(z0 + 8, 3.9), (z0 + 10, 3.9)],
                              [(z0 + 8, .5), (z0 + 10, .5)], p=4, dz=2), "metal_d", part)
            m.add(rod((0, 4.1, z0 + 8.5), (0, 4.7, z0 + 9.4), .04), "metal", part)
            m.add(rod((-.8, 4.7, z0 + 9.4), (.8, 4.7, z0 + 9.4), .04), "metal", part)
        if k < 2:                                                               # soufflet d'intercirculation
            m.add(spline_body(z0 - gap - .05, z0 + .05, [(z0 - 1, 3.6), (z0 + 1, 3.6)], [(z0 - 1, 1.05), (z0 + 1, 1.05)],
                              [(z0 - 1, 1.2), (z0 + 1, 1.2)], p=5, dz=.5), "rubber", part)
        z = z0 - gap
    return m


ALL = {
    "batiments/terminal.glb": terminal,
    "batiments/tour_controle.glb": tower,
    "batiments/hangar.glb": hangar,
    "batiments/caserne_pompiers.glb": fire_station,
    "batiments/parking.glb": parking,
    "batiments/hotel.glb": hotel,
    "avions/turbopropulseur.glb": turboprop,
    "avions/moyen_courrier.glb": medium_haul,
    "avions/gros_porteur.glb": wide_body,
    "vehicules/voiture.glb": car,
    "vehicules/bus.glb": bus,
    "vehicules/camion_citerne.glb": fuel_truck,
    "vehicules/tracteur_repoussage.glb": pushback_tug,
    "vehicules/train_bagages.glb": baggage_train,
    "vehicules/camion_pompiers.glb": fire_truck,
    "vehicules/chasse_neige.glb": snowplow,
    "vehicules/engin_degivrage.glb": deicer,
    "vehicules/train.glb": train,
}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    for rel, fn in ALL.items():
        p = os.path.join(out, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        m = fn()
        export_glb(m, p)
        lo, hi = m.bounds()
        ntri = sum(len(t) for pp in m.parts.values() for t in pp["tris"].values())
        print(f"{rel:32s} {ntri:5d} tris  taille {hi - lo}")
