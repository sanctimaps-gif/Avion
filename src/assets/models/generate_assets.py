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
            n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
            n /= np.linalg.norm(n, axis=1, keepdims=True)
            pos = T.reshape(-1, 3).astype(np.float32)
            nor = np.repeat(n, 3, axis=0).astype(np.float32)
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
