"""
Upgrade card for Blocked Pixel Warriors (Blender 4.2+/5.x).

A poker-card-thin card (63 x 88 units scaled to 0.63 x 0.88, 0.003 thick = 0.3 mm on a real
card) with rounded corners, an embossed gold rim with corner diamonds, a jewel socket at the
top and a 3D ribbon banner across the lower third whose tails fold behind the card edges.

    python tools/blender/build_card.py                       # export card.glb / card.blend
    python tools/blender/build_card.py --render captures --art assets/textures/cards/engineer.jpg   # preview only

Materials (the game swaps the textures per card):
  CardFront   front face, UV 0..1 over the whole card (art + description panel)
  CardBack    back face, UV 0..1
  CardEdge    the thin paper edge
  CardGold    embossed rim + corner diamonds
  CardJewel   the gem at the top (tinted per card)
  CardBanner  main ribbon band, UV 0..1 along / across the band (title text)
  CardTail    ribbon tails
Axes: the card lies in Blender's XY plane, front toward +Z, top toward +Y. After the glTF
export (Y-up) the front faces three.js +Y; Cards.js turns it upright (rotation.x = +90 deg).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


RENDER_DIR = arg("--render")
ART = os.path.abspath(arg("--art")) if arg("--art") else None
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models"))

W, H, T = 0.63, 0.88, 0.003
R = 0.032          # corner radius
SEG = 10           # segments per corner


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


def reset():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)


def material(name, hexv, rough=0.5, metal=0.0, emit=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    return m


def rounded_rect(w, h, r, seg=SEG):
    """CCW outline of a rounded rectangle centred on the origin."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def card_body(mats):
    """Slab: front face (mat 0), back face (mat 1), edge (mat 2). UVs 0..1 on both faces."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    outline = rounded_rect(W, H, R)
    top = [bm.verts.new((x, y, T / 2)) for x, y in outline]
    bot = [bm.verts.new((x, y, -T / 2)) for x, y in outline]
    front = bm.faces.new(top)
    front.material_index = 0
    back = bm.faces.new(list(reversed(bot)))
    back.material_index = 1
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        f.material_index = 2
        f.smooth = True
    for f, mirror in ((front, False), (back, True)):
        for loop in f.loops:
            x, y = loop.vert.co.x, loop.vert.co.y
            u = (x + W / 2) / W
            loop[uv].uv = ((1 - u) if mirror else u, (y + H / 2) / H)
    bmesh.ops.triangulate(bm, faces=[front, back])
    return new_object("CardBody", bm, mats)


def frame(mat, inset_outer, inset_inner, height, z0):
    """Raised rim between two inset rounded rectangles (bevelled top)."""
    bm = bmesh.new()
    o = rounded_rect(W - 2 * inset_outer, H - 2 * inset_outer, max(0.004, R - inset_outer))
    i = rounded_rect(W - 2 * inset_inner, H - 2 * inset_inner, max(0.003, R - inset_inner))
    mid_o = rounded_rect(W - 2 * (inset_outer + 0.0025), H - 2 * (inset_outer + 0.0025), max(0.004, R - inset_outer - 0.0025))
    mid_i = rounded_rect(W - 2 * (inset_inner - 0.0025), H - 2 * (inset_inner - 0.0025), max(0.003, R - inset_inner + 0.0025))
    rings = [
        [bm.verts.new((x, y, z0)) for x, y in o],
        [bm.verts.new((x, y, z0 + height)) for x, y in mid_o],
        [bm.verts.new((x, y, z0 + height)) for x, y in mid_i],
        [bm.verts.new((x, y, z0)) for x, y in i],
    ]
    n = len(o)
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            l = (k + 1) % n
            f = bm.faces.new((a[k], a[l], b[l], b[k]))
            f.smooth = True
    return new_object("CardRim", bm, [mat])


def diamond(name, mat, x, y, z, size, depth):
    bm = bmesh.new()
    c = bm.verts.new((x, y, z + depth))
    ring = [bm.verts.new((x + size * math.cos(a), y + size * math.sin(a), z)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
    for k in range(4):
        bm.faces.new((ring[k], ring[(k + 1) % 4], c))
    return new_object(name, bm, [mat])


def jewel(mat, x, y, z, r):
    """Faceted cabochon-like gem: octagonal crown."""
    bm = bmesh.new()
    n = 8
    girdle = [bm.verts.new((x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n), z + r * 0.15)) for k in range(n)]
    table = [bm.verts.new((x + r * 0.55 * math.cos(2 * math.pi * (k + 0.5) / n), y + r * 0.55 * math.sin(2 * math.pi * (k + 0.5) / n), z + r * 0.55)) for k in range(n)]
    base = [bm.verts.new((x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n), z)) for k in range(n)]
    bm.faces.new(table)
    for k in range(n):
        l = (k + 1) % n
        bm.faces.new((girdle[k], girdle[l], table[k]))
        bm.faces.new((table[k], girdle[l], table[l]))
        bm.faces.new((base[k], base[l], girdle[l], girdle[k]))
    return new_object("CardJewel", bm, [mat])


def bezel(mat, x, y, z, r):
    bm = bmesh.new()
    n = 24
    outer = [bm.verts.new((x + r * 1.35 * math.cos(2 * math.pi * k / n), y + r * 1.35 * math.sin(2 * math.pi * k / n), z)) for k in range(n)]
    top_o = [bm.verts.new((x + r * 1.25 * math.cos(2 * math.pi * k / n), y + r * 1.25 * math.sin(2 * math.pi * k / n), z + 0.0018)) for k in range(n)]
    top_i = [bm.verts.new((x + r * 1.02 * math.cos(2 * math.pi * k / n), y + r * 1.02 * math.sin(2 * math.pi * k / n), z + 0.0018)) for k in range(n)]
    for a, b in ((outer, top_o), (top_o, top_i)):
        for k in range(n):
            l = (k + 1) % n
            f = bm.faces.new((a[k], a[l], b[l], b[k]))
            f.smooth = True
    return new_object("CardBezel", bm, [mat])


def banner(mat_band, mat_tail, y0=-0.175, height=0.092, z0=T / 2 + 0.0009):
    """
    Ribbon band across the card, gently arched (centre higher) and bulging toward the viewer,
    overhanging both card edges; tails fold back behind the edges with a V-notch.
    """
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    span = W + 0.07
    cols = 40
    arch = 0.016
    bulge = 0.006

    def band_point(u, v):
        x = (u - 0.5) * span
        s = (u - 0.5) * 2
        y = y0 + arch * (1 - s * s) + (v - 0.5) * height
        z = z0 + bulge * (1 - s * s) + 0.0015
        return (x, y, z)

    grid = [[bm.verts.new(band_point(c / cols, r)) for r in (0, 1)] for c in range(cols + 1)]
    for c in range(cols):
        f = bm.faces.new((grid[c][0], grid[c + 1][0], grid[c + 1][1], grid[c][1]))
        f.material_index = 0
        f.smooth = True
        for loop, (uu, vv) in zip(f.loops, ((c / cols, 0), ((c + 1) / cols, 0), ((c + 1) / cols, 1), (c / cols, 1))):
            loop[uv].uv = (uu, vv)
    # Tails: from under each band end, back (-z) and outward/down, ending in a V notch.
    for side in (-1, 1):
        ex = side * span / 2
        ey = y0 + (0 if True else 0)
        h = height * 0.9
        inner = side * (span / 2 - 0.035)
        outer = side * (span / 2 + 0.05)
        zb = z0 - 0.0008
        p = [
            (inner, ey - h / 2 - 0.022, zb), (outer, ey - h / 2 - 0.03, zb - 0.004),
            (outer - side * 0.022, ey - 0.026, zb - 0.005), (outer, ey + h / 2 - 0.03, zb - 0.004),
            (inner, ey + h / 2 - 0.022, zb),
        ]
        vs = [bm.verts.new(q) for q in p]
        f = bm.faces.new(vs if side > 0 else list(reversed(vs)))
        f.material_index = 1
        # Fold: small dark triangle linking the band end to the tail.
        fold = [bm.verts.new((ex - side * 0.0, ey - h / 2 - 0.004, z0 + 0.0015)), bm.verts.new((inner, ey - h / 2 - 0.022, zb)), bm.verts.new((ex - side * 0.035, ey - h / 2 + 0.002, z0 + 0.0012))]
        f2 = bm.faces.new(fold if side > 0 else list(reversed(fold)))
        f2.material_index = 1
    return new_object("CardBanner", bm, [mat_band, mat_tail])


def build():
    reset()
    front = material("CardFront", 0xffffff, 0.45, image=ART if ART and os.path.exists(ART) else None)
    back = material("CardBack", 0x2a1f18, 0.5)
    edge = material("CardEdge", 0xd9c9a3, 0.7)
    gold = material("CardGold", 0xe0b452, 0.28, 1.0)
    jewel_m = material("CardJewel", 0x3fd0ff, 0.05, 0.2, emit=0.6)
    band = material("CardBanner", 0xa3161c, 0.45)
    tail = material("CardTail", 0x6a0c10, 0.5)

    objs = [card_body([front, back, edge])]
    objs.append(frame(gold, 0.012, 0.022, 0.0011, T / 2))
    objs.append(frame(gold, 0.026, 0.029, 0.0006, T / 2))
    for sx in (-1, 1):
        for sy in (-1, 1):
            objs.append(diamond("CardCorner", gold, sx * (W / 2 - 0.042), sy * (H / 2 - 0.042), T / 2, 0.012, 0.0022))
    objs.append(bezel(gold, 0, H / 2 - 0.017, T / 2, 0.018))
    objs.append(jewel(jewel_m, 0, H / 2 - 0.017, T / 2 + 0.0004, 0.017))
    objs.append(banner(band, tail))

    # Join everything except the body into the card (keeps materials as separate primitives).
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    card = bpy.context.active_object
    card.name = "Card"
    card.data.name = "Card"

    if ART:
        return card  # preview only: the game composes the front texture itself
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "card.glb"), export_format="GLB", export_yup=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "card.blend"))
    return card


def render(card):
    if not RENDER_DIR:
        return
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 1000
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = os.path.abspath(os.path.join(RENDER_DIR, "card_blender.png"))
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.08, 0.09, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    for name, rot, e in (("Key", (0.6, -0.5, 0.4), 3.5), ("Rim", (-0.9, 0.6, 2.6), 2.0)):
        L = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        L.data.energy = e
        L.rotation_euler = rot
        sc.collection.objects.link(L)
    card.rotation_euler = (0.25, -0.45, 0.06)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 85
    cam.location = (0, 0, 2.4)
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.ops.render.render(write_still=True)


card = build()
render(card)
print("built card")
