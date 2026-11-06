"""
Ammo gem for scenario 03 NEON RAIN (Blender 4.2+/5.x): the red jewel of the key art (the gem in
the tray, art ~70 x 80 px at (1012,488), tools/night/ref/gem.png): an UPRIGHT square bipyramid -
an octahedron standing on its point, taller than wide - with one vertical EDGE toward the camera
(two crown faces and two pavilion faces visible, as in the art), a thin girdle band a little
above the middle (crown 0.56, pavilion 0.72 high), every main face split into two facets along
its centre line for crisp highlights. Flat shading. One model for every colour: the game tints
GemCut.

    python tools/blender/build_gem.py [--render out_dir]

Output: assets/models/gem.glb (+ .blend), three.js axes, 1.0 across the girdle, ~1.32 tall,
centred on the girdle, an edge facing -z:  Gem (mesh, material GemCut)
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

RG = 0.5         # girdle radius (to the corners)
GIRDLE = 0.02    # girdle half height
CROWN = 0.56     # apex above the girdle
PAVILION = 0.72  # culet below the girdle


def build():
    import bmesh
    bkit.mat("GemCut", 0xffffff, rough=0.06, metal=0.15, emit=0.25)
    bm = bmesh.new()
    V = lambda p: bm.verts.new(bkit.tb(p))
    # Square girdle corners at 0/90/180/270 deg from -z: one corner (a vertical edge line of the
    # crown and pavilion) faces the camera.
    corners = [(math.sin(a) * RG, math.cos(a) * RG) for a in (math.pi, math.pi * 1.5, 0.0, math.pi * 0.5)]
    up = [V((x, GIRDLE, z)) for x, z in corners]
    lo = [V((x, -GIRDLE, z)) for x, z in corners]
    top = V((0, GIRDLE + CROWN, 0))
    bot = V((0, -GIRDLE - PAVILION, 0))
    # mid points of the girdle edges, pushed out a touch, split each face into two facets
    mu, ml = [], []
    for i in range(4):
        (x0, z0), (x1, z1) = corners[i], corners[(i + 1) % 4]
        mx, mz = (x0 + x1) / 2 * 1.12, (z0 + z1) / 2 * 1.12
        mu.append(V((mx, GIRDLE, mz)))
        ml.append(V((mx, -GIRDLE, mz)))
    for i in range(4):
        j = (i + 1) % 4
        for a, m_, b in ((up[i], mu[i], up[j]),):
            bm.faces.new((a, m_, top))
            bm.faces.new((m_, b, top))
        bm.faces.new((ml[i], lo[i], bot))
        bm.faces.new((lo[j], ml[i], bot))
        bm.faces.new((up[i], lo[i], ml[i], mu[i]))
        bm.faces.new((mu[i], ml[i], lo[j], up[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Gem")
    bm.to_mesh(me)
    bm.free()
    o = bkit.new_obj("Gem", me, "GemCut")
    for p in o.data.polygons:
        p.use_smooth = False
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
