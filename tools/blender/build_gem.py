"""
Ammo gem for scenario 03 NEON RAIN (Blender 4.2+/5.x), Round 3: the heli level's gem SHAPE
(src/entities/PowerUps.js buildGemGeometry: an octagonal crystal - pointed pavilion below,
girdle ring at y 0.04 / radius 0.5, crown ring at y 0.32 / radius 0.27, top at y 0.5) rebuilt
with a real brilliant-style facet layout:
  - a small flat octagonal TABLE (y 0.5, radius 0.2) instead of the point,
  - crown: 8 kite/main facets from the girdle to the table corners, 8 star facets between them,
    16 upper girdle facets,
  - a thin vertical GIRDLE band (y 0.02..0.06, 16 sides),
  - pavilion: 8 main facets to the culet (y -0.5) plus 16 lower girdle facets.
Crisp flat shading. Height ~1.0 (y -0.5..0.5), 1.0 across the girdle; the engine scales/recolours.
  Gem       mesh, material GemBody (deep red glass; the engine recolours per block colour)
    GemCore child mesh: a small emissive octahedral core inside (material GemCore) that lights the
            jewel from within like the key art's radiating red gem (tools/night/ref/gem.png)

    python tools/blender/build_gem.py [--render out_dir]
"""
import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models", "gem.glb")

RG = 0.5          # girdle radius
YG0, YG1 = 0.02, 0.06   # girdle band
RC, YC = 0.27, 0.32     # crown ring (heli gem) - here the kite tips / star base
RT, YT = 0.2, 0.5       # table
YCULET = -0.5


def build():
    import bmesh
    from mathutils import Vector
    bkit.mat("GemBody", 0xb0101c, rough=0.03, metal=0.0, transmission=0.6, ior=1.76, emit=0.15, emit_hex=0xd01828)
    bkit.mat("GemCore", 0xff3040, rough=0.2, emit=3.0, emit_hex=0xff2a3a)
    N = 8
    bm = bmesh.new()
    V = lambda p: bm.verts.new(bkit.tb(p))
    ang = lambda k: 2 * math.pi * k / (2 * N)          # 16 half steps
    P = lambda r, y, k: (math.cos(ang(k)) * r, y, math.sin(ang(k)) * r)
    g_up = [V(P(RG, YG1, k)) for k in range(2 * N)]   # upper girdle edge, 16 points
    g_lo = [V(P(RG, YG0, k)) for k in range(2 * N)]
    table = [V(P(RT, YT, 2 * i)) for i in range(N)]    # table corners at even half steps
    star = [V(P(RC * 0.98, YC + 0.06, 2 * i + 1)) for i in range(N)]  # star points between kites
    culet = V((0, YCULET, 0))
    pav = [V(P(RG * 0.52, YCULET + 0.33, 2 * i)) for i in range(N)]  # lower girdle facet tips
    F = bm.faces.new
    F(table[::-1] if False else table)
    for i in range(N):
        j = (i + 1) % N
        e0, m, e1 = 2 * i, 2 * i + 1, (2 * i + 2) % (2 * N)
        # star facet: table edge + star point
        F((table[i], star[i], table[j]))
        # kite (main crown) facets: girdle corner up to table corner between two stars
        F((g_up[e0], star[i], table[i]))
        F((g_up[e0], table[i], star[(i - 1) % N]))
        # upper girdle facets: between girdle and star point
        F((g_up[e0], g_up[m], star[i]))
        F((g_up[m], g_up[e1], star[i]))
        # girdle band
        for k in (e0, m):
            k2 = (k + 1) % (2 * N)
            F((g_lo[k], g_lo[k2], g_up[k2], g_up[k]))
        # pavilion: lower girdle facets + mains
        F((g_lo[e0], pav[i], g_lo[m]))
        F((g_lo[m], pav[i], g_lo[e1]))
        F((g_lo[e1], pav[i], pav[j]))
        F((pav[i], culet, pav[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Gem")
    bm.to_mesh(me)
    bm.free()
    o = bkit.new_obj("Gem", me, "GemBody")
    for p in o.data.polygons:
        p.use_smooth = False
    core = bkit.lathe("GemCore", [(0.0, -0.22), (0.2, 0.03), (0.0, 0.26)], "GemCore", sides=8, smooth=False)
    core.parent = o
    return o


def main():
    bkit.reset()
    o = build()
    bkit.export([o], OUT)
    if RENDER_DIR:
        os.makedirs(RENDER_DIR, exist_ok=True)
        bkit.preview(os.path.join(RENDER_DIR, "gem.png"), target=(0, 0, 0), cam=(0.3, 1.2, -2.2), lens=50, res=(500, 400),
                     lights=[("AREA", (-1, 2, -1), 60, 0xffffff), ("POINT", (1, 0.5, -1), 20, 0xff60a0)])
    print("gem done")


main()
