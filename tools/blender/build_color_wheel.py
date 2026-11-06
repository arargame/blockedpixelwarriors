"""
Colour wheel for scenario 03 NEON RAIN (Blender 4.2+/5.x), modelled against the key art
(assets/textures/menu/night.jpg, the dial on the desk right of the tray) - Blocked's colour
system (AIRepos/Blocked, GDD 4.1) as a chunky toy dial:

  - a thick dark base disc with a polished, riveted steel bezel ring (32 rivets) and a knurled
    outer edge;
  - five glossy, slightly domed wedge buttons with dark grooves between them: red at the top,
    then clockwise yellow, green, blue and black;
  - a raised steel ring round a black hub with two small white glyphs.

    python tools/blender/build_color_wheel.py [--render out_dir]

Output: assets/models/color_wheel.glb (+ .blend). three.js axes: the dial lies in the local x-z
plane facing +y (the game tilts it toward the camera); local +z is the top of the dial on screen,
screen right is -x. Nodes:
  ColorWheel          root
    WheelBody         base disc, bezel, rivets, hub ring (WheelSteel, WheelBase, WheelRivet)
    WheelWedges       the five wedges (WedgeRed / WedgeYellow / WedgeGreen / WedgeBlue /
                      WedgeBlack); userData.wedges = JSON [{color, angle}], angle = atan2(x, z) of
                      the wedge centre (radians)
    WheelHub          black hub + glyphs (WheelHubFace, WheelGlyph)
"""
import bpy
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import mat, box, lathe, mesh, join, group  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models", "color_wheel.glb")

# Wedge centres, atan2(x, z): top = 0, screen right (-x) is negative. Clockwise on screen from the
# top: red, yellow, green, blue, black.
WEDGES = [("red", 0xE0201C, 0), ("yellow", 0xF2B812, -72), ("green", 0x2FB82A, -144), ("blue", 0x1F6FE0, 144), ("black", 0x1A1C20, 72)]
R_OUT = 0.92     # wedge outer radius (a dark gap to the bezel)
R_IN = 0.43      # wedge inner radius
GAP = 0.085      # groove width between wedges


def materials():
    mat("WheelBase", 0x15171b, rough=0.35, metal=0.6)
    mat("WheelSteel", 0xb8bec6, rough=0.16, metal=1.0)
    mat("WheelSteelDark", 0x3a3e45, rough=0.3, metal=0.9)
    mat("WheelRivet", 0xd2d7de, rough=0.12, metal=1.0)
    mat("WheelHubFace", 0x0c0d10, rough=0.2, metal=0.2)
    mat("WheelGlyph", 0xf2f4f8, rough=0.3, emit=0.6)
    for name, hexv, _ in WEDGES:
        mat(f"Wedge{name.capitalize()}", hexv, rough=0.12, emit=0.3, emit_hex=hexv)


def wedge(name, a0, a1, material, segs=20):
    """Domed button between angles a0..a1 (radians, atan2(x, z)) and radii R_IN..R_OUT; the
    grooves are cut by insetting each side edge by GAP / 2 (constant width)."""
    rings = 5
    verts, faces = [], []
    H0, H1 = 0.08, 0.2
    W = rings + 1
    for k in range(segs + 1):
        a = a0 + (a1 - a0) * k / segs
        for j in range(rings + 1):
            r = R_IN + (R_OUT - R_IN) * j / rings
            da = (GAP / 2) / r
            aa = min(max(a, a0 + da), a1 - da)
            t = j / rings
            s = k / segs
            dome = 0.02 * math.sin(math.pi * t) * math.sin(math.pi * s) ** 0.6
            verts.append((math.sin(aa) * r, H1 + dome, math.cos(aa) * r))
    top = len(verts)
    outline = [k * W for k in range(segs + 1)]
    outline += [segs * W + j for j in range(1, rings + 1)]
    outline += [k * W + rings for k in range(segs - 1, -1, -1)]
    outline += [j for j in range(rings - 1, 0, -1)]
    for i in outline:
        x, y, z = verts[i]
        verts.append((x, H0, z))
    for k in range(segs):
        for j in range(rings):
            a = k * W + j
            faces.append((a, a + 1, a + W + 1, a + W))
    n = len(outline)
    for i in range(n):
        a, b = outline[i], outline[(i + 1) % n]
        faces.append((b, a, top + i, top + (i + 1) % n))
    faces.append(tuple(top + i for i in range(n)))
    o = mesh(name, verts, faces, material, smooth=True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def build():
    materials()
    body = [
        lathe("WheelBaseDisc", [(0.0, -0.22), (1.33, -0.22), (1.36, -0.16), (1.36, 0.06), (1.3, 0.1), (0.0, 0.1)], "WheelBase", sides=96),
        # Wide flat polished bezel with rolled edges.
        lathe("WheelBezel", [(1.0, 0.1), (1.34, 0.1), (1.37, 0.15), (1.35, 0.22), (1.3, 0.24), (1.05, 0.24), (1.01, 0.21), (1.0, 0.1)], "WheelSteel", sides=96),
        lathe("WheelHubRing", [(0.29, 0.08), (0.41, 0.08), (0.41, 0.24), (0.38, 0.29), (0.32, 0.29), (0.29, 0.26)], "WheelSteel", sides=64),
    ]
    for i in range(32):
        a = 2 * math.pi * (i + 0.5) / 32
        for rr in (1.1, 1.26):
            x, z = math.sin(a) * rr, math.cos(a) * rr
            body.append(lathe(f"Rivet{i}_{rr}", [(0.032, 0.0), (0.032, 0.01), (0.024, 0.025), (0.0, 0.032)], "WheelRivet", sides=8, centre=(x, 0.235, z)))
    for i in range(72):
        t = box(f"Knurl{i}", (0, -0.05, 1.37), (0.05, 0.2, 0.04), "WheelSteelDark")
        bkit.rotate_y(t, 2 * math.pi * i / 72)
        body.append(t)
    body_o = join(body, "WheelBody")

    wedges, info = [], []
    for name, _, centre in WEDGES:
        c = math.radians(centre)
        wedges.append(wedge(f"Wedge_{name}", c - math.radians(36), c + math.radians(36), f"Wedge{name.capitalize()}"))
        info.append({"color": name, "angle": round(c, 5)})
    wedges_o = join(wedges, "WheelWedges")
    wedges_o["wedges"] = json.dumps(info)

    hub = [lathe("HubFace", [(0.0, 0.2), (0.3, 0.2), (0.3, 0.22), (0.0, 0.235)], "WheelHubFace", sides=48)]
    for sx in (-1, 1):
        hub.append(lathe(f"Glyph{sx}", [(0.0, 0.0), (0.06, 0.0), (0.06, 0.02), (0.0, 0.025)], "WheelGlyph", sides=16, centre=(sx * 0.1, 0.235, 0.0)))
        hub.append(box(f"GlyphStem{sx}", (sx * 0.155, 0.245, 0.03), (0.025, 0.02, 0.14), "WheelGlyph"))
    hub_o = join(hub, "WheelHub")
    return group("ColorWheel", [body_o, wedges_o, hub_o])


def main():
    bkit.reset()
    root = build()
    bkit.export([root], OUT)
    if RENDER_DIR:
        os.makedirs(RENDER_DIR, exist_ok=True)
        root.rotation_euler = (math.radians(-38), 0, 0)
        bkit.preview(os.path.join(RENDER_DIR, "color_wheel.png"), target=(0, 0, 0), cam=(0.6, 2.7, -2.4), lens=50, res=(800, 800),
                     lights=[("AREA", (-1.5, 3, -1.5), 120, 0xffd0a0), ("POINT", (2, 1.5, 1), 40, 0x6080ff)], samples=48)
    print("color wheel done")


main()
