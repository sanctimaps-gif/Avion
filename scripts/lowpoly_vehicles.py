"""Régénère les véhicules de generate_assets.py en version mobile (low-poly).

Le script d'origine n'est pas modifié : on plafonne seulement la finesse des
cercles, des sections et du pas de découpe des carrosseries.

Usage : python scripts/lowpoly_vehicles.py <dossier contenant generate_assets.py> <dossier de sortie>
"""
import os, sys, importlib.util

src, out = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("ga", os.path.join(src, "generate_assets.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

RING_MAX, SECTION_MAX, DZ_MIN = 6, 6, 1.2

_ring, _se, _body, _blob, _rr = g.ring, g.se_ring, g.spline_body, g.blob, g._rr_ring
g.ring = lambda c, a, r, n=12, ry=None, phase=0.0: _ring(c, a, r, min(n, RING_MAX), ry, phase)
g.se_ring = lambda z, hw, yb, yt, p=4.0, n=18, taper=0.0, ref=None: _se(z, hw, yb, yt, p, min(n, SECTION_MAX), taper, ref)
def body(*a, **k):
    k["dz"] = max(k.get("dz", .1), DZ_MIN)
    k["n"] = min(k.get("n", 18), SECTION_MAX)
    return _body(*a, **k)
g.spline_body = body
g.blob = lambda center, rx, ry, rz, n=12: _blob(center, rx, ry, rz, min(n, 6))
g._rr_ring = lambda c, u, v, hu, hv, r, nc=3: _rr(c, u, v, hu, hv, r, 1)

for rel, fn in g.ALL.items():
    if not rel.startswith("vehicules/"):
        continue
    p = os.path.join(out, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    m = fn()
    g.export_glb(m, p)
    ntri = sum(len(t) for pp in m.parts.values() for t in pp["tris"].values())
    print(f"{rel:32s} {ntri:5d} tris  {os.path.getsize(p) // 1024} Ko")
