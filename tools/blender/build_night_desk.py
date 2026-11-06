"""
Desk diorama kit for scenario 03 NEON RAIN (Blender 4.2+/5.x), modelled piece by piece against
the key art (assets/textures/menu/night.jpg): a wooden toy tray on a wet desk by a rainy window
at midnight, lit by a brass desk lamp.

    python tools/blender/build_night_desk.py [--render out_dir]

Output: assets/models/night_desk.glb (+ .blend), three.js axes (y up, the art camera looks
toward +z; screen right is -x). Top-level nodes (placed by src/night/NightLayout.js):

  NightTray     the tray: four weathered wet wooden beams (straight grain) with chunky corner
                posts, a dark steel dome bolt on each corner post, screw heads along the beams,
                the dark base slab under the field (field x -9..9, z -6..9; deck surface y = 0)
  DeskTop       dark wet desk planks, top at y = -0.32
  DeskLamp      brass lamp at world scale, origin = base centre (place at LAMP_BASE, scale 1):
                LampBody (base, stem + collars, knuckle + knob, curved arm), LampHead (black
                enamel dome, brass rim + neck, warm inside, socket, bulb LampBulb, drops);
                empties LampLight (bulb) and LampAim (where the opening points)
  Mug           off-white ceramic mug, the traced tank print, MugRim, MugCoffee ("Coffee")
  Crate         one steel crate in the CrateStack look (painted tank on the front)
  CrateStack    CrateLower (painted tank) + CrateUpper (recessed slot) stacked, the art's pair
  Pencil        natural cedar hex pencil, shaved cone, black graphite point (along +x)
  SketchPaper   grey sketch paper with the traced tank as a pencil outline (baked for PLACE)
  Plant         pothos in a dark pot (dark green; the blurred bottom-left plant)
  PlantBox      pothos in a slatted wooden planter (yellow-green; behind the crates)
  SpikeMine     the mine: pixel-patch cube-sphere, origin at the bottom, MineBall = centre
Recommended world placements (fit to the art with the art camera): PLACE below; previews with
--render out_dir [--piece A,B] -> tools/night/ref/design_*.png.
"""
import bpy
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
from bkit import mat, box, cylinder, lathe, lathe_uv, mesh, join, group, tube_path, empty  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models", "night_desk.glb")

# Field (GameConfig.night): x -9..9, z -6..9, deck at y = 0.
IN_X, Z0, Z1 = 9.0, -6.0, 9.0
BEAM = 1.25        # beam width
TOP = 1.05         # beam top
POST = 1.6         # corner post size
POST_TOP = 1.25
BASE = -0.32       # bottom of the tray = desk top

# The Blocked pixel tank (mug, crate, paper), TRACED FROM THE ART - do not redraw it: the mug
# print of assets/textures/menu/night.jpg (x 30-150, y 410-545) deskewed (vertical shear 0.27,
# the mug's curvature), dark pixels thresholded and sampled on the best-fitting grid (cell 3.56 art
# px; 27 x 24 cells). Proof: tools/night/ref/design_icon_trace.png (art | deskewed + cells | grid).
# Turret with the barrel to the right and its muzzle raised, stepped hull, the track band with the
# light "T" window and the two dark wheels.
TANK_ICON = [
    ".............XXXXX.........",
    ".............XXXXX....XXX..",
    ".............XXXXXXXXXXXX..",
    ".............XXXXXXXXXXXX..",
    ".............XXXXXXXXXXXX..",
    ".........XXXXXXXXX.........",
    ".........XXXXXXXXX.........",
    ".........XXXXXXXXX.........",
    "....XXXXXXXXXXXXXXX.XXX....",
    "....XXXXXXXXXXXXXXXXXXX....",
    "....XXXXXXXXXXXXXXXXXXX....",
    "....XXXXXXXXXXXXXXXXXXX....",
    "XXXXXXX..............XXX...",
    "XXXXXXX..............XXXXXX",
    "XXXXXXX.XXXXX...XXXX.XXXXXX",
    "XXXXXXX.XXXXX...XXXX.XXXXXX",
    "XXXXX...XXXXX...XXXX...XXXX",
    "XXXXXX..XXXXX...XXXX....XXX",
    "XXXXXXX..XXXX...XXXX..XXXXX",
    "XXXXXXX...XXX...XXX...XXXXX",
    "...XXXXXXXXXX...XXX...XXX..",
    "....XXXXXXXXXXXXXXXXXXXXX..",
    "....XXXXXXXXXXXXXXXXXXXXX..",
    "....XXXXXXXXXXXXXXXXXXXXX..",
]
ICON_W, ICON_H = len(TANK_ICON[0]), len(TANK_ICON)

rng = np.random.default_rng(3)
prng = random.Random(9)


def noise(S, cells, seed):
    from PIL import Image
    r = np.random.default_rng(seed).random((cells, cells)).astype(np.float32)
    return np.asarray(Image.fromarray((r * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255


def icon_mask(S, x0, y0, px, fg=1.0, py=None, H=None):
    """Mask (H x S, H defaults to S) with the pixel tank drawn from (x0, y0) at px (x) / py (y)
    image pixels per icon cell (row 0 of the icon at the top of the image)."""
    py = px if py is None else py
    m = np.zeros((H or S, S), np.float32)
    for r, row in enumerate(TANK_ICON):
        for c, ch in enumerate(row):
            if ch == "X":
                m[int(round(y0 + r * py)):int(round(y0 + (r + 1) * py)), int(round(x0 + c * px)):int(round(x0 + (c + 1) * px))] = fg
    return m


# ---------------------------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------------------------
def noise_aniso(S, cx, cy, seed):
    """Smooth random field (S x S) with cx cells across (u) and cy cells down (v): stretched
    along u for straight wood grain."""
    from PIL import Image
    r = np.random.default_rng(seed).random((cy, cx)).astype(np.float32)
    return np.asarray(Image.fromarray((r * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255


def wood(S, seed, spacing=7.0, cracks=6):
    """Straight weathered grain along u (lines are functions of v with a gentle drift).
    Returns (shade 0..1, groove height, crack mask)."""
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    yy = y + (noise_aniso(S, 3, 10, seed + 1) - 0.5) * 14 + (noise_aniso(S, 10, 80, seed + 2) - 0.5) * 3
    # growth lines: random positions / widths / darkness along v
    prof = np.zeros(S * 2, np.float32)
    pos = 0.0
    while pos < S * 2:
        pos += spacing * (0.5 + r.random())
        w = 0.6 + 1.8 * r.random() ** 2
        dk = 0.3 + 0.7 * r.random()
        i0, i1 = int(pos - 3 * w), int(pos + 3 * w) + 1
        idx = np.arange(max(i0, 0), min(i1, S * 2))
        prof[idx] = np.maximum(prof[idx], dk * np.exp(-((idx - pos) / w) ** 2))
    lines = prof[np.clip(yy.astype(int) + S // 2, 0, S * 2 - 1)]
    streak = noise_aniso(S, 4, 40, seed + 3)
    shade = 0.8 + 0.24 * streak - 0.5 * lines - 0.08 * noise_aniso(S, 2, 6, seed + 4)
    crack = np.zeros((S, S), np.float32)
    for k in range(cracks):
        cy, x0 = r.random() * S, r.random() * S
        L = S * (0.25 + 0.5 * r.random())
        xs = np.arange(int(x0), int(min(S, x0 + L)))
        if len(xs) == 0:
            continue
        wob = cy + np.cumsum(r.normal(0, 0.25, len(xs)))
        w = 1.0 + 1.2 * r.random()
        for xi, yc in zip(xs, wob):
            y0, y1 = int(max(yc - 3, 0)), int(min(yc + 4, S))
            col = np.arange(y0, y1)
            crack[col, xi] = np.maximum(crack[col, xi], np.exp(-((col - yc) / w) ** 2) * (1 - abs((xi - x0) / L - 0.5) * 1.6))
    crack = np.clip(crack, 0, 1)
    shade = shade * (1 - 0.75 * crack)
    h = -(lines * 0.6 + crack * 2.0) / S
    return shade, h, crack


def tex_beam(dark=1.0):
    """Tray beams: dark weathered wet wood, straight deep grain along u, a few cracks
    (art: left beam ~ (143, 89, 54) mean, bottom beam darker). Colour + normal + roughness."""
    S = 1024
    shade, h, crack = wood(S, 101, spacing=5.0, cracks=16)
    shade = shade * (0.85 + 0.15 * noise_aniso(S, 6, 3, 105))      # weathered, uneven
    img = np.stack([shade * 0.5, shade * 0.31, shade * 0.195], -1) * dark
    rough = 0.28 + 0.12 * (1 - shade) + 0.2 * crack
    rm = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    return bkit.image("TrayWood", img), bkit.data_image("TrayWoodRM", rm), bkit.data_image("TrayWoodN", bkit.height_to_normal(h, strength=S * 1.5))


def tex_desk():
    """Desk: dark wet planks along u, straight grain, seams every quarter (dark brown-grey)."""
    S = 1024
    shade, h, crack = wood(S, 111, spacing=9.0, cracks=4)
    y = np.mgrid[0:S, 0:S][0]
    plank = (y // (S / 4)).astype(int)
    shade = shade * np.array([0.95, 1.06, 0.9, 1.0])[plank]
    seam = (y % (S / 4)) < 5
    shade[seam] = 0.12
    h = h - seam * (3.0 / S)
    img = np.stack([shade * 0.31, shade * 0.22, shade * 0.14], -1)
    rough = 0.22 + 0.1 * (1 - shade)
    rm = np.stack([np.zeros_like(rough), rough, np.zeros_like(rough)], -1)
    return bkit.image("DeskWood", img), bkit.data_image("DeskWoodRM", rm), bkit.data_image("DeskWoodN", bkit.height_to_normal(h, strength=S * 1.2))


MUG_R, MUG_H = 1.8, 3.2
MUG_ICON_W = 1.66            # icon width on the mug (art: ~97 px of a ~170 px wide mug)
MUG_ICON_V = 0.52            # icon centre, fraction of the height from the foot (art)


def tex_mug():
    """Off-white ceramic round the mug body (lathe_uv: u = 0.5 faces three.js -z, u grows toward
    +x = screen left; v = 0 at the foot, 1 at the rim) with the traced black pixel tank."""
    W, H = 2048, 1024
    img = np.ones((H, W, 3), np.float32) * np.array([0.74, 0.72, 0.70])
    img *= (0.97 + 0.03 * noise(W, 96, 21)[:H, :W])[..., None]
    circ = 2 * math.pi * MUG_R
    px = MUG_ICON_W / ICON_W / circ * W              # texture px per icon cell along u
    py = 1.1 * MUG_ICON_W / ICON_W / MUG_H * H       # ... along v (cells 1.1x taller: the art's print, seen on the leaned mug)
    x0 = W / 2 - ICON_W * px / 2
    y0 = (1 - MUG_ICON_V) * H - ICON_H * py / 2      # image row 0 = v 1 (rim)
    m = icon_mask(W, x0, y0, px, py=py, H=H)
    img[m > 0.5] = (0.035, 0.035, 0.04)
    # Mirror u only: image column 0 must land on screen left, and u grows toward screen left.
    return bkit.image("MugEnamel", img[:, ::-1])


PAPER_W, PAPER_D = 6.4, 6.4
# Measured on the art (art camera): the paper's top-left corner on the desk at (-11.88, -3.26), its
# left edge running toward (-11.0, -4.25) and on under the tray's corner post; the tank sketch
# with its left end at (-11.6, -5.4), the turret at (-12.4, -4.85); the pencil tip at
# (-11.24, -4.56) pointing from (-13.79, -3.17).
PAPER_ROT = -0.73
PAPER_CORNER = (-11.88, -3.26)
SKETCH_C = (-12.2, -5.6)       # world x, z of the sketch centre (rows run along world -x = screen right)
SKETCH_W = 1.5
SKETCH_STRETCH = 1.15         # cells taller along z: the art's sketch reads as tall as this on the grazing paper


def paper_centre():
    c, s_ = math.cos(PAPER_ROT), math.sin(PAPER_ROT)
    lx, lz = PAPER_W / 2, PAPER_D / 2
    return (PAPER_CORNER[0] - (lx * c + lz * s_), PAPER_CORNER[1] - (-lx * s_ + lz * c))


def tex_paper():
    """Light warm-grey sketch paper: a faint hand-ruled grid, the traced pixel tank drawn as a
    pencil OUTLINE (edges of the same 27 x 24 grid), smudges and damp darker spots.
    u = 0 at local +x (screen left), v = 1 at local +z (far edge)."""
    from PIL import Image, ImageFilter
    S = 2048
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    base = 0.72 + 0.05 * noise(S, 24, 31) - 0.06 * noise(S, 5, 32)
    img = np.stack([base * 1.0, base * 0.8, base * 0.68], -1)
    # sparse hand-ruled grid (slightly wobbly, faint)
    step = S / 7.0
    for k in range(1, 7):
        for axis in (0, 1):
            pos = k * step + (noise(S, 3, 33 + k + 7 * axis) - 0.5) * 18
            d = np.abs((x if axis == 0 else y) - pos)
            img *= (1 - 0.1 * np.exp(-(d / 1.6) ** 2))[..., None]
    # irregular crease lines (the art's sheet is creased)
    rc = np.random.default_rng(39)
    for k in range(11):
        ang = rc.uniform(0, math.pi)
        off = rc.uniform(-0.5, 0.5) * S
        dist = np.abs((x - S / 2) * math.cos(ang) + (y - S / 2) * math.sin(ang) - off + (noise(S, 4, 60 + k) - 0.5) * 30)
        img *= (1 - 0.3 * np.exp(-(dist / 1.4) ** 2) * (0.5 + noise(S, 6, 80 + k)))[..., None]
    # tank sketch, laid out in WORLD x / z (reads straight on screen whatever the paper's turn)
    pc = paper_centre()
    c, s_ = math.cos(PAPER_ROT), math.sin(PAPER_ROT)
    lx = (0.5 - (x + 0.5) / S) * PAPER_W
    lz = (1 - (y + 0.5) / S - 0.5) * PAPER_D
    wx = pc[0] + lx * c + lz * s_
    wz = pc[1] - lx * s_ + lz * c
    cw = SKETCH_W / ICON_W
    ch = cw * SKETCH_STRETCH
    col = np.floor((SKETCH_C[0] + SKETCH_W / 2 - wx) / cw).astype(int)
    row = np.floor((SKETCH_C[1] + ICON_H * ch / 2 - wz) / ch).astype(int)
    grid = np.array([[1.0 if ch_ == "X" else 0.0 for ch_ in r_] for r_ in TANK_ICON], np.float32)
    ok = (col >= 0) & (col < ICON_W) & (row >= 0) & (row < ICON_H)
    m = np.zeros((S, S), np.float32)
    m[ok] = grid[row[ok], col[ok]]
    mi = Image.fromarray((m * 255).astype(np.uint8))
    edge = np.asarray(mi.filter(ImageFilter.MaxFilter(9)), np.float32) / 255 - np.asarray(mi.filter(ImageFilter.MinFilter(9)), np.float32) / 255
    edge = np.clip(edge, 0, 1)
    grain = 0.75 + 0.25 * noise(S, 300, 35)
    wob = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255
    img *= (1 - 0.72 * np.clip(wob * 1.6, 0, 1) * grain)[..., None]
    # the art's sketch shades the hull / track band (rows 12+) in solid graphite
    fill = np.zeros((S, S), np.float32)
    band = ok & (row >= 12)
    fill[band] = grid[row[band], col[band]]
    fill = np.asarray(Image.fromarray((fill * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    img *= (1 - 0.55 * fill * grain)[..., None]
    # damp spots
    r = np.random.default_rng(37)
    for _ in range(14):
        cx, cy, rad = r.random() * S, r.random() * S, 30 + 120 * r.random()
        d = np.hypot(x - cx, y - cy) / rad
        img *= (1 - 0.12 * np.clip(1 - d, 0, 1) ** 0.5)[..., None]
    return bkit.image("SketchPaper", np.clip(img, 0, 1))


def tex_cedar():
    """Natural cedar pencil wood along u (length), grain streaks round v."""
    W, H = 1024, 128
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    streak = noise(W, 40, 81)[:H, :] * 0.5 + np.sin((y / H) * 2 * math.pi * 9 + noise(W, 6, 82)[:H, :] * 6) * 0.25
    base = 0.62 + 0.12 * streak
    img = np.stack([base * 1.22, base * 0.56, base * 0.17], -1)
    return bkit.image("PencilCedar", np.clip(img, 0, 1))


def drop_height(S, n, rmin, rmax, seed, world=1.0):
    """Height field (S x S) of n round water drops (radius in texture fractions)."""
    r = np.random.default_rng(seed)
    h = np.zeros((S, S), np.float32)
    for _ in range(n):
        cx, cy = r.random() * S, r.random() * S
        rad = (rmin + (rmax - rmin) * r.random() ** 3) * S
        k = int(rad) + 2
        x0, x1, y0, y1 = int(max(cx - k, 0)), int(min(cx + k, S)), int(max(cy - k, 0)), int(min(cy + k, S))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        d = np.hypot(xx - cx, (yy - cy) * (0.8 + 0.4 * r.random())) / rad
        h[y0:y1, x0:x1] = np.maximum(h[y0:y1, x0:x1], np.sqrt(np.clip(1 - d * d, 0, 1)) * rad * 0.6)
    return h


def tex_crate(name="CrateSteel", icon=None, S=1024, seed=41, light=None):
    """Dark charcoal brushed steel (horizontal brushing, faint grime), wet drops in the normal and
    roughness maps; icon = (u, v, width) paints the traced pixel tank (dark) centred at texture
    (u, v), `width` of the texture wide.
    Returns (colour, rough_metal, normal)."""
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.random.default_rng(seed)
    lines = np.convolve(r.standard_normal(S * 3), np.ones(3) / 3, "same")[S:2 * S]
    brush = lines[y.astype(int)] * (0.7 + 0.3 * noise(S, 8, seed + 1))
    grime = noise(S, 6, seed + 2) * 0.6 + noise(S, 40, seed + 3) * 0.4
    base = (0.2 if light is None else light) + 0.012 * brush + 0.05 * (grime - 0.5)
    col = np.stack([base * 1.04, base, base * 0.96], -1)
    rough = 0.42 + 0.06 * np.abs(brush) + 0.08 * (grime - 0.5)
    hd = drop_height(S, 260, 0.002, 0.012, seed + 4)
    wet = np.clip(hd * 400, 0, 1)
    rough = rough * (1 - wet) + 0.05 * wet
    h = brush * 0.00012 + hd / S
    if icon:
        cu, cv, wf = icon
        cell = S * wf / ICON_W
        m = icon_mask(S, cu * S - ICON_W * cell / 2, (1 - cv) * S - ICON_H * cell / 2, cell)
        from PIL import Image, ImageFilter
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
        col = col * (1 - m[..., None]) + np.array([0.012, 0.011, 0.011]) * m[..., None]
        rough = rough * (1 - m) + 0.22 * m * (1 - wet) + 0.05 * m * wet
        h = h + m * 0.0004
    rm = np.stack([np.zeros_like(rough), rough, np.full_like(rough, 0.75)], -1)
    nrm = bkit.height_to_normal(h, strength=S)
    return bkit.image(name, col), bkit.data_image(name + "RM", rm), bkit.data_image(name + "N", nrm)


def tex_leaf(name="Leaf", tint=(0.28, 0.72, 0.2), gain=1.0):
    S = 256
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    base = 0.55 + 0.25 * y
    vein = np.exp(-((x - 0.5) / 0.012) ** 2) * 0.35
    for k in range(5):
        yy = 0.2 + k * 0.14
        vein += np.exp(-((np.abs(x - 0.5) * 0.9 - (y - yy) * 0.8) / 0.01) ** 2) * 0.18 * (y > yy)
    variegate = noise(S, 8, 51) * 0.25
    g = base - vein * 0.0 + vein * 0.35 + variegate
    img = np.stack([g * tint[0] * gain, g * tint[1] * gain, g * tint[2] * gain], -1)
    return bkit.image(name, img)


def materials():
    c, rm, n = tex_beam()
    mat("TrayWood", rough=0.3, image=c, rough_metal=rm, normal=n)
    mat("TrayBase", 0x17191c, rough=0.5)
    c, rm, n = tex_desk()
    mat("DeskWood", rough=0.25, image=c, rough_metal=rm, normal=n)
    mat("BoltSteel", 0x7a818b, rough=0.3, metal=1.0, coat=(0.0, 0.3))     # dark steel domes, one soft highlight
    mat("ScrewSteel", 0x4a5058, rough=0.4, metal=1.0)
    mat("Brass", 0xdcab66, rough=0.16, metal=1.0)
    mat("BrassDark", 0xa87a3c, rough=0.26, metal=1.0)
    srm, sn = tex_shade()
    mat("ShadeEnamel", 0x060708, rough=0.05, metal=0.1, coat=(1.0, 0.02), rough_metal=srm, normal=sn)
    mat("ShadeInside", 0xd89548, rough=0.35, metal=0.4, emit=0.35, emit_hex=0xff8a30)
    mat("LampBulb", 0xffe0b0, rough=0.1, emit=7.0, emit_hex=0xffb860)
    mat("MugEnamel", rough=0.16, image=tex_mug(), coat=(0.5, 0.08))
    mat("MugCeramic", 0xbdb8b2, rough=0.16, coat=(0.5, 0.08))
    mat("Coffee", 0x2a170f, rough=0.04)
    mat("WaterDrop", 0xffffff, rough=0.02, transmission=1.0, ior=1.33)
    c, rm, n = tex_crate()
    mat("CrateSteel", rough=0.4, metal=0.9, image=c, rough_metal=rm, normal=n)
    c, rm, n = tex_crate("CrateFront", icon=crate_icon_uv(), seed=47, light=0.25)
    mat("CrateFront", rough=0.4, metal=0.9, image=c, rough_metal=rm, normal=n)
    c, rm, n = tex_crate("CrateSteelDark", S=1024, seed=59, light=0.15)
    mat("CrateSteelDark", rough=0.4, metal=0.85, image=c, rough_metal=rm, normal=n)
    c, rm, n = tex_crate("CrateEdge", S=512, seed=53, light=0.42)
    mat("CrateEdge", rough=0.22, metal=1.0, image=c, rough_metal=rm, normal=n)
    mat("CrateSlot", 0x050506, rough=0.6, metal=0.3)
    mat("PencilPaint", rough=0.5, image=tex_cedar(), spec=0.25)   # natural varnished cedar body
    mat("PencilWood", 0xd9a878, rough=0.75)                               # freshly shaved cone
    mat("PencilLead", 0x111214, rough=0.28, metal=0.5)                    # black graphite
    mat("SketchPaper", rough=0.82, image=tex_paper())
    mat("Leaf", rough=0.3, image=tex_leaf("Leaf", (0.16, 0.5, 0.14), 0.8))              # darker green (front plant)
    mat("LeafLight", rough=0.25, image=tex_leaf("LeafLight", (0.55, 0.78, 0.2), 1.05), coat=(0.6, 0.1))  # yellow-green pothos
    c, rm, n = tex_beam(dark=0.55)
    mat("PlanterWood", rough=0.45, image=c, rough_metal=rm, normal=n)
    mat("Stem", 0x3c6a24, rough=0.5)
    mat("Pot", 0x1c1e22, rough=0.4)
    mat("Soil", 0x1a120c, rough=0.95)
    mat("MineBlock", 0x2a292c, rough=0.2, metal=0.5, coat=(1.0, 0.03))
    mat("MineMid", 0x5a585b, rough=0.2, metal=0.5, coat=(1.0, 0.03))
    mat("MineLight", 0x9a979a, rough=0.18, metal=0.45, coat=(1.0, 0.03))
    mat("MineCore", 0x0c0d10, rough=0.3, metal=0.8)


# ---------------------------------------------------------------------------------------------
# Tray
# ---------------------------------------------------------------------------------------------
def tray():
    parts, steel = [], []
    zc = (Z0 + Z1) / 2
    L = Z1 - Z0 + 2 * BEAM
    W = 2 * IN_X + 2 * BEAM
    h = TOP - BASE
    cy = (TOP + BASE) / 2
    for sx in (-1, 1):
        x = sx * (IN_X + BEAM / 2)
        parts.append(box(f"BeamL{sx}", (x, cy, zc), (BEAM, h, L - 2 * POST + 2 * BEAM), "TrayWood", bevel=0.08, segs=3, uv=0.18, swap_top=True))
    for sz, z in ((-1, Z0 - BEAM / 2), (1, Z1 + BEAM / 2)):
        parts.append(box(f"BeamS{sz}", (0, cy, z), (W - 2 * POST + 2 * BEAM, h, BEAM), "TrayWood", bevel=0.08, segs=3, uv=0.18))
    # Corner posts with a big polished dome bolt.
    for sx in (-1, 1):
        for sz in (-1, 1):
            x = sx * (IN_X + BEAM - POST / 2)
            z = (Z1 + BEAM - POST / 2) if sz > 0 else (Z0 - BEAM + POST / 2)
            parts.append(box(f"Post{sx}{sz}", (x, (POST_TOP + BASE) / 2, z), (POST, POST_TOP - BASE, POST), "TrayWood", bevel=0.1, segs=3, uv=0.18))
            steel.append(lathe(f"Washer{sx}{sz}", [(0.42, 0.0), (0.42, 0.05), (0.36, 0.07)], "ScrewSteel", sides=24, centre=(x, POST_TOP, z)))
            steel.append(lathe(f"Dome{sx}{sz}", [(0.33, 0.0), (0.33, 0.06), (0.3, 0.16), (0.22, 0.25), (0.12, 0.3), (0.0, 0.32)], "BoltSteel", sides=28, centre=(x, POST_TOP + 0.05, z)))
    # (No screw heads along the beams: the round things on the art's beams are water drops -
    # large clear WaterDrop beads, sparse and irregular.)
    r = np.random.default_rng(17)
    items = []
    for sx in (-1, 1):
        x = sx * (IN_X + BEAM / 2)
        for k in range(16):
            items.append(((x + r.uniform(-0.45, 0.45), TOP + 0.002, r.uniform(Z0, Z1)), (0, 1, 0), 0.07 + 0.09 * r.random() ** 2))
    for sz, z in ((-1, Z0 - BEAM / 2), (1, Z1 + BEAM / 2)):
        for k in range(18):
            items.append(((r.uniform(-IN_X, IN_X), TOP + 0.002, z + r.uniform(-0.45, 0.45)), (0, 1, 0), 0.07 + 0.09 * r.random() ** 2))
    parts.append(bkit.drops("TrayDrops", items, "WaterDrop", flat=0.55))
    base = box("TrayBaseSlab", (0, (BASE + 0.0) / 2 - 0.01, zc), (2 * IN_X + 0.2, -BASE - 0.02, Z1 - Z0 + 0.2), "TrayBase")
    wood = join(parts, "TrayWoodMesh")
    st = join(steel, "TraySteelMesh")
    return group("NightTray", [wood, st, base])


def desk():
    d = box("DeskTopMesh", (0, BASE - 0.6, 4), (90, 1.2, 64), "DeskWood", uv=0.045)
    return group("DeskTop", [d])


# ---------------------------------------------------------------------------------------------
# Desk lamp (base at the origin; the shade hangs over the tray's top-left corner)
# ---------------------------------------------------------------------------------------------
# Measured on the art with the art camera (world, three.js): base centre on the desk, the shade's
# rim (centre, opening direction, radius) from the rim ellipse ends (50,135)-(252,58), the
# knuckle at art (35,165), the arm rising at x ~35 and curving into the shade's collar at (45,78).
LAMP_BASE = (15.015, -0.32, 8.563)
SHADE_RIM = (10.373, 6.813, 5.909)
SHADE_DIR = (-0.297, -0.723, -0.624)    # opening: down to the tray's left half, a sliver toward the camera
SHADE_R = 1.73
SHADE_H = 1.7


def _lamp_points():
    import artcam
    from mathutils import Vector
    B = Vector(LAMP_BASE)
    K = Vector(artcam.unproject(35, 165, 4.5))
    arm = [K] + [Vector(artcam.unproject(x, y, h)) for x, y, h in ((33, 128, 5.4), (34, 100, 6.1), (40, 84, 6.7), (50, 76, 7.15))]
    return B, K, arm


def _orient(o, origin, axis):
    """Turn a part built along +y (three.js) about `origin` so +y points along `axis`."""
    from mathutils import Vector, Matrix
    q = Vector((0, 1, 0)).rotation_difference(Vector(axis).normalized())
    R = q.to_matrix().to_4x4()
    T = Matrix.Translation(bkit.tb(tuple(origin)))
    M = T @ bkit.T2B @ R @ bkit.T2B.inverted()
    for v in o.data.vertices:
        v.co = (M @ v.co.to_4d()).to_3d()
    return o


def tex_shade():
    """Black enamel with rain drops (normal + roughness), lathe_uv layout."""
    S = 1024
    hd = drop_height(S, 420, 0.003, 0.016, 71)
    wet = np.clip(hd * 300, 0, 1)
    rough = 0.05 * (1 - wet) + 0.02 * wet
    rm = np.stack([np.zeros_like(rough), rough, np.full_like(rough, 0.1)], -1)
    return bkit.data_image("ShadeEnamelRM", rm), bkit.data_image("ShadeEnamelN", bkit.height_to_normal(hd / S, strength=S * 1.2))


def lamp():
    """Brass desk lamp of the key art: round domed brass base, a straight polished brass tube
    with stacked collars, a short bend into a brass collar on the shade, the glossy black
    enamel dome with a slim brass rim, a warm-lit inside and a bright bulb under the rim.
    Origin = the base centre on the desk (place at LAMP_BASE, rotY 0, scale 1)."""
    from mathutils import Vector
    B, K, arm = _lamp_points()
    rel = lambda v: tuple(Vector(v) - B)
    p = []
    p.append(lathe("LampBase", [(0.0, 0.0), (1.62, 0.0), (1.66, 0.07), (1.6, 0.2), (1.4, 0.32), (1.0, 0.43), (0.55, 0.5), (0.36, 0.56), (0.3, 0.7), (0.0, 0.7)], "Brass", sides=64))
    p.append(lathe("LampBaseRing", [(1.5, 0.27), (1.53, 0.3), (1.44, 0.34)], "BrassDark", sides=64, caps=(False, False)))
    # One straight brass tube from the base up to the shade's neck (it reads vertical on screen
    # at art x ~15-75, as in the art), stacked collars along it, then a short bend into the
    # brass collar on the shade. No ball knuckle (none in the art).
    s0 = Vector((0, 0.62, 0))
    top = Vector(rel(arm[2]))
    d = (top - s0).normalized()
    p.append(cylinder("LampStem", tuple(s0), tuple(top), 0.23, "Brass", sides=24))
    for t, h in ((0.06, 0.16), (0.1, 0.1), (0.52, 0.2), (0.6, 0.12), (0.66, 0.16), (0.93, 0.14)):
        c = s0 + (top - s0) * t
        col = lathe(f"LampCollar{t}", [(0.23, -h), (0.31, -h * 0.8), (0.34, 0.0), (0.31, h * 0.8), (0.23, h)], "BrassDark" if t in (0.1, 0.6) else "Brass", sides=24, caps=(False, False))
        _orient(col, c, d)
        p.append(col)
    bend = [top - d * 0.05, top + d * 0.25] + [Vector(rel(v)) for v in arm[3:]]
    p.append(tube_path("LampArm", [tuple(v) for v in bend], 0.2, "Brass", ring=16))
    lamp_o = join(p, "LampBody")

    rimc = Vector(rel(SHADE_RIM))
    n = Vector(SHADE_DIR).normalized()          # opening direction
    up = -n                                      # dome axis (rim -> apex)
    R, Hh = SHADE_R, SHADE_H
    prof = [(R, 0.0), (R * 0.985, 0.12), (R * 0.93, 0.38), (R * 0.8, 0.78), (R * 0.6, 1.15), (R * 0.36, 1.46), (R * 0.2, 1.62), (R * 0.12, Hh)]
    shade = lathe_uv("LampShade", prof, "ShadeEnamel", sides=64)
    inner = lathe("LampShadeIn", [(r - 0.035, y + 0.01) for r, y in prof], "ShadeInside", sides=64, caps=(False, False))
    rimr = lathe("LampShadeRim", [(R - 0.05, -0.03), (R + 0.05, -0.04), (R + 0.07, 0.03), (R + 0.03, 0.08), (R - 0.03, 0.05)], "Brass", sides=64, caps=(False, False))
    neck = lathe("LampNeck", [(R * 0.13, Hh - 0.05), (0.3, Hh), (0.3, Hh + 0.18), (0.22, Hh + 0.3), (0.0, Hh + 0.32)], "Brass", sides=24)
    # Socket hanging from the apex; the bulb hangs low, its bottom just below the rim (visible
    # under the rim in the art).
    socket = lathe("LampSocket", [(0.0, Hh - 0.05), (0.2, Hh - 0.05), (0.22, 0.9), (0.28, 0.7), (0.26, 0.42), (0.2, 0.36)], "BrassDark", sides=20)
    bprof = []
    for k in range(17):
        t = k / 16                                  # 0 = bottom tip, 1 = neck
        rr = 0.47 * math.sqrt(max(0.0, 1 - (1 - t / 0.4) ** 2)) if t < 0.4 else 0.2 + 0.27 * math.cos(math.pi / 2 * (t - 0.4) / 0.6)
        bprof.append((rr, -0.42 + 0.79 * t))
    bulb = lathe("LampBulbMesh", bprof, "LampBulb", sides=32)
    # drops on the outside of the dome (upper part)
    r = np.random.default_rng(73)
    items = []
    for i in range(70):
        t = r.uniform(0.25, 0.95)
        a = r.uniform(0, 2 * math.pi)
        k_ = min(int(t * (len(prof) - 1)), len(prof) - 2)
        f = t * (len(prof) - 1) - k_
        rr = prof[k_][0] * (1 - f) + prof[k_ + 1][0] * f
        yy = prof[k_][1] * (1 - f) + prof[k_ + 1][1] * f
        dr = prof[k_ + 1][0] - prof[k_][0]
        dy = prof[k_ + 1][1] - prof[k_][1]
        nn = Vector((dy, -dr)).normalized()     # outward normal in (r, y)
        items.append(((math.cos(a) * rr, yy, math.sin(a) * rr), (math.cos(a) * nn.x, nn.y, math.sin(a) * nn.x), 0.03 + 0.06 * r.random() ** 2.5))
    sdrops = bkit.drops("LampShadeDrops", items, "WaterDrop")
    head = join([shade, inner, rimr, neck, socket, bulb, sdrops], "LampHead")
    _orient(head, rimc, up)
    g = group("DeskLamp", [lamp_o, head])
    empty("LampLight", tuple(rimc + up * 0.05), g)
    empty("LampAim", tuple(rimc + n * 8.0), g)
    return g


# ---------------------------------------------------------------------------------------------
# Mug, crate, pencil, paper, plant, mine
# ---------------------------------------------------------------------------------------------
def mug():
    """Off-white ceramic mug: rounded thick lip (MugRim), the traced tank print facing three.js -z
    (the camera after NIGHT_PROPS rotY ~0.54), handle on the far side (+z, hidden from the art
    camera), coffee near the top, rain drops on the lip and the body."""
    R, H = MUG_R, MUG_H
    body = lathe_uv("MugBody", [(R * 0.93, 0.0), (R * 0.975, 0.04), (R, 0.2), (R, H)], "MugEnamel", sides=96)
    # Rounded lip: from the outer wall over the top into the inner wall.
    lip_prof = [(R, H)]
    for k in range(1, 10):
        a = math.pi * k / 9
        lip_prof.append((R - 0.08 + 0.08 * math.cos(a), H + 0.07 * math.sin(a)))
    lip_prof.append((R - 0.16, H - 0.06))
    rim = lathe("MugRimMesh", lip_prof, "MugCeramic", sides=96, caps=(False, False))
    inside = lathe("MugInside", [(R - 0.16, H - 0.06), (R - 0.16, 0.45), (R - 0.3, 0.32), (0.0, 0.3)], "MugCeramic", sides=96, caps=(False, False))
    bottom = lathe("MugBottom", [(R * 0.93, 0.0), (0.0, 0.03)], "MugCeramic", sides=48)
    coffee = lathe("MugCoffee", [(R - 0.16, H - 0.34), (0.0, H - 0.34)], "Coffee", sides=64, smooth=False)
    # Handle on the far side (+z).
    pts = []
    for k in range(17):
        a = -math.pi / 2 + math.pi * k / 16
        pts.append((0.0, H * 0.5 + math.sin(a) * 1.05, R - 0.05 + math.cos(a) * 0.85))
    handle = tube_path("MugHandle", pts, 0.19, "MugCeramic", ring=12)
    # Drops: on the lip top and the upper body (sparse, irregular).
    r = np.random.default_rng(31)
    items = []
    for i in range(44):
        a = r.uniform(0, 2 * math.pi)
        t = r.uniform(0.15, 0.85)
        rr = R - 0.08 + 0.08 * math.cos(math.pi * t)
        yy = H + 0.07 * math.sin(math.pi * t)
        nrm = (math.cos(a) * math.cos(math.pi * t), math.sin(math.pi * t), math.sin(a) * math.cos(math.pi * t))
        items.append(((math.cos(a) * rr, yy, math.sin(a) * rr), nrm, 0.025 + 0.05 * r.random() ** 2))
    for i in range(34):
        a = r.uniform(0, 2 * math.pi)
        yy = H * (1 - r.random() ** 1.8 * 0.85)
        items.append(((math.cos(a) * R, yy, math.sin(a) * R), (math.cos(a), 0, math.sin(a)), 0.018 + 0.035 * r.random() ** 2.5))
    drops = bkit.drops("MugDrops", items, "WaterDrop")
    return group("Mug", [join([body, bottom, inside, handle, drops], "MugMesh"), join([rim], "MugRim"), join([coffee], "MugCoffee")])


def crate_box(tag, W, H, D, c=(0, 0, 0), icon=False, slot=None, drops_n=30, seed=0, panel="CrateSteel"):
    """One steel crate (bottom centre at c, front = three.js -z): dark brushed panels, heavy
    bevelled edge frames on all 12 edges with rounded corner caps, optional painted icon panel on
    the front, optional recessed slot (x0, x1, y0, y1 on the front, local to the crate centre).
    Returns (panels, frame, extras) mesh lists."""
    cx, cy, cz = c
    f = CR_FRAME     # frame bar section
    pan = [box(f"{tag}Body", (cx, cy + H / 2, cz), (W - 0.08, H - 0.08, D - 0.08), panel, uv=0.25)]
    fr, ex = [], []
    o = 0.03         # frames stand proud of the panels
    for sx in (-1, 1):
        for sz in (-1, 1):
            fr.append(box(f"{tag}FV{sx}{sz}", (cx + sx * (W / 2 - f / 2 + o), cy + H / 2, cz + sz * (D / 2 - f / 2 + o)), (f, H - 2 * f, f), "CrateEdge", bevel=0.09, segs=3, uv=0.5))
    for sy in (0, 1):
        y = cy + (f / 2 - o if sy == 0 else H - f / 2 + o)
        for sz in (-1, 1):
            fr.append(box(f"{tag}FX{sy}{sz}", (cx, y, cz + sz * (D / 2 - f / 2 + o)), (W - 2 * f, f, f), "CrateEdge", bevel=0.09, segs=3, uv=0.5))
        for sx in (-1, 1):
            fr.append(box(f"{tag}FZ{sy}{sx}", (cx + sx * (W / 2 - f / 2 + o), y, cz), (f, f, D - 2 * f), "CrateEdge", bevel=0.09, segs=3, uv=0.5))
        for sx in (-1, 1):
            for sz in (-1, 1):
                q = f + 0.1
                fr.append(box(f"{tag}C{sy}{sx}{sz}", (cx + sx * (W / 2 - q / 2 + o + 0.03), y + (0.03 if sy else -0.03), cz + sz * (D / 2 - q / 2 + o + 0.03)), (q, q, q), "CrateEdge", bevel=0.12, segs=4, uv=0.5))
    if icon:
        # Painted front panel inside the frame (planar UV across the panel).
        w, h = W - 2 * f, H - 2 * f
        pv = [(cx + w / 2, cy + f, cz - D / 2 - 0.006), (cx - w / 2, cy + f, cz - D / 2 - 0.006), (cx - w / 2, cy + f + h, cz - D / 2 - 0.006), (cx + w / 2, cy + f + h, cz - D / 2 - 0.006)]
        pnl = mesh(f"{tag}Panel", pv, [(0, 1, 2, 3)], "CrateFront")
        lay = pnl.data.uv_layers.new(name="UVMap")
        # square texture: map the panel's longer side to the full texture, keep cells square
        sz_ = max(w, h)
        for poly in pnl.data.polygons:
            for li in poly.loop_indices:
                vi = pnl.data.loops[li].vertex_index
                X, Y = [(w, 0), (-w, 0), (-w, h), (w, h)][vi][0] / 2, [(0, 0), (0, 0), (0, h), (0, h)][vi][1]
                lay.data[li].uv = (0.5 - X / sz_, 0.5 + (Y - h / 2) / sz_)
        ex.append(pnl)
    if slot:
        x0, x1, y0, y1 = slot
        zf = cz - D / 2
        ex.append(box(f"{tag}SlotIn", (cx + (x0 + x1) / 2, cy + (y0 + y1) / 2, zf + 0.01), (abs(x1 - x0), y1 - y0, 0.06), "CrateSlot"))
        t = 0.09
        for nm, cc, ss in (("T", ((x0 + x1) / 2, y1 + t / 2), (abs(x1 - x0) + 2 * t, t)), ("B", ((x0 + x1) / 2, y0 - t / 2), (abs(x1 - x0) + 2 * t, t)),
                           ("L", (max(x0, x1) + t / 2, (y0 + y1) / 2), (t, y1 - y0)), ("R", (min(x0, x1) - t / 2, (y0 + y1) / 2), (t, y1 - y0))):
            ex.append(box(f"{tag}Slot{nm}", (cx + cc[0], cy + cc[1], zf - 0.03), (ss[0], ss[1], 0.08), "CrateEdge", bevel=0.025, segs=2))
    # Wet drops on the top and the front.
    r = np.random.default_rng(seed)
    items = []
    for i in range(drops_n * 2):
        items.append(((cx + r.uniform(-W / 2 + 0.1, W / 2 - 0.1), cy + H + o + 0.0, cz + r.uniform(-D / 2 + 0.1, D / 2 - 0.1)), (0, 1, 0), 0.03 + 0.06 * r.random() ** 2.5))
    for i in range(drops_n // 2):
        items.append(((cx + r.uniform(-W / 2 + f, W / 2 - f), cy + r.uniform(f, H - f), cz - D / 2 - 0.008), (0, 0, -1), 0.025 + 0.045 * r.random() ** 3))
    ex.append(bkit.drops(f"{tag}Drops", items, "WaterDrop"))
    return pan, fr, ex


# Crate stack of the key art (top right, behind the colour wheel), measured with the art camera:
# lower crate 3.28 wide x 4.28 tall x 3.8 deep (painted tank centred at local (-0.3, 2.47) on the
# front, 1.8 wide); upper crate 3.0 x 1.8 x 3.0 on top, 0.93 toward screen right, front set back
# 0.25, a recessed slot on the right part of its front.
CR_LOW = (3.28, 4.28, 3.8)
CR_UP = (3.0, 1.8, 3.0)
CR_UP_OFF = (-0.93, -0.15)
CR_FRAME = 0.36
CR_ICON = (0.0, 2.45, 1.75)      # painted tank: centre (local x, y) on the lower front, width


def crate_icon_uv():
    """Texture placement of the painted tank on the lower crate's front panel (see crate_box)."""
    W, H, _ = CR_LOW
    w, h = W - 2 * CR_FRAME, H - 2 * CR_FRAME
    sz = max(w, h)
    x, y, wd = CR_ICON
    return (0.5 - x / sz, 0.5 + ((y - CR_FRAME) - h / 2) / sz, wd / sz)


def crate():
    """Single crate (the old "Crate" node, now in the CrateStack look) + the CrateStack."""
    W, H, D = CR_LOW
    pan, fr, ex = crate_box("Crate", W, H, D, icon=True, seed=61)
    single = group("Crate", [join(pan, "CrateMesh"), join(fr, "CrateTrim"), join(ex, "CrateIconMesh")])
    pan, fr, ex = crate_box("Low", W, H, D, icon=True, seed=62)
    W2, H2, D2 = CR_UP
    dx, dz = CR_UP_OFF
    pan2, fr2, ex2 = crate_box("Up", W2, H2, D2, c=(dx, H, dz), slot=(0.4, -1.25, 0.42, 1.38), seed=63, panel="CrateSteelDark")
    low = group("CrateLower", [join(pan, "CrateLowerMesh"), join(fr, "CrateLowerTrim"), join(ex, "CrateLowerFront")])
    up = group("CrateUpper", [join(pan2, "CrateUpperMesh"), join(fr2, "CrateUpperTrim"), join(ex2, "CrateUpperFront")])
    return single, group("CrateStack", [low, up])


PENCIL_TIP = (-11.24, -4.56)
PENCIL_ROT = 0.5         # rotY: local +x (toward the tip) -> world (0.878, 0, -0.479)
PENCIL_L = 7.6           # body length (the far end is off frame)


def pencil():
    """Natural cedar pencil (hexagonal, varnished, grain), a short lighter shaved-wood cone with a
    scalloped edge, then the long black graphite point. Lies along local +x (tip at +x), its axis
    at y = r above the origin; origin at the back end."""
    from mathutils import Vector
    L, r = PENCIL_L, 0.26
    n = 6
    verts, faces, uvs = [], [], []
    for k, x in enumerate((0.0, L)):
        for i in range(n + 1):
            a = 2 * math.pi * i / n
            verts.append((x, r + math.sin(a) * r, math.cos(a) * r))
            uvs.append((k, i / n))
    for i in range(n):
        faces.append((i, i + 1, n + 2 + i, n + 1 + i))
    body = mesh("PencilBody", verts, faces, "PencilPaint")
    bkit.vertex_uvs(body, uvs)
    cap = mesh("PencilEnd", [(0.0, r + math.sin(2 * math.pi * i / n) * r, math.cos(2 * math.pi * i / n) * r) for i in range(n)], [tuple(range(n - 1, -1, -1))], "PencilWood")
    # Shaved cone: scalloped base (longer on the hex edges), lighter wood, to radius 0.16.
    m_ = 48
    cv, cf = [], []
    cone_l, lead_l, rl = 0.1, 0.95, 0.24
    for i in range(m_):
        a = 2 * math.pi * i / m_
        # hex radius at this angle
        sec = (a % (2 * math.pi / n)) - math.pi / n
        rh = r * math.cos(math.pi / n) / math.cos(sec)
        scallop = 0.1 * (abs(sec) / (math.pi / n)) ** 2        # edges reach further toward the tip
        cv.append((L + scallop, r + math.sin(a) * rh, math.cos(a) * rh))
    for i in range(m_):
        a = 2 * math.pi * i / m_
        cv.append((L + cone_l, r + math.sin(a) * rl, math.cos(a) * rl))
    for i in range(m_):
        j = (i + 1) % m_
        cf.append((i, j, m_ + j, m_ + i))
    cone = mesh("PencilWoodTip", cv, cf, "PencilWood", smooth=True)
    # flat wedge faces between the hex end and the scallop
    lead = cylinder("PencilLeadTip", (L + cone_l, r, 0), (L + cone_l + lead_l, r, 0), rl, "PencilLead", sides=24, r2=0.03)
    o = join([body, cap, cone, lead], "PencilMesh")
    return group("Pencil", [o])


def pencil_place():
    tip_x = PENCIL_L + 0.1 + 0.95
    d = (math.cos(PENCIL_ROT), -math.sin(PENCIL_ROT))
    return (PENCIL_TIP[0] - d[0] * tip_x, -0.32 + 0.004, PENCIL_TIP[1] - d[1] * tip_x)


def paper():
    """Sketch sheet, 6.4 x 6.4, lying on the desk; its screen-left edge (+x) curls up, slight
    waviness; u = 0 at +x, v = 1 at +z."""
    verts, faces, uvs = [], [], []
    N = 32
    w, d = PAPER_W, PAPER_D
    for j in range(N + 1):
        for i in range(N + 1):
            u, v = i / N, j / N
            x = (0.5 - u) * w
            z = (v - 0.5) * d
            curl = max(0.0, 0.12 - u) / 0.12
            y = 0.05 + 0.28 * curl ** 2 + 0.02 * math.sin(v * 5.3 + u * 2.1) * (0.5 + u)
            x += 0.08 * curl ** 2
            verts.append((x, y, z))
            uvs.append((u, v))
    for j in range(N):
        for i in range(N):
            a = j * (N + 1) + i
            faces.append((a, a + 1, a + N + 2, a + N + 1))
    o = mesh("SketchPaperMesh", verts, faces, "SketchPaper", smooth=True)
    bkit.vertex_uvs(o, uvs)
    m = o.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = 0.01
    return group("SketchPaper", [o])


def leaf(name, base, direction, length, width, tilt, material="Leaf"):
    """Heart-shaped pothos leaf from `base` along `direction` (three.js), cupped along the midrib."""
    from mathutils import Vector
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 1, 0)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    normal = side.cross(d).normalized()
    if normal.y < 0:
        normal = -normal
    normal = (normal * math.cos(tilt) + side * math.sin(tilt)).normalized()
    side = d.cross(normal).normalized()
    verts, uvs, faces = [], [], []
    rows, cols = 10, 6
    for j in range(rows + 1):
        t = j / rows
        # Heart outline: wide near the base, pointed tip.
        half = width * (math.sin(math.pi * min(1, t * 1.15)) ** 0.8) * (1 - t ** 3) * 0.55 + (0.12 * width if t < 0.12 else 0)
        for i in range(cols + 1):
            s = i / cols * 2 - 1
            cup = (s * s) * width * 0.18
            droop = -t * t * length * 0.18
            p = Vector(base) + d * (t * length) + side * (s * half) + normal * (cup + droop * 0.6)
            p.y += droop
            verts.append(tuple(p))
            uvs.append(((s + 1) / 2, t))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    o = mesh(name, verts, faces, material, smooth=True)
    bkit.vertex_uvs(o, uvs)
    m = o.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = 0.03
    return o


def plant(name="Plant", planter=False, leaf_mat="Leaf", seed=9):
    """Pothos: heart-shaped leaves on arching stems; in a dark pot (Plant, the out-of-focus front
    plant: darker green) or in a brown slatted wooden planter (PlantBox, the plant behind the
    crates at the top right of the art: yellow-green leaves)."""
    from mathutils import Vector
    pr = random.Random(seed)
    if planter:
        W, H, D = 3.6, 3.2, 3.0
        parts = []
        n = 8
        for i in range(n):
            x = -W / 2 + (i + 0.5) * W / n
            for sz in (-1, 1):
                parts.append(box(f"SlatF{i}{sz}", (x, H / 2, sz * (D / 2 - 0.06)), (W / n - 0.06, H, 0.12), "PlanterWood", bevel=0.02, segs=1, uv=0.3, swap_top=True))
        for sx in (-1, 1):
            for j in range(6):
                z = -D / 2 + (j + 0.5) * D / 6
                parts.append(box(f"SlatS{j}{sx}", (sx * (W / 2 - 0.06), H / 2, z), (0.12, H, D / 6 - 0.06), "PlanterWood", bevel=0.02, segs=1, uv=0.3))
        parts.append(box("PlanterRim", (0, H - 0.08, 0), (W + 0.12, 0.16, D + 0.12), "PlanterWood", bevel=0.03, segs=1, uv=0.3))
        parts.append(box("PlanterSoil", (0, H - 0.25, 0), (W - 0.2, 0.1, D - 0.2), "Soil"))
        y0 = H - 0.2
    else:
        parts = [lathe("PlantPot", [(0.0, 0.0), (1.4, 0.0), (1.8, 2.4), (1.9, 2.5), (1.75, 2.55)], "Pot", sides=40),
                 lathe("PlantSoil", [(1.72, 2.3), (0.0, 2.38)], "Soil", sides=32)]
        y0 = 2.4
    leaves = []
    for k in range(9 if not planter else 11):
        a = 2 * math.pi * k / 9 + pr.random() * 0.5
        # PlantBox: short, leafy runners (no bare stems showing), leaves all along them
        reach = (2.0 + pr.random() * 2.2) if planter else (2.5 + pr.random() * 3.5)
        lift = (1.2 + pr.random() * 1.6) if planter else (3.0 + pr.random() * 3.5)
        pts = []
        for i in range(9):
            t = i / 8
            pts.append((math.cos(a) * reach * t, y0 + lift * math.sin(t * math.pi * 0.8), math.sin(a) * reach * t))
        parts.append(tube_path(f"Stem{k}", pts, 0.045 if planter else 0.07, "Stem", ring=6))
        for i in ((1, 2, 3, 4, 5, 6, 7, 8) if planter else (3, 5, 7, 8)):
            p = Vector(pts[i])
            dirv = Vector((math.cos(a + pr.uniform(-0.8, 0.8)), pr.uniform(-0.3, 0.4), math.sin(a + pr.uniform(-0.8, 0.8))))
            ls = 0.62 if planter else 1.0
            leaves.append(leaf(f"Leaf{k}_{i}", tuple(p), tuple(dirv), ls * (1.6 + pr.random() * 1.1), ls * (1.3 + pr.random() * 0.7), pr.uniform(-0.5, 0.5), leaf_mat))
    pre = "PlantBox" if planter else "Plant"
    return group(name, [join(parts, pre + "PotMesh"), join(leaves, pre + "Leaves")])


def mine():
    """The key art's mine: a glossy gunmetal sphere made of pixel patches. A cube-sphere split
    into square cells (9 x 9 per cube face), each cell dark / mid / light-lavender grey (clustered,
    so patches of several cells form, as in the art); the lighter the patch the higher it stands
    (steps of ~1-2 % of R with rolled edges only where the colour changes). No spikes (none in the
    art). SpikeMine origin at the bottom (sits on y = 0); child empty MineBall at the centre
    (y = R) holds the meshes, so the ball can be spun about its own centre."""
    from mathutils import Vector
    R = 0.62           # art: ~71 px across at the right mine's spot (engine scale 0.95)
    N, SUB = 9, 4
    rr = np.random.default_rng(91)
    waves = [(Vector(rr.normal(size=3)).normalized(), rr.uniform(1.5, 3.5), rr.uniform(0, 6.3)) for _ in range(5)]
    cell_rand = {}
    faces_dirs = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 1, 0), (0, 0, -1)), ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
                  ((0, -1, 0), (0, 0, -1), (1, 0, 0)), ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0))]

    def cell_of(d):
        ax = max(range(3), key=lambda k: abs(d[k]))
        for fi, (fn, fu, fv) in enumerate(faces_dirs):
            if fn[ax] != 0 and (fn[ax] > 0) == (d[ax] > 0):
                p = d / abs(d[ax])
                u = p.dot(Vector(fu))
                v = p.dot(Vector(fv))
                return fi, min(int((u + 1) / 2 * N), N - 1), min(int((v + 1) / 2 * N), N - 1)

    def cls_of(cell):
        if cell not in cell_rand:
            fi, i, j = cell
            fn, fu, fv = faces_dirs[fi]
            c = (Vector(fn) + Vector(fu) * (-1 + (2 * i + 1) / N) + Vector(fv) * (-1 + (2 * j + 1) / N)).normalized()
            val = sum(math.sin(c.dot(w) * f * 3 + ph) for w, f, ph in waves) / 5 + rr.uniform(-0.45, 0.45)
            cell_rand[cell] = 0 if val < -0.1 else (1 if val < 0.2 else 2)
        return cell_rand[cell]

    HGT = (0.0, 0.022, 0.04)
    eps = 1.0 / (N * SUB) * 0.9
    verts, faces, fmat = [], [], []
    for fi, (fn, fu, fv) in enumerate(faces_dirs):
        n_, u_, v_ = Vector(fn), Vector(fu), Vector(fv)
        G = N * SUB
        base = len(verts)
        for k in range(G + 1):
            for l in range(G + 1):
                u, v = -1 + 2 * k / G, -1 + 2 * l / G
                d = (n_ + u_ * u + v_ * v).normalized()
                # height: mean over a small neighbourhood (rolled edges at colour changes only)
                hs = []
                for du, dv in ((0, 0), (eps, 0), (-eps, 0), (0, eps), (0, -eps)):
                    dd = (n_ + u_ * max(-1, min(1, u + du)) + v_ * max(-1, min(1, v + dv))).normalized()
                    hs.append(HGT[cls_of(cell_of(dd))])
                verts.append(tuple(d * R * (1 + sum(hs) / len(hs))))
        for k in range(G):
            for l in range(G):
                q = base + k * (G + 1) + l
                faces.append((q, q + G + 1, q + G + 2, q + 1))
                uc, vc = -1 + 2 * (k + 0.5) / G, -1 + 2 * (l + 0.5) / G
                fmat.append(cls_of(cell_of((n_ + u_ * uc + v_ * vc).normalized())))
    me = bpy.data.meshes.new("MineMesh")
    me.from_pydata([bkit.tb(v) for v in verts], [], faces)
    o = bpy.data.objects.new("MineMesh", me)
    bpy.context.scene.collection.objects.link(o)
    for m_ in ("MineBlock", "MineMid", "MineLight"):
        o.data.materials.append(bkit.MATS[m_])
    for poly, mi in zip(o.data.polygons, fmat):
        poly.material_index = mi
        poly.use_smooth = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    root = group("SpikeMine", [])
    centre = empty("MineBall", (0, R, 0), root)
    o.parent = centre
    return root


def build():
    materials()
    return [tray(), desk(), lamp(), mug(), *crate(), pencil(), paper(), plant(), plant("PlantBox", planter=True, leaf_mat="LeafLight", seed=13), mine()]


# Recommended placements (three.js; fit to the art with the art camera, see designer_log.md):
# pos, rotY, tilt (about the piece's local x after rotY; + leans its top away from the camera),
# uniform scale. Same composition as ColorWheel.place: T * Ry * S * Rx.
PLACE = {
    # Leaned back ~33 deg so the rim reads as flat as in the art (the art's mug is drawn from a lower
    # eye point than the solved camera); logo faces the camera, axis vertical on screen.
    "Mug": dict(pos=(13.537, 0.674, 1.901), quat=(0.225, 0.2551, 0.1853, 0.9219), scale=0.99),
    # Rolled 0.25 rad toward screen right so its vertical edges stand upright on screen as in the art
    # (resting on its left bottom edge; the lifted right side is behind the wheel / off frame).
    "DeskLamp": dict(pos=LAMP_BASE, rot_y=0.0, scale=1.0),
    "SketchPaper": dict(pos=(paper_centre()[0], -0.32, paper_centre()[1]), rot_y=PAPER_ROT, scale=1.0),
    "Pencil": dict(pos=pencil_place(), rot_y=PENCIL_ROT, scale=1.0),
    "SpikeMine": dict(pos=(-6.9, 0.0, -3.5), rot_y=0.0, scale=0.95),
    "PlantBox": dict(pos=(-13.55, -0.32, 8.04), rot_y=0.5, scale=0.5),
    "CrateStack": dict(pos=(-14.835, 0.087, 2.092), quat=(0.0633, -0.5021, -0.1079, 0.8557), scale=1.0),
}
# Art crops per preview (x0, y0, x1, y1) and the context pieces.
PREVIEW = {
    "Mug": ((0, 300, 220, 600), "design_mug.png"),
    "CrateStack": ((1400, 60, 1672, 470), "design_crates.png"),
    "DeskLamp": ((0, 0, 280, 340), "design_lamp.png"),
    "SketchPaper": ((1480, 640, 1672, 941), "design_pencil_paper.png"),
    "SpikeMine": ((1225, 635, 1325, 735), "design_mine.png"),
    "PlantBox": ((1380, 0, 1672, 330), "design_plant_tr.png"),
    "NightTray": ((0, 380, 700, 941), "design_wood.png"),
}


def render(out_dir, roots, pieces):
    import artcam
    os.makedirs(out_dir, exist_ok=True)
    by = {r.name: r for r in roots}
    keep = {"DeskTop", "NightTray"} | set(pieces)
    for r in roots:
        if r.name not in keep:
            for c in [r] + list(r.children_recursive):
                c.hide_render = True
    for n in pieces:
        if n in PLACE:
            artcam.place(by[n], **PLACE[n])
    artcam.world()
    artcam.lights()
    if "CrateStack" in pieces:
        # warm glow of the key art's explosion next to the crates (tray top right)
        L = bpy.data.lights.new("Expl", "POINT")
        L.energy, L.color, L.shadow_soft_size = 2500, bkit.srgb(0xff9a40)[:3], 1.5
        lo = bpy.data.objects.new("Expl", L)
        lo.location = bkit.tb((-7.0, 3.0, 4.5))
        bpy.context.scene.collection.objects.link(lo)
    ref = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "night", "ref")
    for n in pieces:
        if n not in PREVIEW:
            continue
        box_, name = PREVIEW[n]
        p = artcam.render(os.path.join(out_dir, name), box=box_, samples=32)
        artcam.side_by_side(box_, p, os.path.join(ref, name), height=600)


def main():
    bkit.reset()
    roots = build()
    bkit.export(roots, OUT, image_format="JPEG")
    if RENDER_DIR:
        pieces = argv[argv.index("--piece") + 1].split(",") if "--piece" in argv else list(PREVIEW)
        render(RENDER_DIR, roots, pieces)
    print("night desk done")


main()
