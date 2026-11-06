"""
Desk diorama kit for scenario 03 NEON RAIN (Blender 4.2+/5.x), modelled piece by piece against
the key art (assets/textures/menu/night.jpg): a wooden toy tray on a wet desk by a rainy window
at midnight, lit by a brass desk lamp.

    python tools/blender/build_night_desk.py [--render out_dir]

Output: assets/models/night_desk.glb (+ .blend), three.js axes (y up, the art camera looks
toward +z; screen right is -x). Top-level nodes (placed by src/night/NightLayout.js):

  NightTray     the tray: four varnished beams with chunky corner posts, a polished dome bolt on
                each corner post, screw heads along the beams, the dark base slab under the field
                (field inside x -9..9, z -6..9 = GameConfig.night; deck surface y = 0)
  DeskTop       the dark walnut desk top (planks along x), its top at y = -0.32
  DeskLamp      brass base and stem, elbow knuckle, arm, black enamel dome shade with a brass rim
                and a warm bulb (LampBulb: emissive); empty LampLight = bulb, LampAim = where the
                shade points (the base sits at the origin)
  Mug           white enamel mug with a grey rim, coffee inside and the pixel tank logo
  Crate         riveted dark steel ammo crate with the embossed pixel tank (front faces -z)
  Pencil        hexagonal yellow pencil, sharpened (lies along +x)
  SketchPaper   a sheet with the pencil sketch of the pixel tank and grid lines
  Plant         pothos in a dark pot: heart-shaped leaves on arching stems
  SpikeMine     the voxel spike ball of the key art (gunmetal blocks, steel studs)
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

# The Blocked pixel tank (mug, crate, paper): turret with the barrel up to the right, hull, tracks.
TANK_ICON = [
    "..........XX....",
    ".........XX.....",
    "........XX......",
    "....XXXXXX......",
    "...XXXXXXXX.....",
    "...XX.XXXXX.....",
    ".XXXXXXXXXXXXX..",
    "XXXXXXXXXXXXXXXX",
    "XX..XX..XX..XXXX",
    ".XXXXXXXXXXXXXX.",
]

rng = np.random.default_rng(3)
prng = random.Random(9)


def noise(S, cells, seed):
    from PIL import Image
    r = np.random.default_rng(seed).random((cells, cells)).astype(np.float32)
    return np.asarray(Image.fromarray((r * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255


def icon_mask(S, x0, y0, px, fg=1.0):
    """Mask (S x S) with the pixel tank drawn from (x0, y0) at px pixels per icon pixel."""
    m = np.zeros((S, S), np.float32)
    for r, row in enumerate(TANK_ICON):
        for c, ch in enumerate(row):
            if ch == "X":
                m[int(y0 + r * px):int(y0 + (r + 1) * px), int(x0 + c * px):int(x0 + (c + 1) * px)] = fg
    return m


# ---------------------------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------------------------
def tex_beam():
    """Warm varnished oak along u: long grain lines, darker streaks, a few knots."""
    S = 1024
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    warp = noise(S, 12, 1) * 3 + noise(S, 48, 2) * 0.8
    grain = np.sin((y / S * 90 + warp) * math.pi) * 0.5 + 0.5
    grain2 = np.sin((y / S * 260 + warp * 2.3) * math.pi) * 0.5 + 0.5
    base = 0.5 + grain * 0.22 + grain2 * 0.08 + (noise(S, 200, 3) - 0.5) * 0.08
    for k in range(4):
        cx, cy = rng.random() * S, rng.random() * S
        d = np.sqrt(((x - cx) / 3.0) ** 2 + (y - cy) ** 2)
        base -= 0.25 * np.exp(-(d / 14) ** 2)
    base *= 0.8 + 0.2 * noise(S, 6, 4)
    img = np.stack([base * 0.66, base * 0.4, base * 0.21], -1)
    return bkit.image("TrayWood", img)


def tex_desk():
    """Dark walnut planks along u with seams every quarter."""
    S = 1024
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    warp = noise(S, 10, 11) * 10
    grain = np.sin((y / S * 70 + warp + noise(S, 64, 12) * 2) * math.pi) * 0.5 + 0.5
    base = 0.3 + grain * 0.14 + (noise(S, 160, 13) - 0.5) * 0.06
    plank = (y // (S / 4)).astype(int)
    shade = np.array([0.95, 1.08, 0.88, 1.02])[plank]
    base *= shade
    seam = (y % (S / 4)) < 4
    base[seam] = 0.05
    img = np.stack([base * 0.78, base * 0.48, base * 0.29], -1)
    return bkit.image("DeskWood", img)


def tex_mug():
    """White enamel round the mug (u = 0.5 faces the camera) with the black pixel tank."""
    W, H = 1024, 512
    img = np.ones((H, W, 3), np.float32) * np.array([0.9, 0.9, 0.88])
    img *= (0.96 + 0.04 * noise(W, 64, 21)[:H, :W])[..., None]
    m = np.zeros((H, W), np.float32)
    px = 18
    m_icon = icon_mask(W, 0, 0, px)
    iw, ih = 16 * px, 10 * px
    x0, y0 = W // 2 - iw // 2, int(H * 0.3)
    m[y0:y0 + ih, x0:x0 + iw] = m_icon[:ih, :iw]
    img[m > 0.5] = (0.05, 0.05, 0.06)
    # Flipped both ways: the image's first row lands at v = 0 (the mug's foot) and u runs toward
    # three.js +x (screen left).
    return bkit.image("MugEnamel", img[::-1, ::-1])


def tex_paper():
    S = 1024
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    base = 0.72 + 0.08 * noise(S, 24, 31) - 0.05 * noise(S, 4, 32)
    img = np.stack([base, base * 0.9, base * 0.76], -1) * 0.8
    # Faint construction lines.
    for k in range(14):
        a = rng.random() * math.pi
        c = rng.random() * S
        d = np.abs((x - S / 2) * math.cos(a) + (y - S / 2) * math.sin(a) - (c - S / 2))
        img[d < 1.2] *= 0.75
    # The pixel tank outline sketch (pencil strokes round each filled pixel).
    px = 44
    m = icon_mask(S, S * 0.18, S * 0.3, px)
    from PIL import Image, ImageFilter
    mi = Image.fromarray((m * 255).astype(np.uint8))
    edge = np.asarray(mi.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5)), np.float32) / 255
    inner = np.asarray(mi.filter(ImageFilter.MinFilter(17)), np.float32) / 255
    img *= (1 - 0.8 * edge)[..., None]
    img *= (1 - 0.35 * inner)[..., None]
    return bkit.image("SketchPaper", img)


def tex_crate():
    """Dark weathered steel with a little rust and grime."""
    S = 512
    n = noise(S, 32, 41) * 0.6 + noise(S, 128, 42) * 0.4
    rust = np.clip((noise(S, 16, 43) - 0.62) * 3, 0, 1)
    base = 0.3 + 0.12 * n
    img = np.stack([base, base * 0.97, base * 0.95], -1)
    img = img * (1 - rust[..., None] * 0.5) + rust[..., None] * np.array([0.35, 0.18, 0.08]) * 0.5
    return bkit.image("CrateSteel", img)


def tex_leaf():
    S = 256
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    base = 0.55 + 0.25 * y
    vein = np.exp(-((x - 0.5) / 0.012) ** 2) * 0.35
    for k in range(5):
        yy = 0.2 + k * 0.14
        vein += np.exp(-((np.abs(x - 0.5) * 0.9 - (y - yy) * 0.8) / 0.01) ** 2) * 0.18 * (y > yy)
    variegate = noise(S, 8, 51) * 0.25
    g = base - vein * 0.0 + vein * 0.35 + variegate
    img = np.stack([g * 0.28, g * 0.72, g * 0.2], -1)
    return bkit.image("Leaf", img)


def materials():
    mat("TrayWood", rough=0.25, image=tex_beam())
    mat("TrayBase", 0x17191c, rough=0.5)
    mat("DeskWood", rough=0.3, image=tex_desk())
    mat("BoltSteel", 0xc9ced6, rough=0.12, metal=1.0)
    mat("ScrewSteel", 0x8d939b, rough=0.25, metal=1.0)
    mat("Brass", 0xc3923f, rough=0.22, metal=1.0)
    mat("BrassDark", 0x8a6328, rough=0.35, metal=1.0)
    mat("ShadeEnamel", 0x0d0f12, rough=0.12, metal=0.3)
    mat("ShadeInside", 0xf0e6d0, rough=0.5, emit=1.5, emit_hex=0xffd59a)
    mat("LampBulb", 0xfff1d0, rough=0.1, emit=12.0, emit_hex=0xffc06a)
    mat("MugEnamel", rough=0.18, image=tex_mug())
    mat("MugRim", 0x7f848a, rough=0.25, metal=0.6)
    mat("Coffee", 0x1b0f08, rough=0.05)
    mat("CrateSteel", rough=0.45, metal=0.35, image=tex_crate())
    mat("CrateEdge", 0x2c2f33, rough=0.35, metal=0.85)
    mat("CrateRivet", 0x9aa0a8, rough=0.2, metal=1.0)
    mat("CrateIcon", 0x0a0b0c, rough=0.6)
    mat("PencilPaint", 0xe39a2a, rough=0.35)
    mat("PencilWood", 0xd9b07a, rough=0.7)
    mat("PencilLead", 0x1a1b1e, rough=0.3, metal=0.4)
    mat("SketchPaper", rough=0.85, image=tex_paper())
    mat("Leaf", rough=0.3, image=tex_leaf())
    mat("Stem", 0x3c6a24, rough=0.5)
    mat("Pot", 0x1c1e22, rough=0.4)
    mat("Soil", 0x1a120c, rough=0.95)
    mat("MineBlock", 0x3a3e45, rough=0.3, metal=0.75)
    mat("MineLight", 0xb4bcc6, rough=0.2, metal=0.85)
    mat("MineStud", 0xb7bec7, rough=0.15, metal=1.0)


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
    # Screw heads along the beam tops.
    for sx in (-1, 1):
        x = sx * (IN_X + BEAM / 2)
        for z in np.linspace(Z0 + 1.2, Z1 - 1.2, 6):
            steel.append(lathe(f"Screw{sx}{z:.1f}", [(0.12, 0.0), (0.12, 0.02), (0.08, 0.05), (0.0, 0.055)], "ScrewSteel", sides=10, centre=(x, TOP, z)))
    for sz, z in ((-1, Z0 - BEAM / 2), (1, Z1 + BEAM / 2)):
        for x in np.linspace(-IN_X + 1.4, IN_X - 1.4, 7):
            steel.append(lathe(f"ScrewS{sz}{x:.1f}", [(0.12, 0.0), (0.12, 0.02), (0.08, 0.05), (0.0, 0.055)], "ScrewSteel", sides=10, centre=(x, TOP, z)))
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
SHADE_C = (-4.9, 7.7, -0.5)   # shade centre, relative to the base
AIM = (-11.9, 1.7, -4.5)      # where the opening faces (down to the tray, a crescent toward the camera, as in the art)


def lamp():
    from mathutils import Vector
    p = []
    p.append(lathe("LampBase", [(0.0, 0.0), (2.4, 0.0), (2.45, 0.12), (2.2, 0.34), (1.2, 0.45), (0.45, 0.55), (0.3, 0.7), (0.0, 0.7)], "Brass", sides=48))
    p.append(lathe("LampBaseRing", [(2.22, 0.3), (2.26, 0.34), (2.1, 0.4)], "BrassDark", sides=48))
    knuckle = Vector((0.0, 4.6, 0.0))
    p.append(cylinder("LampStem", (0, 0.6, 0), tuple(knuckle), 0.2, "Brass", sides=20))
    for yy in (1.4, 3.0):
        p.append(lathe(f"LampCollar{yy}", [(0.27, 0.0), (0.3, 0.08), (0.27, 0.16)], "BrassDark", sides=20, centre=(0, yy, 0)))
    p.append(cylinder("LampKnuckle", (-0.35, 4.6, 0), (0.35, 4.6, 0), 0.34, "BrassDark", sides=20))
    p.append(cylinder("LampKnob", (0.35, 4.6, 0), (0.6, 4.6, 0), 0.2, "Brass", sides=16))
    shade_c = Vector(SHADE_C)
    aim = Vector(AIM)
    axis = (aim - shade_c).normalized()
    # Arm from the knuckle to the back of the shade.
    back = shade_c - axis * 1.3
    p.append(cylinder("LampArm", tuple(knuckle), tuple(back), 0.15, "Brass", sides=16))
    p.append(lathe("LampArmCap", [(0.0, 0.0), (0.26, 0.0), (0.26, 0.3), (0.0, 0.3)], "BrassDark", sides=16, centre=tuple(back - Vector((0, 0.15, 0)))))
    lamp_o = join(p, "LampBody")
    # Shade: dome built along +y then turned to face `axis`.
    shade = lathe("LampShade", [(0.25, 1.3), (0.6, 1.25), (1.3, 1.0), (1.85, 0.55), (2.15, 0.05), (2.2, -0.05)], "ShadeEnamel", sides=48, caps=(False, False))
    inner = lathe("LampShadeIn", [(2.12, -0.04), (2.08, 0.05), (1.78, 0.52), (1.25, 0.95), (0.55, 1.18), (0.2, 1.22)], "ShadeInside", sides=48, caps=(False, False))
    rim = lathe("LampShadeRim", [(2.16, -0.1), (2.28, -0.08), (2.28, 0.04), (2.18, 0.06)], "Brass", sides=48, caps=(False, False))
    bulb = lathe("LampBulbMesh", [(0.0, 0.3), (0.45, 0.4), (0.62, 0.65), (0.55, 0.95), (0.3, 1.1), (0.0, 1.12)], "LampBulb", sides=24)
    sh = join([shade, inner, rim, bulb], "LampHead")
    # Orient: local +y (the dome's top) points away from the aim (-axis); bottom opening toward aim.
    from mathutils import Matrix
    up = -axis
    q = Vector((0, 1, 0)).rotation_difference(up)
    R = q.to_matrix().to_4x4()
    T = Matrix.Translation(bkit.tb(tuple(shade_c)))
    # mesh data is in Blender coords: convert the three.js rotation into Blender space.
    B = bkit.T2B
    M = T @ B @ R @ B.inverted()
    for v in sh.data.vertices:
        v.co = (M @ v.co.to_4d()).to_3d()
    g = group("DeskLamp", [lamp_o, sh])
    empty("LampLight", tuple(shade_c - axis * 0.7), g)
    empty("LampAim", tuple(aim), g)
    return g


# ---------------------------------------------------------------------------------------------
# Mug, crate, pencil, paper, plant, mine
# ---------------------------------------------------------------------------------------------
def mug():
    R, H = 1.45, 3.2
    body = lathe_uv("MugBody", [(R * 0.94, 0.0), (R * 0.98, 0.05), (R, 0.25), (R, H - 0.05)], "MugEnamel", sides=64)
    rim = lathe("MugRimMesh", [(R, H - 0.06), (R + 0.03, H), (R - 0.14, H + 0.02), (R - 0.17, H - 0.1)], "MugRim", sides=64, caps=(False, False))
    inside = lathe("MugInside", [(R - 0.17, H - 0.1), (R - 0.17, 0.5), (0.0, 0.42)], "MugEnamel", sides=64, caps=(False, False))
    bottom = lathe("MugBottom", [(R * 0.94, 0.0), (0.0, 0.02)], "MugEnamel", sides=48)
    coffee = lathe("MugCoffee", [(R - 0.17, H - 0.6), (0.0, H - 0.6)], "Coffee", sides=48)
    # Handle on the far left side (+x), so the logo faces the camera.
    pts = []
    for k in range(17):
        a = -math.pi / 2 + math.pi * k / 16
        pts.append((R + 0.05 + math.cos(a) * 0.95, H * 0.52 + math.sin(a) * 1.25, 0.0))
    handle = tube_path("MugHandle", pts, 0.2, "MugEnamel", ring=12)
    return group("Mug", [join([body, bottom, inside, handle], "MugMesh"), join([rim], "MugRim"), join([coffee], "MugCoffee")])


def crate():
    W, H, D = 3.8, 3.2, 3.4
    parts = [box("CrateBody", (0, H / 2, 0), (W, H, D), "CrateSteel", bevel=0.05, uv=0.35)]
    edge = []
    e = 0.22
    for sx in (-1, 1):
        for sz in (-1, 1):
            edge.append(box(f"CrateEdgeV{sx}{sz}", (sx * (W / 2 - e / 2 + 0.03), H / 2, sz * (D / 2 - e / 2 + 0.03)), (e, H + 0.04, e), "CrateEdge", bevel=0.03))
        for y in (0.0, H):
            edge.append(box(f"CrateEdgeX{sx}{y}", (0, y + (0.08 if y == 0 else -0.08), sx * (D / 2 - e / 2 + 0.03)), (W + 0.04, e, e), "CrateEdge", bevel=0.03))
            edge.append(box(f"CrateEdgeZ{sx}{y}", (sx * (W / 2 - e / 2 + 0.03), y + (0.08 if y == 0 else -0.08), 0), (e, e, D + 0.04), "CrateEdge", bevel=0.03))
    # Lid band and front handle slot.
    edge.append(box("CrateLidBand", (0, H * 0.78, -D / 2 - 0.02), (W - 0.3, 0.12, 0.05), "CrateEdge"))
    rivets = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            for y in np.linspace(0.35, H - 0.35, 5):
                rivets.append(lathe(f"Riv{sx}{sz}{y:.2f}", [(0.06, 0.0), (0.05, 0.03), (0.0, 0.045)], "CrateRivet", sides=8,
                                    centre=(sx * (W / 2 - 0.11), y, sz * (D / 2 + 0.05))))
    # Embossed pixel tank on the front (-z).
    icon = []
    px = 0.17
    x0, y0 = 8 * px, H * 0.62
    for r, row in enumerate(TANK_ICON):
        for c, ch in enumerate(row):
            if ch == "X":
                # Screen right is three.js -x: column c runs toward -x.
                icon.append(box(f"Px{r}_{c}", (x0 - (c + 0.5) * px, y0 - (r + 0.5) * px, -D / 2 - 0.03), (px * 0.98, px * 0.98, 0.06), "CrateIcon"))
    return group("Crate", [join(parts, "CrateMesh"), join(edge + rivets, "CrateTrim"), join(icon, "CrateIconMesh")])


def pencil():
    L, r = 7.4, 0.2
    body = []
    verts, faces = [], []
    n = 6
    for k, x in enumerate((0.0, L)):
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x, r + math.sin(a) * r, math.cos(a) * r))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    body.append(mesh("PencilBody", verts, faces, "PencilPaint"))
    body.append(cylinder("PencilWoodTip", (L, r, 0), (L + 0.75, r, 0), r * 0.98, "PencilWood", sides=12, r2=0.06))
    body.append(cylinder("PencilLeadTip", (L + 0.75, r, 0), (L + 0.95, r, 0), 0.06, "PencilLead", sides=10, r2=0.005))
    return group("Pencil", [join(body, "PencilMesh")])


def paper():
    verts, faces, uvs = [], [], []
    N = 12
    w, d = 6.4, 6.4
    for j in range(N + 1):
        for i in range(N + 1):
            u, v = i / N, j / N
            x = (0.5 - u) * w
            z = (v - 0.5) * d
            y = 0.02 + 0.12 * (max(0, u - 0.82) / 0.18) ** 2 + 0.06 * math.sin(v * 3.1) * u
            verts.append((x, y, z))
            uvs.append((u, v))
    for j in range(N):
        for i in range(N):
            a = j * (N + 1) + i
            faces.append((a, a + 1, a + N + 2, a + N + 1))
    o = mesh("SketchPaperMesh", verts, faces, "SketchPaper", smooth=True)
    bkit.vertex_uvs(o, uvs)
    return group("SketchPaper", [o])


def leaf(name, base, direction, length, width, tilt):
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
    o = mesh(name, verts, faces, "Leaf", smooth=True)
    bkit.vertex_uvs(o, uvs)
    m = o.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = 0.03
    return o


def plant():
    from mathutils import Vector
    pot = lathe("PlantPot", [(0.0, 0.0), (1.4, 0.0), (1.8, 2.4), (1.9, 2.5), (1.75, 2.55)], "Pot", sides=40)
    soil = lathe("PlantSoil", [(1.72, 2.3), (0.0, 2.38)], "Soil", sides=32)
    parts = [pot, soil]
    leaves = []
    for k in range(9):
        a = 2 * math.pi * k / 9 + prng.random() * 0.5
        reach = 2.5 + prng.random() * 3.5
        lift = 3.0 + prng.random() * 3.5
        pts = []
        for i in range(9):
            t = i / 8
            pts.append((math.cos(a) * reach * t, 2.4 + lift * math.sin(t * math.pi * 0.8), math.sin(a) * reach * t))
        parts.append(tube_path(f"Stem{k}", pts, 0.07, "Stem", ring=6))
        for i in (3, 5, 7, 8):
            t = i / 8
            p = Vector(pts[i])
            dirv = Vector((math.cos(a + prng.uniform(-0.8, 0.8)), prng.uniform(-0.3, 0.4), math.sin(a + prng.uniform(-0.8, 0.8))))
            leaves.append(leaf(f"Leaf{k}_{i}", tuple(p), tuple(dirv), 1.6 + prng.random() * 1.1, 1.3 + prng.random() * 0.7, prng.uniform(-0.5, 0.5)))
    return group("Plant", [join(parts, "PlantPotMesh"), join(leaves, "PlantLeaves")])


def mine():
    """Voxel spike ball: a sphere of small blocks (lighter on the upper half), steel studs."""
    parts, lights, studs = [], [], []
    R = 0.8
    s = 0.24
    n = int(R / s) + 1
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            for k in range(-n, n + 1):
                c = np.array([i, j, k], np.float32) * s
                d = np.linalg.norm(c)
                if R - s * 0.9 < d <= R:
                    m = "MineLight" if (c[1] > 0.25 and (i + j + k) % 2 == 0) else "MineBlock"
                    (lights if m == "MineLight" else parts).append(box(f"V{i}{j}{k}", (c[0], c[1] + R, c[2]), (s * 0.96, s * 0.96, s * 0.96), m))
    for k in range(14):
        # Fibonacci sphere for the studs.
        y = 1 - 2 * (k + 0.5) / 14
        r = math.sqrt(1 - y * y)
        a = k * 2.399963
        dirv = np.array([math.cos(a) * r, y, math.sin(a) * r])
        a0 = dirv * R * 0.95
        a1 = dirv * (R + 0.32)
        studs.append(cylinder(f"Stud{k}", (a0[0], a0[1] + R, a0[2]), (a1[0], a1[1] + R, a1[2]), 0.09, "MineStud", sides=6, r2=0.02))
    return group("SpikeMine", [join(parts, "MineMesh"), join(lights, "MineLightMesh"), join(studs, "MineStuds")])


def build():
    materials()
    return [tray(), desk(), lamp(), mug(), crate(), pencil(), paper(), plant(), mine()]


def render(out_dir, roots):
    os.makedirs(out_dir, exist_ok=True)
    by = {r.name: r for r in roots}
    place = {"DeskLamp": (14.1, -0.32, 7.2), "Mug": (12.4, -0.32, 1.6), "Crate": (-13.8, -0.32, 2.6), "Pencil": (-9.5, -0.1, -4.6),
             "SketchPaper": (-11.0, -0.31, -6.3), "Plant": (-15.5, -0.32, 11.5), "SpikeMine": (6.0, 0.0, -0.9)}
    for n, p in place.items():
        by[n].location = bkit.tb(p)
    by["Pencil"].rotation_euler = (0, 0, math.radians(30))
    bkit.preview(os.path.join(out_dir, "desk.png"), cam=(0.1685, 25.865, -18.1358), cam_quat=(-0.035874, 0.894539, 0.444841, 0.025081), vfov=28.391, res=(1672, 941), samples=24,
                 lights=[("POINT", (9.4, 8.0, 3.8), 900, 0xffb060), ("AREA", (-10, 14, 14), 600, 0x5aa8ff)])


def main():
    bkit.reset()
    roots = build()
    bkit.export(roots, OUT)
    if RENDER_DIR:
        render(RENDER_DIR, roots)
    print("night desk done")


main()
