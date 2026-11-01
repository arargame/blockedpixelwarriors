"""
WW2 fighter for the tank level (Blender 4.2+/5.x): the Blocked Pixel Panzer "FighterJet" enemy
(Blocked.Shared/Content/Enemies/FighterJetTextureAtlasV2.png, frames in ref/fighter/) built in 3D.

  * FUSELAGE: a stubby cartoon body lofted from superellipse rings (fat behind the cowling,
    tapering up to the tail), olive drab with panel lines and rivets, the red-star roundel on both
    sides, a red shark mouth with white teeth and an eye on the nose;
  * COWLING: a dark lip ring, the engine face with radial cylinders, three exhaust stacks a side;
  * WINGS: low elliptical-tip wings with a little dihedral, panel lines, roundels top and bottom,
    a three-barrel gun pack under each wing fed by a brass ammo belt from a box on the fuselage;
  * TAIL: tall rounded fin with a rudder line, rounded stabilizers;
  * CANOPY: a glass bubble with three frame hoops and a spine; the pilot (leather helmet, goggles,
    scarf) sits in the open rear cockpit with a headrest fairing behind him;
  * PROPELLER (own object, spins): olive spinner and three rusty blades with orange tips, plus the
    blur disc with the gold tip ring of the sprite (own object, shown while spinning);
  * BOMB (own object, dropped by the game): a 500 lb general purpose bomb - ogive nose with a
    fuze, olive body with yellow bands, tapered tail with a box fin, on a belly shackle.

    python tools/blender/build_fighter.py [--render out_dir]

Output: assets/models/fighter.glb (+ fighter.blend). three.js axes, nose = +Z, up = +Y:
  Fighter             root at the fuselage centre line
    FighterBody       everything static
    FighterProp       spins about +Z (origin = prop hub)
    FighterPropDisc   blur disc (origin = prop hub)
    FighterBomb       the bomb on its shackle (origin = bomb centre; the game drops a copy)
    FighterGunL/R     empties at the muzzles of the wing guns
"""
import bpy
import bmesh
import math
import os
import random
import sys
import tempfile
from mathutils import Vector, Matrix

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "models")
TMP = tempfile.mkdtemp()
PI = math.pi

T2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def tb(p):
    return (T2B @ Vector(p).to_4d()).to_3d()


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


# ---- Fuselage profile: z (tail .. nose), half width, half height, centre height -------------
STATIONS = [
    (-2.42, 0.06, 0.08, 0.24),
    (-2.30, 0.13, 0.17, 0.22),
    (-2.05, 0.21, 0.28, 0.19),
    (-1.60, 0.32, 0.41, 0.14),
    (-1.00, 0.44, 0.53, 0.10),
    (-0.35, 0.54, 0.63, 0.07),
    (0.30, 0.60, 0.69, 0.05),
    (0.95, 0.63, 0.70, 0.03),
    (1.55, 0.64, 0.67, 0.02),
    (1.92, 0.63, 0.64, 0.01),
    (2.04, 0.60, 0.61, 0.0),
]
Z0, Z1 = STATIONS[0][0], STATIONS[-1][0]
SUPER = 2.5
NOSE_Z = 2.06
PROP_Z = 2.32
BOMB_C = (0.0, -0.95, 0.35)
WING_Y = -0.36
DIHEDRAL = math.radians(6)


def section(z):
    """Interpolated (rx, ry, cy) of the fuselage at z."""
    for (za, ax, ay, ac), (zb, bx, by, bc) in zip(STATIONS, STATIONS[1:]):
        if za <= z <= zb:
            t = (z - za) / (zb - za)
            t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
            return ax + (bx - ax) * t, ay + (by - ay) * t, ac + (bc - ac) * t
    return STATIONS[-1][1:] if z > Z1 else STATIONS[0][1:]


def superellipse(theta, rx, ry):
    c, s = math.cos(theta), math.sin(theta)
    e = 2 / SUPER
    return rx * math.copysign(abs(c) ** e, c), ry * math.copysign(abs(s) ** e, s)


# ---------------------------------------------------------------------------------------------
# Textures (PIL -> packed images)
# ---------------------------------------------------------------------------------------------

OLIVE = np.array([0x6E, 0x66, 0x31], np.float32)
OLIVE_HI = np.array([0x8C, 0x82, 0x44], np.float32)
PANEL = np.array([0x3A, 0x36, 0x1E], np.float32)
RIVET = np.array([0x9C, 0x92, 0x58], np.float32)
NAVY = np.array([0x2A, 0x33, 0x52], np.float32)
WHITE = np.array([0xEE, 0xE6, 0xDA], np.float32)
RED = np.array([0xB0, 0x2A, 0x22], np.float32)
MOUTH = np.array([0x8E, 0x1E, 0x1A], np.float32)


def noise(h, w, seed, scale):
    rng = np.random.default_rng(seed)
    small = rng.random((h // scale + 2, w // scale + 2)).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w + scale * 2, h + scale * 2), Image.BICUBIC)
    return np.asarray(img, np.float32)[:h, :w] / 255.0


def save_image(arr, name):
    path = os.path.join(TMP, name + ".png")
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path)
    img = bpy.data.images.load(path)
    img.name = name
    img.pack()
    return img


_ROUNDEL = None


def roundel_image():
    """Navy ring, white disc, sharp red five-point star (RGBA, 512 px, radius = 1 at the edge)."""
    global _ROUNDEL
    if _ROUNDEL is None:
        S = 512
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = S / 2
        d.ellipse((0, 0, S - 1, S - 1), fill=tuple(int(v) for v in NAVY) + (255,))
        d.ellipse((c - 0.8 * c, c - 0.8 * c, c + 0.8 * c, c + 0.8 * c), fill=tuple(int(v) for v in WHITE) + (255,))
        pts = []
        for k in range(10):
            r = 0.7 if k % 2 == 0 else 0.29
            a = -PI / 2 + k * PI / 5
            pts.append((c + math.cos(a) * r * c, c + math.sin(a) * r * c))
        d.polygon(pts, fill=tuple(int(v) for v in RED) + (255,))
        _ROUNDEL = np.asarray(im, np.float32)
    return _ROUNDEL


def roundel(du, dv, out, mask):
    """Paints the roundel where (du, dv) (roundel units, +dv = up) is inside the unit disc."""
    R = roundel_image()
    S = R.shape[0]
    px = np.clip(((du + 1) * 0.5 * S).astype(int), 0, S - 1)
    py = np.clip(((1 - dv) * 0.5 * S).astype(int), 0, S - 1)
    inside = mask & (du * du + dv * dv < 1.0)
    src = R[py[inside], px[inside]]
    out[inside] = src[:, :3]
    return inside


def fuselage_texture():
    """Cylindrical map: u = angle round the body (seam at the bottom), v = z (tail at the top)."""
    W, H = 1024, 1024
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    theta = U * 2 * PI - PI / 2
    z = Z0 + V * (Z1 - Z0)
    rx = np.zeros_like(z)
    ry = np.zeros_like(z)
    cy = np.zeros_like(z)
    for j in range(H):
        a, b_, c = section(z[j, 0])
        rx[j], ry[j], cy[j] = a, b_, c
    e = 2 / SUPER
    X = rx * np.sign(np.cos(theta)) * np.abs(np.cos(theta)) ** e
    Y = cy + ry * np.sign(np.sin(theta)) * np.abs(np.sin(theta)) ** e
    n = noise(H, W, 3, 16) * 0.5 + noise(H, W, 4, 4) * 0.5
    img = OLIVE[None, None, :] * (0.88 + 0.24 * n[..., None])
    # Sun-bleached top, darker belly.
    top = np.clip((Y - cy) / np.maximum(ry, 1e-3), -1, 1)[..., None]
    img = img + (OLIVE_HI - OLIVE)[None, None, :] * np.clip(top, 0, 1) * 0.55 - 14 * np.clip(-top, 0, 1)
    # Panel lines: rings along the body and seams along it.
    for zz in (-1.75, -1.15, -0.55, 0.15, 0.85, 1.45, 1.86):
        m = np.abs(z - zz) < 0.01
        img[m] = img[m] * 0.4 + PANEL * 0.6
        for side in (-1, 1):
            rv = (np.abs(z - (zz + side * 0.045)) < 0.008) & (np.mod(theta * 9, 1.0) < 0.22)
            img[rv] = RIVET
    for tt in (-0.95, 0.95, PI / 2):
        m = (np.abs(np.mod(theta - tt + PI, 2 * PI) - PI) < 0.01) & (z < 1.45)
        img[m] = img[m] * 0.5 + PANEL * 0.5
    # Roundels on both sides behind the wing.
    for side in (-1, 1):
        roundel((z - (-0.95)) / 0.36 * side, (Y - 0.12) / 0.36, img, side * X > 0.15)
    # Shark mouth + eye on both sides of the nose (side projection, z forward, y up).
    for side in (-1, 1):
        mask = side * X > 0.02
        zz = z
        yy = Y
        # Mouth: between an upper lip and a deep lower jaw, opening toward the cowling.
        t = np.clip((zz - 1.0) / 0.98, 0, 1)
        upper = -0.02 - 0.16 * t
        lower = -0.1 - 0.5 * np.sin(t * PI * 0.55) - 0.02 * t
        inside = mask & (zz > 1.0) & (zz < 1.97) & (yy < upper) & (yy > lower)
        img[inside] = MOUTH
        # Throat shadow at the back of the mouth.
        img[inside & (zz < 1.18)] = MOUTH * 0.6
        # Teeth: big white triangles from the upper lip and the jaw.
        ph = np.mod((zz - 1.0) / 0.15, 1.0)
        tri = 1 - np.abs(ph - 0.5) * 2
        ph2 = np.mod((zz - 1.075) / 0.15, 1.0)
        tri2 = 1 - np.abs(ph2 - 0.5) * 2
        up_t = inside & (yy > upper - 0.16 * tri) & (zz > 1.08)
        lo_t = inside & (yy < lower + 0.14 * tri2) & (zz > 1.12)
        img[up_t | lo_t] = WHITE
        lip = mask & (zz > 0.98) & (zz < 1.97) & (((np.abs(yy - upper) < 0.02) & (yy > lower)) | ((np.abs(yy - lower) < 0.02) & (yy < upper)))
        img[lip] = PANEL
        # Eye at the back corner of the mouth: white almond, dark pupil, dark outline.
        de = np.sqrt(((zz - 1.0) / 0.12) ** 2 + ((yy - 0.1) / 0.075) ** 2)
        img[mask & (de < 1.15)] = PANEL
        img[mask & (de < 1)] = WHITE
        dp = np.sqrt(((zz - 1.04) / 0.05) ** 2 + ((yy - 0.09) / 0.05) ** 2)
        img[mask & (dp < 1)] = np.array([0x20, 0x18, 0x10], np.float32)
    # Grime streaks behind the exhausts.
    for side in (-1, 1):
        g = (side * X > 0.3) & (Y > 0.08) & (Y < 0.38) & (z > 0.4) & (z < 1.4)
        k = np.clip((z - 0.4) / 1.0, 0, 1)
        img[g] = img[g] * (0.72 + 0.28 * (1 - k[g]))[..., None]
    return save_image(img, "FighterSkin")


def wing_texture():
    """Top-down map of the wings / stabilizers: x in [-2.8, 2.8] (u), z in [-2.6, 1.5] (v)."""
    W, H = 1024, 768
    x = -2.8 + (np.arange(W) + 0.5) / W * 5.6
    z = 1.5 - (np.arange(H) + 0.5) / H * 4.1
    X, Z = np.meshgrid(x, z)
    n = noise(H, W, 7, 12) * 0.6 + noise(H, W, 8, 3) * 0.4
    img = OLIVE[None, None, :] * (0.9 + 0.22 * n[..., None]) + (OLIVE_HI - OLIVE) * 0.25
    def line(m, k=0.55):
        img[m] = img[m] * (1 - k) + PANEL * k
    for xx in (-2.2, -1.25, 1.25, 2.2):
        line(np.abs(X - xx) < 0.008)
        rv = (np.abs(X - xx - 0.035) < 0.007) & (np.mod(Z * 10, 1) < 0.22)
        img[rv] = img[rv] * 0.6 + RIVET * 0.4
    line((np.abs(Z - 0.62) < 0.008) & (np.abs(X) > 0.6) & (np.abs(X) < 1.25), 0.4)
    # Ailerons / flaps line near the trailing edge.
    line((np.abs(Z - (-0.04)) < 0.009) & (np.abs(X) > 0.9), 0.7)
    # Paint chipping along the leading edges and walkway scuffs at the wing roots.
    chips = noise(H, W, 11, 2)
    m = (chips > 0.82) & (np.abs(X) < 1.0) & (np.abs(X) > 0.5)
    img[m] = img[m] * 0.75 + np.array([150, 140, 110], np.float32) * 0.25
    for side in (-1, 1):
        roundel((X - side * 1.85) / 0.36, (Z - 0.48) / 0.36, img, np.ones_like(X, bool))
    return save_image(img, "FighterWingSkin")


def prop_disc_texture():
    """Blur disc: faint dark streaks, transparent middle, the gold tip ring of the sprite."""
    S = 512
    yy, xx = np.mgrid[0:S, 0:S]
    dx = (xx - S / 2 + 0.5) / (S / 2)
    dy = (yy - S / 2 + 0.5) / (S / 2)
    r = np.sqrt(dx * dx + dy * dy)
    a = np.arctan2(dy, dx)
    rgba = np.zeros((S, S, 4), np.float32)
    streak = (0.5 + 0.5 * np.cos(a * 3)) ** 6
    rgba[..., :3] = np.array([40, 36, 30], np.float32)
    rgba[..., 3] = np.clip(streak * 70 * np.clip((r - 0.15) / 0.2, 0, 1), 0, 255) * (r < 0.93)
    ring = np.exp(-((r - 0.945) / 0.022) ** 2)
    gold = np.array([0xE8, 0xBE, 0x3A], np.float32)
    rgba[..., :3] = rgba[..., :3] * (1 - ring[..., None]) + gold * ring[..., None]
    rgba[..., 3] = np.maximum(rgba[..., 3], ring * 235) * (r < 1.0)
    path = os.path.join(TMP, "FighterPropDisc.png")
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(path)
    img = bpy.data.images.load(path)
    img.name = "FighterPropDisc"
    img.pack()
    return img


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------

MATS = {}


def mat(name, hexv=None, rough=0.55, metal=0.0, emit=0.0, image=None, alpha=None, nearest=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest" if nearest else "Linear"
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if alpha == "texture":
            nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    else:
        b.inputs["Base Color"].default_value = srgb(hexv)
    if isinstance(alpha, float):
        b.inputs["Alpha"].default_value = alpha
    if alpha is not None:
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        if hasattr(m, "blend_method"):
            try:
                m.blend_method = "BLEND"
            except Exception:
                pass
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


# ---------------------------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------------------------

def mesh_object(name, verts, faces, material, uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tb(v) for v in verts], [], faces)
    me.update()
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uvs[me.loops[li].vertex_index]
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(MATS[material])
    for p in me.polygons:
        p.use_smooth = smooth
    fix_normals(o)
    return o


def fix_normals(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()


def loft(rings, closed=True, cap0=True, cap1=True):
    """Faces joining equal-length rings of vertex indices (+ fan caps)."""
    faces = []
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            faces.append((a[i], a[j], b[j], b[i]))
    return faces


def add_mod(o, kind, **kw):
    m = o.modifiers.new(kind, kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def cylinder(name, a, b, r, material, sides=16, r2=None, cap=True):
    """Cylinder / cone between three.js points a and b."""
    a, b = Vector(a), Vector(b)
    axis = (b - a)
    length = axis.length
    axis.normalize()
    up = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(up).normalized()
    w = axis.cross(u).normalized()
    r2 = r if r2 is None else r2
    verts = []
    for t, rr in ((0, r), (1, r2)):
        c = a + axis * (length * t)
        for i in range(sides):
            ang = 2 * PI * i / sides
            verts.append(c + (u * math.cos(ang) + w * math.sin(ang)) * rr)
    faces = loft([list(range(sides)), list(range(sides, 2 * sides))])
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range(sides, 2 * sides)))
    o = mesh_object(name, verts, faces, material)
    for p in o.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return o


def sphere(name, c, radii, material, segs=24, rings=14, cut_below=None):
    verts = []
    faces = []
    for j in range(rings + 1):
        ph = -PI / 2 + PI * j / rings
        for i in range(segs):
            th = 2 * PI * i / segs
            verts.append((c[0] + radii[0] * math.cos(ph) * math.cos(th), c[1] + radii[1] * math.sin(ph), c[2] + radii[2] * math.cos(ph) * math.sin(th)))
    for j in range(rings):
        for i in range(segs):
            a = j * segs + i
            b = j * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    o = mesh_object(name, verts, faces, material)
    if cut_below is not None:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=tb((0, cut_below, 0)), plane_no=tb((0, 1, 0)), clear_inner=True)
        bm.to_mesh(o.data)
        bm.free()
    return o


def box(name, c, s, material, bevel=0.02):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    v = [(c[0] + x, c[1] + y, c[2] + z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    o = mesh_object(name, v, f, material, smooth=False)
    if bevel:
        add_mod(o, "BEVEL", width=bevel, segments=2)
    return o


# ---------------------------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------------------------

def fuselage():
    N = 40
    zs = []
    z = Z0
    while z < NOSE_Z - 1e-6:
        zs.append(z)
        z += 0.12 if z < 1.6 else 0.06
    zs.append(NOSE_Z - 0.02)
    verts, uvs, rings = [], [], []
    for z in zs:
        rx, ry, cy = section(z)
        ring = []
        for i in range(N + 1):            # seam vertex duplicated for the UVs
            th = -PI / 2 + 2 * PI * i / N
            x, y = superellipse(th, rx, ry)
            ring.append(len(verts))
            verts.append((x, cy + y, z))
            uvs.append((i / N, 1 - (z - Z0) / (Z1 - Z0)))
        rings.append(ring)
    faces = []
    for a, b in zip(rings, rings[1:]):
        for i in range(N):
            faces.append((a[i], a[i + 1], b[i + 1], b[i]))
    # Tail cap.
    tip = len(verts)
    verts.append((0, STATIONS[0][3], Z0 - 0.04))
    uvs.append((0.5, 1.0))
    for i in range(N):
        faces.append((rings[0][i + 1], rings[0][i], tip))
    o = mesh_object("Fuselage", verts, faces, "FighterSkin", uvs)
    add_mod(o, "SUBSURF", levels=1, render_levels=1)
    return o


def cowling(parts):
    rx, ry, cy = section(NOSE_Z - 0.02)
    # Lip ring (dark) round the front.
    N = 40
    verts, faces = [], []
    rings = []
    for k, (dz, s) in enumerate(((-0.1, 1.005), (-0.02, 1.04), (0.04, 1.03), (0.07, 0.94), (0.06, 0.82))):
        ring = []
        for i in range(N):
            th = 2 * PI * i / N
            x, y = superellipse(th, rx * s, ry * s)
            ring.append(len(verts))
            verts.append((x, cy + y, NOSE_Z + dz))
        rings.append(ring)
    faces = loft(rings)
    parts.append(mesh_object("CowlLip", verts, faces, "FighterDark"))
    # Engine face (dark disc) with radial cylinder heads.
    parts.append(cylinder("EngineFace", (0, cy, NOSE_Z - 0.05), (0, cy, NOSE_Z + 0.02), rx * 0.84, "FighterEngine", sides=32))
    for i in range(9):
        a = 2 * PI * i / 9
        p = Vector((math.cos(a) * 0.4, cy + math.sin(a) * 0.4, NOSE_Z))
        q = p + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.06))
        parts.append(cylinder(f"Cyl{i}", p, q, 0.075, "FighterMetal", sides=10))
    # Exhaust stacks: three a side, angled back.
    for side in (-1, 1):
        for k, z in enumerate((1.25, 1.42, 1.59)):
            base = Vector((side * 0.56, 0.22 - k * 0.02, z))
            tip = base + Vector((side * 0.13, -0.03, -0.13))
            parts.append(cylinder(f"Exhaust{side}{k}", base, tip, 0.05, "FighterExhaust", sides=10, r2=0.06))


def wing_section(chord, thick, le_z, x, y, n=14):
    """Airfoil outline (NACA 00xx-like, flat-ish bottom) at span x: list of (x, y, z)."""
    pts = []
    for k in range(n + 1):
        c = 1 - math.cos(PI * k / n) * 0.5 - 0.5
        t = 5 * thick * (0.2969 * math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4)
        pts.append((x, y + t * chord * 0.75, le_z - c * chord))
    for k in range(n - 1, 0, -1):
        c = 1 - math.cos(PI * k / n) * 0.5 - 0.5
        t = 5 * thick * (0.2969 * math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4)
        pts.append((x, y - t * chord * 0.35, le_z - c * chord))
    return pts


def lofted_surface(name, sections, material, uv_fn):
    verts, uvs, rings = [], [], []
    for sec in sections:
        ring = []
        for p in sec:
            ring.append(len(verts))
            verts.append(p)
            uvs.append(uv_fn(p))
        rings.append(ring)
    faces = loft(rings)
    # Cap both ends (ngon).
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))
    return mesh_object(name, verts, faces, material, uvs)


def wing_uv(p):
    return ((p[0] + 2.8) / 5.6, (p[2] + 2.6) / 4.1)


def wings(parts):
    half = 2.65
    root_chord = 1.62
    for side in (-1, 1):
        secs = []
        for k in range(15):
            s = k / 14
            span = s * half
            # Elliptical tip: the chord closes round the quarter chord line.
            tipk = 1.0 if span < half - 0.55 else math.sqrt(max(0.0, 1 - ((span - (half - 0.55)) / 0.56) ** 2))
            chord = root_chord * (1 - 0.32 * s) * max(tipk, 0.06)
            qc = 1.18 - 0.42 * root_chord * (1 - 0.32 * s) - 0.05 * s
            le = qc + 0.42 * chord
            y = WING_Y + span * math.tan(DIHEDRAL)
            thick = 0.17 - 0.06 * s
            secs.append(wing_section(chord, thick, le, side * (0.15 + span), y))
        w = lofted_surface(f"Wing{side}", secs, "FighterWing", wing_uv)
        add_mod(w, "SUBSURF", levels=1, render_levels=1)
        parts.append(w)
    # Wing root fairing (fills the gap under the fuselage).
    secs = [wing_section(root_chord * 1.05, 0.2, 1.24, x, WING_Y - 0.02) for x in (-0.3, 0.3)]
    parts.append(lofted_surface("WingCentre", secs, "FighterWing", wing_uv))


def stabilizers(parts):
    half = 1.12
    for side in (-1, 1):
        secs = []
        for k in range(10):
            s = k / 9
            span = s * half
            tipk = 1.0 if span < half - 0.3 else math.sqrt(max(0.0, 1 - ((span - (half - 0.3)) / 0.31) ** 2))
            chord = 0.78 * (1 - 0.3 * s) * max(tipk, 0.06)
            qc = -1.82 - 0.05 * s
            secs.append(wing_section(chord, 0.11, qc + 0.4 * chord, side * (0.08 + span), 0.2))
        st = lofted_surface(f"Stab{side}", secs, "FighterWing", wing_uv)
        add_mod(st, "SUBSURF", levels=1, render_levels=1)
        parts.append(st)
    # Fin: sections stacked up (x <-> y swapped airfoil).
    secs = []
    hgt = 1.12
    for k in range(12):
        s = k / 11
        h = s * hgt
        tipk = 1.0 if h < hgt - 0.38 else math.sqrt(max(0.0, 1 - ((h - (hgt - 0.38)) / 0.39) ** 2))
        chord = 1.0 * (1 - 0.32 * s) * max(tipk, 0.05)
        qc = -1.78 - 0.32 * s
        sec = wing_section(chord, 0.11, qc + 0.4 * chord, 0, 0)
        secs.append([(p[1], 0.28 + h, p[2]) for p in sec])
    fin = lofted_surface("Fin", secs, "FighterWing", lambda p: ((p[2] + 2.6) / 4.1 * 0.3 + 0.35, (p[1] - 0.2) / 1.3 * 0.25 + 0.05))
    add_mod(fin, "SUBSURF", levels=1, render_levels=1)
    parts.append(fin)
    # Rudder hinge line (thin dark strip).
    parts.append(box("RudderLine", (0, 0.86, -2.2), (0.12, 0.95, 0.015), "FighterPanel", 0))


def canopy(parts):
    c = (0.0, 0.55, 0.42)
    radii = (0.42, 0.46, 0.66)
    parts.append(sphere("Canopy", c, radii, "FighterGlass", 32, 16, cut_below=0.5))
    # Frame hoops + spine.
    for z in (0.02, 0.36, 0.7, 0.98):
        k = 1 - ((z - c[2]) / radii[2]) ** 2
        if k <= 0.02:
            continue
        rx, ry = radii[0] * math.sqrt(k) + 0.012, radii[1] * math.sqrt(k) + 0.012
        verts = []
        rings = []
        for layer, (dz, s) in enumerate(((-0.025, 1.0), (0.025, 1.0), (0.025, 1.06), (-0.025, 1.06))):
            ring = []
            for i in range(25):
                th = PI * i / 24
                ring.append(len(verts))
                verts.append((math.cos(th) * rx * s, c[1] - 0.05 + math.sin(th) * (ry + 0.05) * s, z + dz))
            rings.append(ring)
        faces = []
        for a, b in zip(rings, rings[1:] + rings[:1]):
            for i in range(24):
                faces.append((a[i], a[i + 1], b[i + 1], b[i]))
        parts.append(mesh_object(f"Hoop{z}", verts, faces, "FighterBodyPlain"))
    verts = []
    rings = []
    for z in np.linspace(c[2] - radii[2] * 0.97, c[2] + radii[2] * 0.97, 24):
        k = max(0.0, 1 - ((z - c[2]) / radii[2]) ** 2)
        y = c[1] + radii[1] * math.sqrt(k)
        ring = []
        for dx, dy in ((-0.03, -0.01), (0.03, -0.01), (0.03, 0.03), (-0.03, 0.03)):
            ring.append(len(verts))
            verts.append((dx, y + dy, z))
        rings.append(ring)
    parts.append(mesh_object("Spine", verts, loft(rings), "FighterBodyPlain"))


def pilot(parts):
    head = (0.0, 0.9, -0.32)
    # Open cockpit rim + headrest fairing behind.
    verts = []
    rings = []
    for k, (s, dy) in enumerate(((1.0, 0.0), (1.12, 0.04), (1.16, -0.02))):
        ring = []
        for i in range(24):
            th = 2 * PI * i / 24
            ring.append(len(verts))
            verts.append((math.cos(th) * 0.27 * s, 0.6 + dy, -0.3 + math.sin(th) * 0.33 * s))
        rings.append(ring)
    parts.append(mesh_object("CockpitRim", verts, loft(rings), "FighterDark"))
    secs = []
    for k in range(8):
        t = k / 7
        z = -0.62 - t * 0.8
        w = 0.22 * (1 - t) + 0.05
        h = 0.32 * (1 - t) + 0.02
        y0 = section(z)[2] + section(z)[1] * 0.75
        sec = []
        for i in range(13):
            th = PI * i / 12
            sec.append((math.cos(th) * w, y0 + math.sin(th) * h, z))
        secs.append(sec)
    parts.append(lofted_surface("Headrest", secs, "FighterBodyPlain", lambda p: (0.5, 0.5)))
    # Body: shoulders in a jacket, scarf, head, leather helmet with ear flaps, goggles.
    parts.append(sphere("Shoulders", (0, 0.62, -0.3), (0.26, 0.14, 0.18), "FighterJacket", 20, 10))
    parts.append(sphere("Scarf", (0, 0.7, -0.26), (0.16, 0.06, 0.15), "FighterScarf", 18, 8))
    parts.append(sphere("Face", head, (0.18, 0.2, 0.19), "FighterSkinTone", 22, 14))
    parts.append(sphere("Helmet", (0, head[1] + 0.05, head[2] - 0.025), (0.21, 0.19, 0.215), "FighterLeather", 22, 14, cut_below=head[1] - 0.005))
    for side in (-1, 1):
        parts.append(sphere(f"EarFlap{side}", (side * 0.18, head[1] - 0.05, head[2] - 0.01), (0.05, 0.11, 0.1), "FighterLeather", 12, 8))
        parts.append(cylinder(f"Goggle{side}", (side * 0.075, head[1] + 0.12, head[2] + 0.13), (side * 0.085, head[1] + 0.14, head[2] + 0.21), 0.062, "FighterBrass", 16))
        parts.append(cylinder(f"Lens{side}", (side * 0.085, head[1] + 0.14, head[2] + 0.21), (side * 0.087, head[1] + 0.142, head[2] + 0.215), 0.05, "FighterLens", 16))
    parts.append(box("GoggleStrap", (0, head[1] + 0.12, head[2] - 0.02), (0.43, 0.04, 0.33), "FighterDark", 0.01))
    parts.append(sphere("Nose", (0, head[1] - 0.03, head[2] + 0.18), (0.04, 0.045, 0.04), "FighterSkinTone", 10, 6))
    # Moustache (the sprite pilot's grin).
    parts.append(sphere("Moustache", (0, head[1] - 0.08, head[2] + 0.16), (0.08, 0.025, 0.03), "FighterLeather", 12, 6))


def gun_packs(parts, muzzles):
    for side in (-1, 1):
        x = side * 1.22
        y = WING_Y + (abs(x) - 0.15) * math.tan(DIHEDRAL) - 0.16
        parts.append(box(f"GunHousing{side}", (x, y + 0.02, 0.62), (0.42, 0.14, 0.7), "FighterDark", 0.03))
        for k, dx in enumerate((-0.13, 0.0, 0.13)):
            parts.append(cylinder(f"Barrel{side}{k}", (x + dx, y - 0.06, 0.3), (x + dx, y - 0.06, 1.62), 0.045, "FighterGun", 12))
            parts.append(cylinder(f"Flash{side}{k}", (x + dx, y - 0.06, 1.5), (x + dx, y - 0.06, 1.68), 0.06, "FighterDark", 12))
        muzzles[side] = (x, y - 0.06, 1.7)
        # Ammo box on the fuselage side, brass belt sagging down to the gun pack.
        bx = side * 0.6
        parts.append(box(f"AmmoBox{side}", (bx, -0.12, -0.02), (0.16, 0.26, 0.36), "FighterDark", 0.02))
        a = Vector((bx + side * 0.06, -0.22, 0.05))
        b = Vector((x - side * 0.12, y + 0.06, 0.45))
        n = 14
        for i in range(n):
            t = i / (n - 1)
            p = a.lerp(b, t) + Vector((0, -0.22 * math.sin(t * PI), 0))
            q = p + Vector((0, -0.09, 0.0))
            parts.append(cylinder(f"Round{side}{i}", p, q, 0.028, "FighterBrass", 8, r2=0.02))
            parts.append(cylinder(f"Link{side}{i}", p + Vector((-0.035, -0.03, 0)), p + Vector((0.035, -0.03, 0)), 0.012, "FighterDark", 6))


def bomb(parts_bomb):
    """500 lb GP bomb, axis along z, centred at the origin (moved to BOMB_C after joining)."""
    secs = []
    profile = [
        (-0.78, 0.035), (-0.74, 0.07), (-0.6, 0.11), (-0.42, 0.17), (-0.3, 0.205), (-0.15, 0.215), (0.2, 0.215),
        (0.36, 0.205), (0.5, 0.18), (0.6, 0.14), (0.68, 0.09), (0.72, 0.05), (0.74, 0.0),
    ]
    N = 24
    verts, uvs, rings = [], [], []
    for z, r in profile:
        ring = []
        for i in range(N):
            th = 2 * PI * i / N
            ring.append(len(verts))
            verts.append((math.cos(th) * max(r, 0.001), math.sin(th) * max(r, 0.001), z))
        rings.append(ring)
    faces = loft(rings)
    faces.append(tuple(reversed(rings[0])))
    o = mesh_object("BombBody", verts, faces, "BombOlive")
    add_mod(o, "SUBSURF", levels=1, render_levels=1)
    parts_bomb.append(o)
    # Yellow bands, fuze, tail box fin (4 blades + ring), lugs.
    for z in (0.32, -0.28):
        parts_bomb.append(cylinder(f"Band{z}", (0, 0, z - 0.035), (0, 0, z + 0.035), 0.218, "BombYellow", 24))
    parts_bomb.append(cylinder("Fuze", (0, 0, 0.72), (0, 0, 0.8), 0.04, "FighterBrass", 12, r2=0.025))
    parts_bomb.append(cylinder("TailFuze", (0, 0, -0.84), (0, 0, -0.76), 0.03, "FighterBrass", 10))
    for k in range(4):
        a = PI / 4 + k * PI / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        c = d * 0.16 + Vector((0, 0, -0.66))
        fin_w = Vector((math.cos(a + PI / 2), math.sin(a + PI / 2), 0)) * 0.012
        ext = d * 0.2
        verts = [c - fin_w - ext * 0.6, c + fin_w - ext * 0.6, c + fin_w + ext, c - fin_w + ext]
        verts = verts + [v + Vector((0, 0, -0.2)) for v in verts]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        f = mesh_object(f"BombFin{k}", verts, faces, "BombOlive", smooth=False)
        parts_bomb.append(f)
    for z0, z1, r in ((-0.84, -0.7, 0.29), ):
        N2 = 24
        verts = []
        rings = []
        for rr in (r, r - 0.025):
            for zz in (z0, z1):
                ring = []
                for i in range(N2):
                    th = 2 * PI * i / N2
                    ring.append(len(verts))
                    verts.append((math.cos(th) * rr, math.sin(th) * rr, zz))
                rings.append(ring)
        faces = loft([rings[0], rings[1], rings[3], rings[2], rings[0]])
        parts_bomb.append(mesh_object("BombBoxFin", verts, faces, "BombOlive"))
    for z in (-0.18, 0.18):
        parts_bomb.append(box(f"Lug{z}", (0, 0.24, z), (0.05, 0.06, 0.08), "FighterMetal", 0.01))


def propeller(parts_prop):
    # Spinner (olive, like the body).
    prof = [(0.0, 0.26), (0.08, 0.26), (0.18, 0.24), (0.28, 0.2), (0.38, 0.13), (0.45, 0.06), (0.48, 0.0)]
    N = 28
    verts, rings = [], []
    for dz, r in prof:
        ring = []
        for i in range(N):
            th = 2 * PI * i / N
            ring.append(len(verts))
            verts.append((math.cos(th) * max(r, 0.001), math.sin(th) * max(r, 0.001), dz - 0.08))
        rings.append(ring)
    faces = loft(rings)
    faces.append(tuple(reversed(rings[0])))
    parts_prop.append(mesh_object("Spinner", verts, faces, "FighterBodyPlain"))
    # Three blades: twisted, rounded tips, orange tip bands.
    for k in range(3):
        base_a = PI / 2 + k * 2 * PI / 3
        secs = []
        tips = []
        for j in range(12):
            t = j / 11
            r = 0.16 + t * 1.0
            w = (0.2 - 0.04 * t) * (1 if t < 0.85 else math.sqrt(max(0.05, 1 - ((t - 0.85) / 0.16) ** 2)))
            twist = math.radians(42 - 26 * t)
            th = 0.035 * (1 - 0.5 * t)
            # Blade cross-section in the plane perpendicular to its radius.
            d = Vector((math.cos(base_a), math.sin(base_a), 0))
            side = Vector((-math.sin(base_a), math.cos(base_a), 0))
            fwd = Vector((0, 0, 1))
            chord_dir = side * math.cos(twist) + fwd * math.sin(twist)
            thick_dir = fwd * math.cos(twist) - side * math.sin(twist)
            c = d * r + Vector((0, 0, 0.02))
            sec = [c + chord_dir * (w * 0.5 * math.cos(a)) + thick_dir * (th * math.sin(a)) for a in np.linspace(0, 2 * PI, 12, endpoint=False)]
            secs.append([tuple(p) for p in sec])
            tips.append(t)
        blade = lofted_surface(f"Blade{k}", secs, "PropBlade", lambda p: (0.5, 0.5))
        parts_prop.append(blade)
        # Orange tip band: a slightly larger copy of the last sections.
        tip_secs = []
        for sec, t in zip(secs, tips):
            if t >= 0.8:
                c = Vector(np.mean(np.array(sec), axis=0))
                tip_secs.append([tuple(c + (Vector(p) - c) * 1.06) for p in sec])
        parts_prop.append(lofted_surface(f"BladeTip{k}", tip_secs, "PropTip", lambda p: (0.5, 0.5)))


def prop_disc(img):
    S = 1.24
    verts = [(-S, -S, 0.03), (S, -S, 0.03), (S, S, 0.03), (-S, S, 0.03)]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return mesh_object("FighterPropDisc", verts, [(0, 1, 2, 3)], "PropDisc", uvs, smooth=False)


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------

def join(objs, name):
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def set_origin(o, three_pos):
    bpy.context.scene.cursor.location = tb(three_pos)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def build():
    skin = fuselage_texture()
    wing_img = wing_texture()
    disc = prop_disc_texture()
    mat("FighterSkin", rough=0.62, image=skin)
    mat("FighterWing", rough=0.62, image=wing_img)
    mat("FighterBodyPlain", 0x6E6631, 0.6)
    mat("FighterPanel", 0x3A361E, 0.7)
    mat("FighterDark", 0x2E2C22, 0.65, 0.2)
    mat("FighterEngine", 0x1A1A18, 0.8)
    mat("FighterMetal", 0x6C6A62, 0.4, 0.7)
    mat("FighterExhaust", 0x33302C, 0.6, 0.6)
    mat("FighterGun", 0x3C3E40, 0.35, 0.8)
    mat("FighterBrass", 0xD8A43C, 0.3, 0.9)
    mat("FighterGlass", 0x9ED4D0, 0.06, 0.1, alpha=0.55)
    mat("FighterJacket", 0x6A5236, 0.8)
    mat("FighterScarf", 0xE8E2D2, 0.8)
    mat("FighterSkinTone", 0xD89A6A, 0.6)
    mat("FighterLeather", 0x5C4228, 0.55)
    mat("FighterLens", 0x9CC8E0, 0.05, 0.3)
    mat("PropBlade", 0x5E5852, 0.55, 0.5)
    mat("PropTip", 0xE07A24, 0.5, 0.1)
    mat("PropDisc", image=disc, alpha="texture", rough=0.5)
    mat("BombOlive", 0x5E5A2E, 0.5, 0.2)
    mat("BombYellow", 0xE8B820, 0.5)

    body = [fuselage()]
    cowling(body)
    wings(body)
    stabilizers(body)
    canopy(body)
    pilot(body)
    muzzles = {}
    gun_packs(body, muzzles)
    # Belly shackle the bomb hangs from.
    body.append(box("Shackle", (BOMB_C[0], BOMB_C[1] + 0.32, BOMB_C[2]), (0.12, 0.2, 0.5), "FighterDark", 0.02))
    body_o = join(body, "FighterBody")

    prop_parts = []
    propeller(prop_parts)
    prop_o = join(prop_parts, "FighterProp")
    for v in prop_o.data.vertices:
        v.co += tb((0, 0, PROP_Z)) - tb((0, 0, 0))
    disc_o = prop_disc(disc)
    for v in disc_o.data.vertices:
        v.co += tb((0, 0, PROP_Z))
    set_origin(prop_o, (0, 0, PROP_Z))
    set_origin(disc_o, (0, 0, PROP_Z))

    bomb_parts = []
    bomb(bomb_parts)
    bomb_o = join(bomb_parts, "FighterBomb")
    for v in bomb_o.data.vertices:
        v.co += tb(BOMB_C)
    set_origin(bomb_o, BOMB_C)

    root = bpy.data.objects.new("Fighter", None)
    bpy.context.scene.collection.objects.link(root)
    empties = []
    for side, name in ((-1, "FighterGunL"), (1, "FighterGunR")):
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = tb(muzzles[side])
        empties.append(e)
    bpy.context.view_layer.update()
    for child in (body_o, prop_o, disc_o, bomb_o, *empties):
        mw = child.matrix_world.copy()
        child.parent = root
        child.matrix_world = mw
    bpy.context.view_layer.update()
    return root


def render(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.render.resolution_x, sc.render.resolution_y = 900, 900
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = True
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.055, 0.06, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 2.4
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = 0.3
    sun.rotation_euler = (0.5, 0.0, 0.6)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 60
    sc.collection.objects.link(cam)
    sc.camera = cam
    # Blender coords: nose = -Y, left = -X, up = +Z.
    views = {
        "sprite": (-0.62, -0.38, 0.62),    # the atlas angle: nose toward the bottom right
        "side": (-1.0, 0.0, 0.05),
        "top": (0.0, 0.0, 1.0),
        "front": (0.25, -1.0, 0.25),
        "under": (0.4, 0.3, -0.85),
        "game": (0.0, 0.45, 0.9),
    }
    target = Vector((0, 0.1, 0.1))
    for name, d in views.items():
        cam.location = target + Vector(d).normalized() * 13
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.abspath(os.path.join(out_dir, f"fighter_{name}.png"))
        bpy.ops.render.render(write_still=True)


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "fighter.glb")), export_format="GLB", export_yup=True, use_selection=True, export_extras=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "fighter.blend")))
    if RENDER_DIR:
        render(RENDER_DIR)
    print("fighter done")


main()
