"""
Skull shot for scenario 03 NEON RAIN (Blender 4.2+/5.x): the CRITICAL (black) projectile - a black
lacquered skull with readable features: domed cranium, brow ridge over deep eye sockets, a
heart-shaped nose hole, cheekbones, the upper teeth row, a separate jaw (mandible) under it; a
faint violet glow deep in the eye sockets. Low-poly for many instances (<= 3k triangles).

    python tools/blender/build_skull_shot.py [--render out_dir]

Output: assets/models/skull_shot.glb (+ .blend), three.js axes, origin at the skull centre, the
face toward +z (flight direction), ~1.0 tall:
  SkullShot       root
    SkullHead     cranium + face + teeth + jaw, one sculpted mesh (signed-distance model, marching
                  cubes, decimated) - material SkullBone: black glossy lacquer
    SkullEyesGlow two glow discs deep in the sockets (material SkullEyes: emissive violet)
The engine adds the purple-black smoke trail.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "assets", "models", "skull_shot.glb")
MAX_TRIS = 3000


# ---------------------------------------------------------------------------------------------
# Signed-distance sculpt (three.js axes: x right, y up, z = face / flight direction), meshed
# with marching cubes, then decimated to the triangle budget.
# ---------------------------------------------------------------------------------------------
import numpy as np  # noqa: E402

G = 150
LIM = 0.62
_ax = np.linspace(-LIM, LIM, G, dtype=np.float32)
X, Y, Z = np.meshgrid(_ax, _ax, _ax, indexing="ij")


def sd_ell(c, r):
    px, py, pz = (X - c[0]) / r[0], (Y - c[1]) / r[1], (Z - c[2]) / r[2]
    k0 = np.sqrt(px * px + py * py + pz * pz)
    k1 = np.sqrt((px / r[0]) ** 2 + (py / r[1]) ** 2 + (pz / r[2]) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-6)


def sd_rbox(c, h, rad, rot_y=0.0):
    px, py, pz = X - c[0], Y - c[1], Z - c[2]
    if rot_y:
        cs, sn = math.cos(-rot_y), math.sin(-rot_y)
        px, pz = px * cs + pz * sn, -px * sn + pz * cs
    qx, qy, qz = np.abs(px) - h[0], np.abs(py) - h[1], np.abs(pz) - h[2]
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
    return out + np.minimum(np.maximum(np.maximum(qx, qy), qz), 0) - rad


def sd_capsule(a, b, r):
    a, b = np.array(a, np.float32), np.array(b, np.float32)
    ba = b - a
    px, py, pz = X - a[0], Y - a[1], Z - a[2]
    t = np.clip((px * ba[0] + py * ba[1] + pz * ba[2]) / float(ba @ ba), 0, 1)
    return np.sqrt((px - t * ba[0]) ** 2 + (py - t * ba[1]) ** 2 + (pz - t * ba[2]) ** 2) - r


def sd_nose(y_top, y_bot, half_w, z0):
    """Inverted-heart / triangular nose hole (point up), extruded from z0 forward."""
    t = np.clip((y_top - Y) / (y_top - y_bot), 0, 1)
    w = half_w * (t ** 0.8) * (1.0 - 0.25 * np.clip((t - 0.75) / 0.25, 0, 1))
    d2 = np.maximum(np.abs(X) - w, np.maximum(Y - y_top, y_bot - Y))
    return np.maximum(d2, z0 - Z)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sdf_head():
    d = sd_ell((0, 0.12, -0.05), (0.4, 0.41, 0.47))                       # cranium
    d = smin(d, sd_rbox((0, -0.1, 0.17), (0.17, 0.12, 0.14), 0.08), 0.1)  # face block
    d = smin(d, sd_capsule((-0.24, 0.085, 0.29), (0.24, 0.085, 0.29), 0.055), 0.06)  # brow ridge
    for sx in (1, -1):
        d = smin(d, sd_ell((sx * 0.235, -0.11, 0.2), (0.1, 0.065, 0.13)), 0.05)       # cheekbones
        d = smax(d, -sd_ell((sx * 0.44, -0.07, 0.02), (0.14, 0.13, 0.2)), 0.04)      # temple hollow
    d = smin(d, sd_ell((0, -0.24, 0.2), (0.16, 0.06, 0.12)), 0.05)                # maxilla (behind the teeth)
    for sx in (1, -1):
        d = smax(d, -sd_ell((sx * 0.145, -0.0, 0.36), (0.105, 0.098, 0.16)), 0.025)  # eye sockets
    d = smax(d, -sd_nose(-0.06, -0.19, 0.06, 0.22), 0.012)                        # nose hole
    d = smax(d, -sd_rbox((0, -0.365, 0.22), (0.2, 0.04, 0.2), 0.01), 0.01)        # mouth gap
    # jaw: U-shaped mandible, chin, rami up behind the cheekbones, lower teeth
    jaw = None
    pts = [(math.sin(a) * 0.19, -0.44 + 0.03 * abs(math.sin(a)), 0.16 + math.cos(a) * 0.165) for a in np.linspace(-1.45, 1.45, 9)]
    for p0, p1 in zip(pts, pts[1:]):
        c = sd_capsule(p0, p1, 0.05)
        jaw = c if jaw is None else smin(jaw, c, 0.03)
    jaw = smin(jaw, sd_ell((0, -0.46, 0.31), (0.08, 0.05, 0.045)), 0.04)
    for sx in (1, -1):
        jaw = smin(jaw, sd_capsule((sx * 0.19, -0.44, 0.15), (sx * 0.25, -0.2, -0.02), 0.045), 0.04)
    return np.minimum(d, jaw)


def to_mesh(d, name):
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(d, 0.0, spacing=(_ax[1] - _ax[0],) * 3)
    verts = verts - LIM
    me = bpy.data.meshes.new(name)
    me.from_pydata([bkit.tb(tuple(v)) for v in verts], [], [tuple(f[::-1]) for f in faces])
    me.validate()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def decimate(o, tris):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n > tris:
        m = o.modifiers.new("D", "DECIMATE")
        m.ratio = tris / n
        bkit.apply_mods(o)
    return o


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def build():
    bkit.mat("SkullBone", 0x0b0b0e, rough=0.22, metal=0.1, coat=(1.0, 0.03))
    bkit.mat("SkullEyes", 0x2a1050, rough=0.4, emit=0.9, emit_hex=0x7a3cff)
    o = to_mesh(sdf_head(), "SkullHead")
    decimate(o, MAX_TRIS - 860)
    # Teeth as separate crisp bevelled blocks (the sculpt grid would melt them together):
    # 8 upper teeth on an arc, 6 lower ones on the jaw, small gaps between them.
    teeth = []
    for row, n_, y, h, rr, step in (("U", 8, -0.29, 0.1, 0.175, 0.15), ("L", 6, -0.395, 0.065, 0.16, 0.16)):
        for i in range(n_):
            a = (i - (n_ - 1) / 2) * step
            x, z = math.sin(a) * rr, 0.2 + math.cos(a) * (rr - 0.005)
            t = bkit.box(f"Tooth{row}{i}", (x, y, z), (0.038, h, 0.05), None, bevel=0.01, segs=1)
            bkit.apply_mods(t)
            bkit.rotate_y(t, a, pivot=(x, y, z))
            teeth.append(t)
    o = bkit.join([o] + teeth, "SkullHead")
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.data.materials.append(bkit.MATS["SkullBone"])
    o.data.shade_smooth()
    eyes = []
    for sx in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1.0, location=bkit.tb((sx * 0.145, 0.0, 0.215)))
        e = bpy.context.active_object
        e.scale = (0.045, 0.02, 0.04)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        eyes.append(e)
    eg = bkit.join(eyes, "SkullEyesGlow")
    eg.data.materials.clear()
    eg.data.materials.append(bkit.MATS["SkullEyes"])
    from mathutils import Vector
    allv = [v.co for v in o.data.vertices]
    mn = Vector((min(v.x for v in allv), min(v.y for v in allv), min(v.z for v in allv)))
    mx = Vector((max(v.x for v in allv), max(v.y for v in allv), max(v.z for v in allv)))
    c = (mn + mx) / 2
    for ob in (o, eg):
        for v in ob.data.vertices:
            v.co -= c
    print("skull tris", tri_count(o) + tri_count(eg), "height", round(mx.z - mn.z, 3))
    return bkit.group("SkullShot", [o, eg])


def main():
    bkit.reset()
    root = build()
    bkit.export([root], OUT)
    if RENDER_DIR:
        os.makedirs(RENDER_DIR, exist_ok=True)
        bkit.preview(os.path.join(RENDER_DIR, "skull.png"), target=(0, 0, 0), cam=(0.9, 0.35, 2.6), lens=60, res=(560, 560), samples=24,
                     lights=[("AREA", (-1.5, 2.5, 2.5), 160, 0xffffff), ("POINT", (2.0, 0.5, 0.5), 60, 0x9a6aff), ("POINT", (0.5, -1.0, 2.2), 60, 0x9ab4ff)])
        from PIL import Image
        Image.open(os.path.join(RENDER_DIR, "skull.png")).save(os.path.join(ROOT, "tools", "night", "ref", "design_skull_shot.png"))
    print("skull shot done")


main()
