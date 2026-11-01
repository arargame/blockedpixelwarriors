"""
Supply crate for the tank level (Blender 4.2+/5.x): the military crate of the HOMING ROCKETS card
painting (assets/textures/cards/tank_homing.jpg) - a chunky lidded box with bevelled edges,
riveted steel corner caps and edge bands, two front latches, rope handles on the sides and a
glowing stencil letter on the lid. One model for every supply: the game tints the paint per
type (R red, T orange, D blue, H green, G purple) and shows the matching letter.

    python tools/blender/build_supply.py [--render out_dir]

Output: assets/models/supply.glb (+ supply.blend). three.js axes, up = +Y, front = +Z; the crate
is 1.0 wide, centred on its origin:
  SupplyCrate        root (the front with the latches faces -z, toward the game camera)
    SupplyBody       painted wood (material SupplyPaint: near-white, tinted by the game)
    SupplyTrim       steel caps / bands / latches / handles (SupplyMetal, SupplyRope)
    SupplyLetterT/D/R/H/G   glowing letter on the lid (SupplyGlow), one shown at a time
"""
import bpy
import bmesh
import math
import os
import sys
import tempfile
from mathutils import Vector, Matrix

import numpy as np
from PIL import Image

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "models")
TMP = tempfile.mkdtemp()
LETTERS = ["T", "D", "R", "H", "G"]

W, H, D = 1.0, 0.56, 0.64          # crate size (x, y, z)
LID = 0.17                          # lid height
T2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def tb(p):
    return (T2B @ Vector(p).to_4d()).to_3d()


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


MATS = {}


def paint_texture():
    """Near-white painted planks (the game multiplies the type colour in): plank seams, grain,
    chipped paint along the edges, a little grime."""
    S = 512
    rng = np.random.default_rng(5)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    base = np.full((S, S), 0.93, np.float32)
    # Horizontal planks (5 per tile) with seams.
    plank = (y / (S / 5)) % 1.0
    base -= 0.35 * np.exp(-((plank - 0.0) / 0.012) ** 2) + 0.35 * np.exp(-((plank - 1.0) / 0.012) ** 2)
    # Grain.
    small = rng.random((64, 8)).astype(np.float32)
    grain = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255
    base -= (grain - 0.5) * 0.08
    noise = rng.random((S, S)).astype(np.float32)
    base -= (noise > 0.985) * 0.12
    img = np.stack([base, base * 0.985, base * 0.97], -1)
    img = np.clip(img, 0, 1) * 255
    path = os.path.join(TMP, "SupplyPaint.png")
    Image.fromarray(img.astype(np.uint8)).save(path)
    im = bpy.data.images.load(path)
    im.name = "SupplyPaint"
    im.pack()
    return im


def mat(name, hexv=None, rough=0.55, metal=0.0, emit=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


def new_obj(name, me, material):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(MATS[material])
    return o


def box(name, c, s, material, bevel=0.02, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = tb((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me, material)
    if bevel:
        m = o.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = segs
        m.limit_method = "ANGLE"
    return o


def cylinder(name, a, b, r, material, sides=12):
    a, b = Vector(a), Vector(b)
    axis = (b - a)
    L = axis.length
    axis.normalize()
    up = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(up).normalized()
    w = axis.cross(u).normalized()
    verts = []
    for t in (0, 1):
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            verts.append(tb(a + axis * (L * t) + (u * math.cos(ang) + w * math.sin(ang)) * r))
    faces = [tuple(range(sides - 1, -1, -1)), tuple(range(sides, 2 * sides))]
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = new_obj(name, me, material)
    for p in o.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return o


def torus_arc(name, c, R, r, a0, a1, axis, material, segs=14):
    """Bent rope handle: a tube along an arc (plane given by axis 'x' = in the y-z plane)."""
    verts = []
    faces = []
    ring = 8
    for k in range(segs + 1):
        t = a0 + (a1 - a0) * k / segs
        if axis == "x":
            centre = Vector((c[0], c[1] + math.sin(t) * R, c[2] + math.cos(t) * R))
            tangent = Vector((0, math.cos(t), -math.sin(t)))
        n1 = tangent.cross(Vector((1, 0, 0))).normalized()
        n2 = tangent.cross(n1).normalized()
        for i in range(ring):
            ang = 2 * math.pi * i / ring
            verts.append(tb(centre + (n1 * math.cos(ang) + n2 * math.sin(ang)) * r))
    for k in range(segs):
        for i in range(ring):
            j = (i + 1) % ring
            a = k * ring
            b = (k + 1) * ring
            faces.append((a + i, a + j, b + j, b + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = new_obj(name, me, material)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def uv_box(o, scale=1.0):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = lp.vert.co
            a, c = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            lp[uv].uv = (a * scale + 0.5, c * scale + 0.5)
    bm.to_mesh(o.data)
    bm.free()


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


def letter(ch):
    """Extruded stencil letter lying on the lid (three.js: in the x-z plane, reading from the front)."""
    curve = bpy.data.curves.new(f"Letter{ch}", "FONT")
    curve.body = ch
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 0.54
    curve.extrude = 0.018
    curve.bevel_depth = 0.006
    curve.bevel_resolution = 2
    # A chunky geometric bold (the card painting's letter); Blender's own font if none is there.
    for path in ("/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf",
                 "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(path):
            curve.font = bpy.data.fonts.load(path, check_existing=True)
            break
    o = bpy.data.objects.new(f"SupplyLetter{ch}", curve)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = f"SupplyLetter{ch}"
    # Text lies in Blender's XY plane (= three.js x / -z), its top toward Blender +Y (three.js
    # -z). The game camera looks up +z, so turn it 180 degrees (top toward +z, reads upright on
    # screen) and lift it onto the lid top.
    for v in o.data.vertices:
        v.co.x, v.co.y = -v.co.x, -v.co.y
        v.co.z += H / 2 + 0.012
    o.data.materials.clear()
    o.data.materials.append(MATS["SupplyGlow"])
    return o


def build():
    mat("SupplyPaint", rough=0.6, image=paint_texture())
    mat("SupplyMetal", 0x8A8F96, 0.32, 0.85)
    mat("SupplyDark", 0x2A2C30, 0.6, 0.4)
    mat("SupplyRope", 0x8A6A44, 0.85)
    mat("SupplyGlow", 0xFFF2C8, 0.3, 0.0, 6.0)
    mat("SupplyPlate", 0xE9DCC0, 0.45)

    body = []
    # Box + lid (separate slabs, a dark seam between), recessed side panels.
    body.append(box("Base", (0, -LID / 2, 0), (W, H - LID, D), "SupplyPaint", 0.035, 3))
    body.append(box("Lid", (0, H / 2 - LID / 2 + 0.008, 0), (W + 0.02, LID, D + 0.02), "SupplyPaint", 0.04, 3))
    body.append(box("Seam", (0, H / 2 - LID - 0.004, 0), (W - 0.02, 0.02, D - 0.02), "SupplyDark", 0))
    # Raised top panel framing the letter.
    body.append(box("TopPanel", (0, H / 2 + 0.006, 0), (W * 0.62, 0.02, D * 0.7), "SupplyPaint", 0.012))
    for o in body:
        uv_box(o, 1.6)
    body_o = join(body, "SupplyBody")

    trim = []
    # Steel corner caps on all eight corners (three thin plates each) with rivets.
    t = 0.022
    cap = 0.16
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                cx, cy, cz = sx * (W / 2 + 0.006), sy * (H / 2) - sy * cap / 2 + (0.01 if sy > 0 else 0), sz * (D / 2 + 0.006)
                trim.append(box("CapX", (cx, cy, sz * (D / 2 - cap / 2 + 0.01)), (t, cap, cap), "SupplyMetal", 0.008))
                trim.append(box("CapZ", (sx * (W / 2 - cap / 2 + 0.01), cy, cz), (cap, cap, t), "SupplyMetal", 0.008))
                trim.append(box("CapY", (sx * (W / 2 - cap / 2 + 0.01), sy * (H / 2 + 0.012), sz * (D / 2 - cap / 2 + 0.01)), (cap, t, cap), "SupplyMetal", 0.008))
                for k in (0.05, -0.05):
                    trim.append(cylinder("Rivet", (cx, cy + k * 0.6, sz * (D / 2 - cap / 2)), (cx + sx * 0.012, cy + k * 0.6, sz * (D / 2 - cap / 2)), 0.014, "SupplyMetal", 8))
    # Vertical steel bands front / back (two each); the lid top stays clear for the letter.
    for sz in (-1, 1):
        for bx in (-0.22, 0.22):
            trim.append(box("Band", (bx, -0.01, sz * (D / 2 + 0.012)), (0.07, H + 0.02, t), "SupplyMetal", 0.006))
    # Front latches across the lid seam.
    for bx in (-0.36, 0.36):
        trim.append(box("LatchPlate", (bx, H / 2 - LID - 0.01, -(D / 2 + 0.02)), (0.1, 0.16, 0.022), "SupplyDark", 0.008))
        trim.append(box("LatchHasp", (bx, H / 2 - LID + 0.04, -(D / 2 + 0.034)), (0.06, 0.09, 0.016), "SupplyMetal", 0.006))
    # Rope handles in steel brackets on both ends.
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.03)
        for bz in (-0.13, 0.13):
            trim.append(box("HandleBracket", (x, 0.04, bz), (0.04, 0.08, 0.05), "SupplyDark", 0.006))
        trim.append(torus_arc("Rope", (x + sx * 0.035, 0.0, 0.0), 0.13, 0.022, math.pi * 0.5, math.pi * 1.5, "x", "SupplyRope", 16))
    # Small stencil plate on the front.
    trim.append(box("FrontPlate", (0, -0.1, -(D / 2 + 0.01)), (0.22, 0.11, 0.01), "SupplyPlate", 0.004))
    trim_o = join(trim, "SupplyTrim")

    letters = [letter(ch) for ch in LETTERS]

    root = bpy.data.objects.new("SupplyCrate", None)
    bpy.context.scene.collection.objects.link(root)
    for o in (body_o, trim_o, *letters):
        o.parent = root
    return root, letters


def render(out_dir, root, letters):
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 40
    sc.render.resolution_x, sc.render.resolution_y = 700, 560
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = True
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.055, 0.06, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 2.4
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.6, 0.0, 0.7)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 60
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, 0))
    cam.location = Vector((1.2, 2.6, 2.2))   # Blender +Y = three.js -z: the front, like the game camera
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    paint = MATS["SupplyPaint"].node_tree.nodes["Principled BSDF"]
    colours = {"T": 0xFF8A1E, "D": 0x2F7FF0, "R": 0xD8302A, "H": 0x36B84A, "G": 0x9A4AE0}
    mix = None
    for ch in LETTERS:
        for o in letters:
            o.hide_render = o.name != f"SupplyLetter{ch}"
        # Tint the paint like the game does (multiply).
        nt = MATS["SupplyPaint"].node_tree
        if mix is None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            tex = [n for n in nt.nodes if n.type == "TEX_IMAGE"][0]
            nt.links.new(tex.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], paint.inputs["Base Color"])
        mix.inputs["B"].default_value = srgb(colours[ch])
        sc.render.filepath = os.path.abspath(os.path.join(out_dir, f"supply_{ch}.png"))
        bpy.ops.render.render(write_still=True)


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    root, letters = build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "supply.glb")), export_format="GLB", export_yup=True, use_selection=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "supply.blend")))
    if RENDER_DIR:
        render(RENDER_DIR, root, letters)
    print("supply done")


main()
