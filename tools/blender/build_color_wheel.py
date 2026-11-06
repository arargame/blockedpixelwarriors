"""
Colour wheel for scenario 03 NEON RAIN (Blender 4.2+/5.x), modelled against the key art
(assets/textures/menu/night.jpg, the dial on the desk right of the tray, art x 1440-1670,
y 432-670; crops tools/night/ref/wheel.png): Blocked's colour system (AIRepos/Blocked, GDD 4.1)
as a chunky toy dial.

What the art shows, and what is built:
  - a thick dark puck; under the bezel a ring of short steel segments (like the vented ring of a
    brake disc), then the dark glossy body down to the desk;
  - a wide GREY polished steel bezel ring: raised polished outer lip, a flat concentric-brushed
    band with fine engraved marks (thin recessed ticks and small glyphs, texture: normal +
    roughness), a thin raised inner lip, then a dark channel round the wedges. No rivets: the
    white specks of the art are rain drops (WaterDrop, clear water) on the metal and wedges;
  - five glossy domed wedges with dark grooves: red at the top, then clockwise on screen yellow,
    green, blue, black;
  - a polished chrome ring round a black hub with two small white glyphs (left: a rounded box
    with a notch, right: a rounded square ring), as in the art.

    python tools/blender/build_color_wheel.py [--render out_dir]

Output: assets/models/color_wheel.glb (+ .blend). three.js axes: the dial lies in the local x-z
plane facing +y (the game tilts it toward the camera); local +z is the top of the dial on screen,
screen right is -x. The puck's bottom face is at y = -1.1, the bezel's top at y = 0.285.
Nodes:
  ColorWheel          root (origin = the dial's centre at the wedge base level)
    WheelBody         puck, vent ring, bezel, channel floor, bezel drops
                      (WheelBase, WheelSteel, WheelSteelDark, WaterDrop)
    WheelWedges       the five wedges + their drops (WedgeRed / WedgeYellow / WedgeGreen /
                      WedgeBlue / WedgeBlack, WaterDrop); userData.wedges = JSON [{color, angle}],
                      angle = atan2(x, z) of the wedge centre (radians). Centred on the origin:
                      spin it about local y to turn the dial.
    WheelHub          chrome ring, black hub face, glyphs (WheelChrome, WheelHubFace, WheelGlyph);
                      centred on the origin (turns with the wedges).
"""
import bpy
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import mat, box, lathe, mesh, join, group  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models", "color_wheel.glb")

# Wedge centres, atan2(x, z): top = 0, screen right (-x) is negative. Clockwise on screen from the
# top: red, yellow, green, blue, black.
WEDGES = [("red", 0xD8231E, 0), ("yellow", 0xE89A26, -72), ("green", 0x2DB82B, -144), ("blue", 0x1E6FE0, 144), ("black", 0x17191d, 72)]
# Proportions measured on the art (bezel outer radius = 1.385):
R_BEZ = 1.385    # bezel outer edge
R_BAND = (1.175, 1.305)   # flat engraved band
R_CH = 1.125     # inner lip / dark channel edge
R_OUT = 1.06     # wedge outer radius
R_IN = 0.53      # wedge inner radius
R_HUB = (0.36, 0.475)    # chrome ring inner / outer
GAP = 0.075      # groove width between wedges
TEXR = 1.42      # half size of the planar texture square

rng = np.random.default_rng(11)


# ---------------------------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------------------------
def polar(S):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    u, v = (x + 0.5) / S, 1 - (y + 0.5) / S
    X, Z = (u * 2 - 1) * TEXR, (v * 2 - 1) * TEXR
    return np.hypot(X, Z), np.arctan2(X, Z), X, Z


def smooth1d(n, k, seed):
    a = np.random.default_rng(seed).standard_normal(n)
    ker = np.exp(-np.linspace(-2, 2, k) ** 2)
    return np.convolve(np.tile(a, 3), ker / ker.sum(), "same")[n:2 * n]


GLYPHS = [
    # tiny engraved marks (3 x 4 cells), different shapes round the band
    ["XXX", "X..", "XXX", "X.X"], ["XXX", "X.X", "XXX", "X.X"], [".X.", "X.X", "X.X", ".X."],
    ["X..", "X..", "XXX", "XXX"], ["XX.", "..X", ".X.", "XXX"], ["X.X", "X.X", "XXX", "..X"],
]


def tex_bezel():
    """Polished steel bezel (planar top-down UV): concentric brushing, engraved band marks.
    Returns (colour, rough_metal, normal) images."""
    S = 1536
    r, th, X, Z = polar(S)
    # Concentric brushing: fine random rings (a function of radius), slightly modulated round.
    rings = smooth1d(6000, 5, 1)
    idx = np.clip((r / TEXR * 5999).astype(int), 0, 5999)
    brush = rings[idx] * (0.8 + 0.2 * np.sin(th * 3 + 1.3))
    h = brush * 0.004
    eng = np.zeros((S, S), np.float32)
    band = (r > R_BAND[0] + 0.012) & (r < R_BAND[1] - 0.012)
    # Engraved marks: 48 positions round the band; a fine radial tick at each and a small glyph
    # between them (thin recessed lines, as the art's band).
    n = 36
    cell = 0.018
    rm = (R_BAND[0] + R_BAND[1]) / 2
    for k in range(n):
        a = 2 * math.pi * k / n
        # tick
        da = np.angle(np.exp(1j * (th - a)))
        tick = (np.abs(da * r) < 0.004) & (np.abs(r - rm) < 0.03)
        # glyph between ticks
        g = GLYPHS[k % len(GLYPHS)]
        ag = a + math.pi / n
        dag = np.angle(np.exp(1j * (th - ag))) * rm
        dr = r - rm
        sel = (np.abs(dag) < 2 * cell) & (np.abs(dr) < 2.2 * cell)
        if not sel.any():
            continue
        cx = np.floor((dag[sel] / cell) + 1.5).astype(int)        # 0..2 across
        cy = np.floor((-dr[sel] / cell) + 2.0).astype(int)        # 0..3 outward -> down
        ok = (cx >= 0) & (cx < 3) & (cy >= 0) & (cy < 4)
        vals = np.zeros(sel.sum(), np.float32)
        for i in np.nonzero(ok)[0]:
            vals[i] = 1.0 if g[cy[i]][cx[i]] == "X" else 0.0
        e2 = eng[sel]
        eng[sel] = np.maximum(e2, vals * 0.85)
    from PIL import Image, ImageFilter
    eng_i = Image.fromarray((eng * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1))
    eng = np.asarray(eng_i, np.float32) / 255
    h = h - eng * 0.02
    # Colour: grey steel, the band a touch darker than the polished lips, the engraving dark.
    lip = (r > R_BAND[1]) | (r < R_BAND[0])
    grey = np.where(lip, 0.7, 0.27) + brush * 0.04
    grey = grey * (1 - eng * 0.75)
    col = np.stack([grey * 0.97, grey * 0.99, grey * 1.02], -1)
    rough = np.where(lip, 0.06, 0.14) + np.abs(brush) * 0.04 + eng * 0.35
    rm_img = np.stack([np.zeros_like(rough), rough, np.ones_like(rough)], -1)
    nrm = bkit.height_to_normal(h, strength=S / (2 * TEXR) * 1.0)
    return bkit.image("WheelSteel", col), bkit.data_image("WheelSteelRM", rm_img), bkit.data_image("WheelSteelN", nrm)


def tex_wedge_micro():
    """Micro rain drops on the wedges (planar UV): small round bumps for the normal map and a
    glossier roughness under them."""
    S = 1024
    r, th, X, Z = polar(S)
    h = np.zeros((S, S), np.float32)
    px = 2 * TEXR / S
    for _ in range(900):
        rr = np.sqrt(rng.uniform(R_IN ** 2, R_OUT ** 2))
        a = rng.uniform(0, 2 * math.pi)
        cx, cz = math.sin(a) * rr, math.cos(a) * rr
        rad = rng.choice([0.004, 0.006, 0.008, 0.011], p=[0.4, 0.3, 0.2, 0.1])
        c, rw = int((cx / TEXR + 1) / 2 * S), int((1 - (cz / TEXR + 1) / 2) * S)
        k = int(rad / px) + 2
        ys, xs = slice(max(rw - k, 0), rw + k), slice(max(c - k, 0), c + k)
        d = np.hypot(X[ys, xs] - cx, Z[ys, xs] - cz) / rad
        h[ys, xs] = np.maximum(h[ys, xs], np.sqrt(np.clip(1 - d * d, 0, 1)) * rad * 0.5)
    nrm = bkit.height_to_normal(h, strength=S / (2 * TEXR))
    return bkit.data_image("WedgeDropsN", nrm)


def materials():
    col, rmi, nrm = tex_bezel()
    mat("WheelSteel", rough=0.12, metal=1.0, image=col, rough_metal=rmi, normal=nrm)
    mat("WheelSteelDark", 0x3a3e45, rough=0.25, metal=1.0)
    mat("WheelBase", 0x0e1013, rough=0.22, metal=0.7, coat=(0.6, 0.08))
    mat("WheelChrome", 0xd8dde3, rough=0.06, metal=1.0)
    mat("WheelHubFace", 0x0a0b0d, rough=0.12, metal=0.2, coat=(1.0, 0.05))
    mat("WheelGlyph", 0xf2f4f8, rough=0.3, emit=0.5)
    mat("WaterDrop", 0xffffff, rough=0.02, transmission=1.0, ior=1.33)
    micro = tex_wedge_micro()
    for name, hexv, _ in WEDGES:
        mat(f"Wedge{name.capitalize()}", hexv, rough=0.14, emit=0.3, emit_hex=hexv, coat=(1.0, 0.04), normal=micro, normal_strength=0.8)


# ---------------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------------
def wedge(name, a0, a1, material, segs=24):
    """Domed button between angles a0..a1 (radians, atan2(x, z)) and radii R_IN..R_OUT; the
    grooves are cut by insetting each side edge by GAP / 2 (constant width); the top rolls over
    at the edges (bevel)."""
    rings = 8
    verts, faces = [], []
    H0, H1 = 0.06, 0.18
    W = rings + 1
    for k in range(segs + 1):
        a = a0 + (a1 - a0) * k / segs
        for j in range(rings + 1):
            r = R_IN + (R_OUT - R_IN) * j / rings
            da = (GAP / 2) / r
            aa = min(max(a, a0 + da), a1 - da)
            t = j / rings
            s = k / segs
            dome = 0.035 * math.sin(math.pi * t) ** 0.7 * math.sin(math.pi * s) ** 0.5
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
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = 0.022
    m.segments = 3
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(40)
    m.harden_normals = False
    bkit.apply_mods(o)
    o.data.shade_smooth()
    return o


def rrect_ring(name, cx, cz, w, h, wall, y0, y1, material, n=48, p=4.0, notch=None):
    """Raised rounded-rectangle outline (superellipse of exponent p) on the hub face."""
    def pt(t, ww, hh):
        c, s = math.cos(t), math.sin(t)
        return (cx + ww / 2 * math.copysign(abs(c) ** (2 / p), c), cz + hh / 2 * math.copysign(abs(s) ** (2 / p), s))
    outer = [pt(2 * math.pi * i / n, w, h) for i in range(n)]
    inner = [pt(2 * math.pi * i / n, w - 2 * wall, h - 2 * wall) for i in range(n)]
    verts = [(x, y1, z) for x, z in outer] + [(x, y1, z) for x, z in inner] + [(x, y0, z) for x, z in outer] + [(x, y0, z) for x, z in inner]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))                  # top
        faces.append((2 * n + j, 2 * n + i, i, j))          # outer wall
        faces.append((n + i, n + j, 3 * n + j, 3 * n + i))  # inner wall
    o = mesh(name, verts, faces, material, smooth=False)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def drop_field(n, rmin, rmax, y, seed, rsizes=(0.012, 0.035), cluster=0.5):
    """Sparse, irregular drops on a flat annulus at height y: some lone, some in loose clusters."""
    r = np.random.default_rng(seed)
    items = []
    centres = [(math.sqrt(r.uniform(rmin ** 2, rmax ** 2)), r.uniform(0, 2 * math.pi)) for _ in range(max(1, n // 5))]
    for i in range(n):
        if r.random() < cluster:
            rr, a = centres[r.integers(len(centres))]
            rr = min(max(rr + r.normal(0, 0.05), rmin), rmax)
            a += r.normal(0, 0.12)
        else:
            rr, a = math.sqrt(r.uniform(rmin ** 2, rmax ** 2)), r.uniform(0, 2 * math.pi)
        size = rsizes[0] + (rsizes[1] - rsizes[0]) * r.random() ** 2.5
        items.append(((math.sin(a) * rr, y, math.cos(a) * rr), (0, 1, 0), size))
    return items


def wedge_height(r, a):
    """Top height of the wedges at (r, a) (approx., for seating drops)."""
    t = (r - R_IN) / (R_OUT - R_IN)
    return 0.18 + 0.03 * math.sin(math.pi * min(max(t, 0), 1)) ** 0.7


def build():
    materials()
    # Puck: dark glossy body, the vented steel ring under the bezel.
    body = [
        lathe("WheelPuck", [(0.0, -1.1), (1.30, -1.1), (1.34, -1.07), (1.345, -0.2), (1.335, -0.17), (1.0, -0.17)], "WheelBase", sides=96, caps=(True, False)),
        lathe("WheelVentCore", [(1.33, -0.18), (1.35, -0.18), (1.35, 0.02), (1.33, 0.02)], "WheelSteelDark", sides=96, caps=(False, False)),
        # Channel floor round the wedges and the floor under them / round the hub.
        lathe("WheelFloor", [(0.0, 0.06), (R_CH + 0.01, 0.06), (R_CH + 0.01, 0.0)], "WheelBase", sides=96, caps=(True, False)),
    ]
    for i in range(48):
        t = box(f"Vent{i}", (0, -0.08, 1.36), (0.15, 0.17, 0.05), "WheelSteelDark", bevel=0.01, segs=1)
        bkit.apply_mods(t)
        bkit.rotate_y(t, 2 * math.pi * (i + 0.5) / 48)
        body.append(t)
    # Bezel: inner lip, flat band, raised polished outer lip, outer wall down to the vent ring.
    prof = [(R_CH, 0.06), (R_CH, 0.215), (R_CH + 0.012, 0.243), (R_CH + 0.03, 0.25), (R_BAND[0] - 0.012, 0.243),
            (R_BAND[0], 0.228), (R_BAND[1], 0.228), (R_BAND[1] + 0.012, 0.245), (R_BAND[1] + 0.035, 0.278),
            (R_BEZ - 0.03, 0.287), (R_BEZ - 0.008, 0.272), (R_BEZ, 0.24), (R_BEZ, 0.04), (R_BEZ - 0.02, 0.02), (1.34, 0.02)]
    bez = lathe("WheelBezel", prof, "WheelSteel", sides=192, caps=(False, False))
    bkit.uv_planar(bez, TEXR)
    body_o = join(body, "WheelBodyCore")
    bkit.uv_planar(body_o, TEXR)
    # Rain drops on the bezel (band and lips), sparse and irregular.
    d_items = drop_field(48, R_BAND[0] + 0.01, R_BAND[1] - 0.01, 0.228, 5, (0.012, 0.042))
    d_items += drop_field(16, R_BAND[1] + 0.04, R_BEZ - 0.035, 0.286, 6, (0.01, 0.026))
    d_items += drop_field(6, R_CH + 0.02, R_CH + 0.035, 0.25, 7, (0.008, 0.016))
    bez_drops = bkit.drops("WheelBezelDrops", d_items, "WaterDrop")
    body_o = join([body_o, bez, bez_drops], "WheelBody")

    wedges, info = [], []
    for name, _, centre in WEDGES:
        c = math.radians(centre)
        wedges.append(wedge(f"Wedge_{name}", c - math.radians(36), c + math.radians(36), f"Wedge{name.capitalize()}"))
        info.append({"color": name, "angle": round(c, 5)})
    for w in wedges:
        bkit.uv_planar(w, TEXR)
    # Drops on the wedges (keep them off the grooves).
    items = []
    r = np.random.default_rng(21)
    while len(items) < 95:
        rr = math.sqrt(r.uniform((R_IN + 0.05) ** 2, (R_OUT - 0.05) ** 2))
        a = r.uniform(-math.pi, math.pi)
        k = (a + math.radians(36)) % math.radians(72)
        if min(k, math.radians(72) - k) * rr < GAP / 2 + 0.03:
            continue
        size = 0.01 + 0.032 * r.random() ** 3
        items.append(((math.sin(a) * rr, wedge_height(rr, a) - 0.002, math.cos(a) * rr), (0, 1, 0), size))
    wedges.append(bkit.drops("WedgeDrops", items, "WaterDrop"))
    wedges_o = join(wedges, "WheelWedges")
    wedges_o["wedges"] = json.dumps(info)

    hub = [
        lathe("HubRing", [(R_HUB[0], 0.06), (R_HUB[1], 0.06), (R_HUB[1], 0.215), (R_HUB[1] - 0.015, 0.255), (R_HUB[1] - 0.045, 0.274),
                          (R_HUB[0] + 0.04, 0.274), (R_HUB[0] + 0.012, 0.252), (R_HUB[0], 0.215)], "WheelChrome", sides=96, caps=(False, False)),
        lathe("HubFace", [(0.0, 0.2), (R_HUB[0] + 0.002, 0.2), (R_HUB[0] + 0.002, 0.12)], "WheelHubFace", sides=64, caps=(True, False)),
    ]
    # Glyphs (art: left = a rounded box with a dark centre and a notch at its top left; right = a
    # rounded square ring). +x is screen left.
    hub.append(rrect_ring("GlyphL", 0.125, -0.01, 0.15, 0.105, 0.03, 0.2, 0.214, "WheelGlyph"))
    hub.append(box("GlyphLNotch", (0.165, 0.207, 0.055), (0.04, 0.014, 0.035), "WheelGlyph"))
    hub.append(box("GlyphLDot", (0.125, 0.207, -0.01), (0.03, 0.014, 0.028), "WheelGlyph"))
    hub.append(rrect_ring("GlyphR", -0.115, 0.0, 0.12, 0.115, 0.028, 0.2, 0.214, "WheelGlyph"))
    hub_o = join(hub, "WheelHub")
    return group("ColorWheel", [body_o, wedges_o, hub_o])


# Recommended placement (fit to the art, see designer_log.md): root pos / rotY / scale, dial tilt.
PLACE = dict(pos=(-11.97, 1.51, -1.65), rot_y=-1.0, scale=1.165, tilt_x=-0.45)
DIAL_SPIN = 1.0   # turn of WheelWedges + WheelHub about local y that puts red back at the top


def render(out_dir, root):
    import artcam
    os.makedirs(out_dir, exist_ok=True)
    artcam.place(root, **PLACE)
    for c in root.children:
        if c.name in ("WheelWedges", "WheelHub"):
            c.rotation_euler = (0, 0, DIAL_SPIN)
    artcam.context(["DeskTop", "NightTray"])
    artcam.world()
    artcam.lights()
    box_ = (1400, 400, 1672, 700)
    p = artcam.render(os.path.join(out_dir, "wheel_art.png"), box=box_, samples=64)
    ref = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "night", "ref", "design_wheel.png")
    artcam.side_by_side(box_, p, ref, height=600)


def main():
    bkit.reset()
    root = build()
    bkit.export([root], OUT, image_format="JPEG")
    if RENDER_DIR:
        render(RENDER_DIR, root)
    print("color wheel done")


main()
