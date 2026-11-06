"""
Ammo gem for scenario 03 NEON RAIN (Blender 4.2+/5.x): the faceted diamond of the key art (the red
gem in the tray) and of Blocked's DiamondAtlas - the classic jewel icon standing upright, facing
the camera: a flat table on top, a wide crown down to the girdle, the pavilion tapering to a
point, cut into flat facets front and back (convex hull of the facet points, flat shading).
One model for every colour: the game tints GemCut.

    python tools/blender/build_gem.py [--render out_dir]

Output: assets/models/gem.glb (+ .blend), three.js axes, 1.1 across the girdle, centred on the
origin, the front facing -z:  Gem (mesh, material GemCut)
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

N = 8            # facets round
RG = 0.5         # girdle radius
GIRDLE = 0.035   # girdle half height
TABLE = 0.27     # table radius
CROWN = 0.2      # crown height above the girdle
PAVILION = 0.52  # pavilion depth below the girdle


def build():
    import bmesh
    bkit.mat("GemCut", 0xffffff, rough=0.06, metal=0.15, emit=0.25)
    pts = []
    # Outline (front and back faces at z = -/+0.1): table corners, girdle ends, culet.
    for z in (-0.1, 0.1):
        pts += [(0.3, 0.42, z), (-0.3, 0.42, z), (0.55, 0.16, z), (-0.55, 0.16, z), (0.0, -0.66, z)]
    # Facet points bulging out of the front and the back.
    for sz in (-1, 1):
        for x, y, d in ((0.17, 0.33, 0.22), (-0.17, 0.33, 0.22), (0.38, 0.2, 0.18), (-0.38, 0.2, 0.18), (0.0, 0.18, 0.3),
                        (0.2, -0.08, 0.2), (-0.2, -0.08, 0.2), (0.0, -0.3, 0.16)):
            pts.append((x, y, sz * d))
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(bkit.tb(p))
    bmesh.ops.convex_hull(bm, input=bm.verts)
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
