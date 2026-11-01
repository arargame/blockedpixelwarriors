"""
CRT comm device for stage 2 (Blender 4.2+/5.x), rebuilt from Blocked Pixel Panzer's CRT supply
turntable (crt_rotation_atlas_4x4_1024.png / Content/Supplies/CrtSupplyTexture.png, the Meshy
"CRT" radio):

  * olive, worn, rugged box (roughly as deep as it is wide) on a dark chassis with vents;
  * front: a khaki bezel plate leaning back a little, four corner screws, a dark rubber rim and a
    BULGING tube screen (convex glass) with scanlines and a glowing pixel "CRT";
  * under the screen: green LED, two dark knobs, orange / black hazard stripes;
  * sides: two orange slit lamps over a vented service panel, a dark connector box low at the front;
  * back: flat panel between two corner bumpers;
  * top: carry handle at the front left, a bolted bracket, a radar dish on a swivel with a thin
    red-tipped antenna;
  * red / blue / orange cables looping off the left side.

    python tools/blender/build_crt.py [--render out.png] [--views dir]

Output: assets/models/crt.glb (+ crt.blend, textures packed), root "CrtRadio", screen facing +Z
in three.js, origin at the bottom centre, ~1.15 units tall with the antenna. The textures (worn
olive paint, screen, hazard stripes) are painted here with numpy / PIL.
"""
import bpy
import bmesh
import math
import os
import sys
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER = argv[argv.index("--render") + 1] if "--render" in argv else None
VIEWS = argv[argv.index("--views") + 1] if "--views" in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "models")
TEX = os.path.join(HERE, "..", "..", "assets", "textures", "crt")
PI = math.pi


def B(p):
    """three.js (x, y up, z toward viewer) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


# ---------------------------------------------------------------- textures (numpy + PIL)

def noise(n, octaves, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp = 1.0
    for o in range(octaves):
        s = 4 * 2 ** o
        g = rng.random((s + 1, s + 1))
        # bilinear upsample (tileable enough for box mapping)
        xs = np.linspace(0, s, n, endpoint=False)
        x0 = xs.astype(int)
        fx = xs - x0
        a = g[x0][:, x0]
        b = g[x0][:, x0 + 1]
        c = g[x0 + 1][:, x0]
        d = g[x0 + 1][:, x0 + 1]
        fy = fx[:, None]
        fxx = fx[None, :]
        fy = fy * fy * (3 - 2 * fy)
        fxx = fxx * fxx * (3 - 2 * fxx)
        out += amp * ((a * (1 - fxx) + b * fxx) * (1 - fy) + (c * (1 - fxx) + d * fxx) * fy)
        amp *= 0.5
    out -= out.min()
    return out / out.max()


def paint_olive(path, base, seed, light=False):
    """Worn olive paint: mottled tone, dark grime blotches, small rust / chip specks, scratches."""
    from PIL import Image, ImageDraw
    n = 512
    rng = np.random.default_rng(seed)
    tone = noise(n, 6, seed)
    grime = noise(n, 4, seed + 1)
    col = np.array(base, dtype=float)[None, None, :] * (0.82 + 0.3 * tone[..., None])
    dark = np.clip((grime - 0.62) * 3.0, 0, 1)[..., None]
    col = col * (1 - 0.45 * dark) + np.array([52, 40, 24])[None, None, :] * 0.45 * dark
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for _ in range(160):
        x, y = rng.integers(0, n, 2)
        r = rng.integers(1, 4)
        c = (90, 58, 30) if rng.random() < 0.5 else ((150, 150, 110) if light else (40, 38, 24))
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)
    for _ in range(40):
        x, y = rng.integers(0, n, 2)
        L = rng.integers(8, 40)
        a = rng.random() * PI
        d.line((x, y, x + math.cos(a) * L, y + math.sin(a) * L), fill=(150, 148, 112) if light else (122, 120, 86), width=1)
    img.save(path)


PIX = {
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
}


def paint_screen(path):
    """Dark green tube face: vignette, scanlines, a soft reflection and a glowing pixel "CRT"."""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = 512, 352
    yy, xx = np.mgrid[0:h, 0:w]
    u = (xx / w - 0.5) * 2
    v = (yy / h - 0.5) * 2
    vig = np.clip(1 - 0.55 * (u ** 2 + v ** 2), 0, 1)
    base = np.stack([6 + 14 * vig, 26 + 40 * vig, 14 + 18 * vig], -1)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    # Pixel text with a glow underneath.
    text = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(text)
    px = 23
    gap = px * 1.4
    total = 3 * 5 * px + 2 * gap
    x0 = (w - total) / 2
    y0 = (h - 7 * px) / 2
    for k, ch in enumerate("CRT"):
        for r, row in enumerate(PIX[ch]):
            for c, on in enumerate(row):
                if on == "#":
                    x = x0 + k * (5 * px + gap) + c * px
                    y = y0 + r * px
                    d.rectangle((x + 1, y + 1, x + px - 1, y + px - 1), fill=255)
    glow = text.filter(ImageFilter.GaussianBlur(16))
    arr = np.asarray(img).astype(float)
    g = np.asarray(glow).astype(float)[..., None] / 255
    t = np.asarray(text).astype(float)[..., None] / 255
    arr = arr + g * np.array([30, 140, 50]) * 1.3
    arr = arr * (1 - t) + t * np.array([150, 255, 140])
    # Scanlines + faint reflection streak at the top left.
    arr *= (0.62 + 0.38 * (np.sin(yy * PI / 4.0) ** 2))[..., None]
    refl = np.clip(1 - np.abs((u + v * 0.6) + 0.95) * 4, 0, 1) * (v < -0.2)
    arr += refl[..., None] * 30
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path)


def paint_hazard(path):
    from PIL import Image, ImageDraw
    w, h = 256, 64
    img = Image.new("RGB", (w, h), (24, 22, 18))
    d = ImageDraw.Draw(img)
    for i in range(-1, 6):
        x = i * 52 + 18
        d.polygon([(x, h), (x + 24, h), (x + 24 + 30, 0), (x + 30, 0)], fill=(240, 160, 30))
    img.save(path)


# ---------------------------------------------------------------- materials

MATS = {}


def mat(name, hexv=0xFFFFFF, rough=0.6, metal=0.0, emit=0.0, tex=None, emit_tex=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        im = bpy.data.images.load(os.path.abspath(tex))
        im.pack()
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = im
        tn.interpolation = "Linear"
        nt.links.new(tn.outputs["Color"], b.inputs["Base Color"])
        if emit_tex:
            nt.links.new(tn.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = emit or 1.0
    elif emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


# ---------------------------------------------------------------- geometry helpers

PARTS = []


def link(o, m, bevel=0.0, seg=2, smooth=False):
    o.data.materials.append(MATS[m])
    if bevel:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = "ANGLE"
        mod.harden_normals = False
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    PARTS.append(o)
    return o


def box_uv(o, scale=1.0):
    """Planar UVs per face along its dominant axis (box mapping)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new()
    uv = me.uv_layers.active.data
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = o.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            a, b = [(1, 2), (0, 2), (0, 1)][ax]
            uv[li].uv = (co[a] * scale, co[b] * scale)


def box(c, s, m, bevel=0.02, rot=None, seg=2, uv=1.2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(c))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    if rot:
        o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    box_uv(o, uv)
    return link(o, m, bevel, seg)


def cyl(c, r, depth, m, axis="y", verts=16, bevel=0.0, r2=None, smooth=True):
    rot = {"y": (0, 0, 0), "x": (0, PI / 2, 0), "z": (PI / 2, 0, 0)}[axis]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=B(c), rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=B(c), rotation=rot)
    o = bpy.context.active_object
    box_uv(o, 1.2)
    o = link(o, m, bevel)
    if smooth:
        for p in o.data.polygons:
            if abs(p.normal.dot(o.matrix_world.to_3x3() @ Vector((0, 0, 1)))) < 0.9:
                p.use_smooth = True
    return o


def sphere(c, r, m, seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=B(c))
    return link(bpy.context.active_object, m, smooth=True)


def tube(points, r, m, res=10):
    """Smooth cable through three.js points (poly curve with Catmull-Rom style smoothing)."""
    cu = bpy.data.curves.new("Cable", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new("NURBS")
    sp.points.add(len(points) - 1)
    for p, q in zip(sp.points, points):
        v = B(q)
        p.co = (v.x, v.y, v.z, 1)
    sp.order_u = 4
    sp.use_endpoint_u = True
    sp.resolution_u = res
    o = bpy.data.objects.new("Cable", cu)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    return link(o, m, smooth=True)


def rounded_rect_grid(w, h, r, nx, ny, bulge, depth_back=0.0):
    """Grid plane (UV 0..1) bent into a rounded rectangle and bulged out along +Z (three.js)."""
    bm = bmesh.new()
    verts = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x, y = (u - 0.5) * w, (v - 0.5) * h
            # Corner points outside the corner arcs are pulled onto them.
            cx = abs(x) - (w / 2 - r)
            cy = abs(y) - (h / 2 - r)
            if cx > 0 and cy > 0 and math.hypot(cx, cy) > r:
                k = r / math.hypot(cx, cy)
                x = math.copysign(w / 2 - r + cx * k, x)
                y = math.copysign(h / 2 - r + cy * k, y)
            z = bulge * (1 - (2 * x / w) ** 2) * (1 - (2 * y / h) ** 2)
            row.append(bm.verts.new(B((x, y, z))))
        verts.append(row)
    uvl = bm.loops.layers.uv.new("UVMap")
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            for loop, (uu, vv) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uvl].uv = (uu / nx, vv / ny)
    me = bpy.data.meshes.new("Glass")
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("Glass", me)
    bpy.context.scene.collection.objects.link(o)
    return o


def prism_x(profile, width, m, bevel=0.0, seg=2, uv=1.2):
    """Prism along three.js X through a (z, y) side profile (counter-clockwise seen from +x)."""
    bm = bmesh.new()
    left = [bm.verts.new(B((-width / 2, y, z))) for z, y in profile]
    right = [bm.verts.new(B((width / 2, y, z))) for z, y in profile]
    bm.faces.new(right)
    bm.faces.new(left[::-1])
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("Prism")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("Prism", me)
    bpy.context.scene.collection.objects.link(o)
    box_uv(o, uv)
    return link(o, m, bevel, seg)


def boolean_cut(target, cutter):
    mod = target.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# ---------------------------------------------------------------- the radio

def build():
    os.makedirs(TEX, exist_ok=True)
    olive_p = os.path.join(TEX, "crt_olive.png")
    khaki_p = os.path.join(TEX, "crt_khaki.png")
    screen_p = os.path.join(TEX, "crt_screen.png")
    hazard_p = os.path.join(TEX, "crt_hazard.png")
    paint_olive(olive_p, (112, 112, 60), 11)
    paint_olive(khaki_p, (128, 126, 74), 23, light=True)
    paint_screen(screen_p)
    paint_hazard(hazard_p)
    mat("CrtOlive", rough=0.72, tex=olive_p)
    mat("CrtKhaki", rough=0.62, metal=0.15, tex=khaki_p)
    mat("CrtScreen", rough=0.08, tex=screen_p, emit=1.1, emit_tex=True)
    mat("CrtHazard", rough=0.55, tex=hazard_p)
    mat("CrtDark", 0x23221D, 0.55, 0.3)
    mat("CrtRubber", 0x121410, 0.4)
    mat("CrtSteel", 0x6E6A5E, 0.35, 0.8)
    mat("CrtDish", 0x4B3F33, 0.45, 0.65)
    mat("CrtLed", 0x48FF5A, 0.2, emit=5.0)
    mat("CrtAmber", 0xFF9A2A, 0.3, emit=4.0)
    mat("CrtRedBall", 0xF0262A, 0.25, emit=0.8)
    mat("CrtRed", 0xD8262A, 0.35)
    mat("CrtBlue", 0x2C5EC0, 0.4)
    mat("CrtOrange", 0xF2A030, 0.4)

    W, H, D = 1.0, 0.84, 0.72     # body
    y0 = 0.09                     # top of the chassis
    top = y0 + H
    zf = D / 2                    # front face of the body

    # Chassis: dark base with vent slots and two amber running lights at the front corners.
    box((0, y0 / 2, 0), (W - 0.04, y0, D - 0.04), "CrtDark", 0.02)
    for x in (-0.36, 0.36):
        for z in (-0.3, 0.3):
            box((x, 0.015, z), (0.16, 0.03, 0.14), "CrtRubber", 0.01)
    for i in range(6):
        box((-0.2 + i * 0.08, y0 / 2, zf - 0.015), (0.045, 0.035, 0.02), "CrtRubber", 0.004)
    for x in (-0.4, 0.4):
        box((x, y0 / 2, zf - 0.012), (0.07, 0.025, 0.02), "CrtAmber", 0.004)

    # Body (worn olive): side profile slanted at the front like the bezel, back corner bumpers.
    lean = math.radians(13)
    slant = H * math.tan(lean)
    prism_x([(-D / 2, y0), (zf - 0.02, y0), (zf - 0.02 - slant, top), (-D / 2, top)], W, "CrtOlive", 0.05, seg=3)
    for x in (-1, 1):
        box((x * (W / 2 + 0.005), y0 + H / 2, -D / 2 + 0.07), (0.07, H + 0.02, 0.14), "CrtOlive", 0.025)
    # Back panel: a raised plate with a cable trough.
    box((0, y0 + H / 2, -D / 2 - 0.0), (W - 0.2, H - 0.12, 0.03), "CrtOlive", 0.012)
    zb = -D / 2 - 0.016
    tube([(-0.36, y0 + 0.5, zb), (-0.2, y0 + 0.5, zb), (-0.13, y0 + 0.38, zb), (0.13, y0 + 0.38, zb), (0.2, y0 + 0.5, zb), (0.36, y0 + 0.5, zb)], 0.007, "CrtDark", 4)

    # Front bezel: khaki plate leaning back ~13 degrees, rounded-rect window for the tube.
    piv = Vector((0, y0, zf))  # three.js pivot at the bottom front edge

    def front(p):
        """Front-panel space (x, y up the panel, z out of it) -> three.js, leaning back."""
        x, y, z = p
        return (x, piv.y + y * math.cos(lean) + z * math.sin(lean), piv.z - y * math.sin(lean) + z * math.cos(lean))

    rotf = Matrix.Rotation(-lean, 4, "X")  # Blender X rotation tipping the top back (three.js -z)
    sh = H + 0.02
    bez = box(front((0, sh / 2, 0.03)), (W + 0.04, sh, 0.07), "CrtKhaki", 0.0, rot=(-lean, 0, 0))
    win_w, win_h, win_r, win_y = 0.8, 0.56, 0.1, 0.55
    # Window cutter: rounded box.
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(front((0, win_y, 0.03))))
    cut = bpy.context.active_object
    cut.scale = (win_w, 0.3, win_h)
    cut.rotation_euler = (-lean, 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(cut.data)
    # Round only the edges that run through the panel (front-to-back).
    ax = (rotf.to_3x3() @ Vector((0, 1, 0))).normalized()
    edges = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().dot(ax)) > 0.9]
    bmesh.ops.bevel(bm, geom=edges, offset=win_r, segments=8, affect="EDGES", profile=0.5)
    bm.to_mesh(cut.data)
    bm.free()
    boolean_cut(bez, cut)
    box_uv(bez, 1.2)
    mod = bez.modifiers.new("Bevel", "BEVEL")
    mod.width = 0.018
    mod.segments = 2
    mod.limit_method = "ANGLE"
    # Corner screws.
    for sx in (-1, 1):
        for sy in (0.08, sh - 0.06):
            cyl(front((sx * (W / 2 - 0.05), sy, 0.07)), 0.022, 0.02, "CrtSteel", axis="z", verts=10)
    # Dark rubber rim recessed in the window, then the bulging tube.
    rim = box(front((0, win_y, 0.0)), (win_w + 0.01, win_h + 0.01, 0.08), "CrtRubber", 0.0, rot=(-lean, 0, 0))
    bmr = bmesh.new()
    bmr.from_mesh(rim.data)
    edges = [e for e in bmr.edges if abs((e.verts[0].co - e.verts[1].co).normalized().dot(ax)) > 0.9]
    bmesh.ops.bevel(bmr, geom=edges, offset=win_r, segments=8, affect="EDGES", profile=0.5)
    bmr.to_mesh(rim.data)
    bmr.free()
    glass = rounded_rect_grid(win_w - 0.1, win_h - 0.1, win_r - 0.035, 32, 22, 0.06)
    glass.matrix_world = Matrix.Translation(B(front((0, win_y, 0.04)))) @ rotf
    link(glass, "CrtScreen", smooth=True)

    # Controls under the window: LED, two knobs, hazard plate.
    cy = 0.13
    sphere(front((-0.38, cy, 0.075)), 0.05, "CrtLed", 16)
    box(front((-0.38, cy, 0.064)), (0.11, 0.11, 0.012), "CrtRubber", 0.02, rot=(-lean, 0, 0))
    for x in (-0.26, -0.17):
        cyl(front((x, cy, 0.075)), 0.03, 0.03, "CrtRubber", axis="z", verts=14)
        cyl(front((x, cy, 0.092)), 0.016, 0.01, "CrtSteel", axis="z", verts=10)
    hz = box(front((0.24, cy - 0.005, 0.068)), (0.4, 0.105, 0.012), "CrtHazard", 0.004, rot=(-lean, 0, 0))
    # UVs straight across the plate.
    me = hz.data
    uv = me.uv_layers.active.data
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = ((co.x - 0.04) / 0.4, (co.z - B(front((0, cy, 0))).z) / 0.105 + 0.5)

    # Sides: two amber slit lamps over a vented panel, a connector box low at the front.
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.012)
        box((x, top - 0.2, zf - 0.36), (0.03, 0.18, 0.15), "CrtDark", 0.01)
        for k in range(2):
            box((x + sx * 0.006, top - 0.16 - k * 0.075, zf - 0.36), (0.03, 0.035, 0.1), "CrtAmber", 0.006)
        box((x, y0 + 0.3, zf - 0.36), (0.035, 0.24, 0.2), "CrtKhaki", 0.015)
        for k in range(5):
            box((x + sx * 0.012, y0 + 0.21 + k * 0.045, zf - 0.36), (0.02, 0.018, 0.15), "CrtRubber", 0.004)
        box((x, y0 + 0.08, zf - 0.08), (0.045, 0.11, 0.13), "CrtDark", 0.012)

    # Top: handle (front left), bolted bracket, dish on a swivel.
    hz0 = zf - 0.29
    tube([(-0.42, top - 0.01, hz0), (-0.42, top + 0.09, hz0), (-0.36, top + 0.105, hz0), (-0.16, top + 0.105, hz0), (-0.1, top + 0.09, hz0), (-0.1, top - 0.01, hz0)], 0.024, "CrtOlive", 6)
    for x in (-0.42, -0.1):
        box((x, top + 0.01, hz0), (0.07, 0.03, 0.07), "CrtDark", 0.008)
    box((0.1, top + 0.035, zf - 0.3), (0.22, 0.07, 0.1), "CrtDark", 0.012)
    for x in (0.05, 0.19):
        cyl((x - 0.02, top + 0.072, zf - 0.3), 0.015, 0.012, "CrtSteel", verts=8)
    dx, dz = 0.22, -0.14
    cyl((dx, top + 0.06, dz), 0.05, 0.12, "CrtDark", verts=14)
    box((dx, top + 0.13, dz), (0.07, 0.07, 0.09), "CrtSteel", 0.012)
    # Dish: half sphere opening toward up / front / left.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=14, radius=0.19)
    d = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(d.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.01], context="VERTS")
    for v in bm.verts:
        v.co.z *= 0.55
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    bm.to_mesh(d.data)
    bm.free()
    normal = Vector((-0.35, 0.8, 0.45)).normalized()          # three.js direction the dish faces
    nb = B(normal)
    d.rotation_euler = Vector((0, 0, 1)).rotation_difference(nb).to_euler()
    centre = Vector((dx, top + 0.23, dz))
    d.location = B(centre)
    bpy.context.view_layer.objects.active = d
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    link(d, "CrtDish", smooth=True)
    tip = centre + Vector((0.13, 0.22, 0.02))
    a = centre - normal * 0.02
    tube([tuple(a), tuple(a.lerp(tip, 0.5)), tuple(tip)], 0.008, "CrtSteel", 2)
    sphere(tuple(tip), 0.04, "CrtRedBall", 16)

    # Cables looping off the left side (red over orange, blue hanging lowest).
    lx = -W / 2 - 0.02
    box((lx - 0.01, y0 + 0.5, zf - 0.32), (0.05, 0.2, 0.12), "CrtDark", 0.012)
    tube([(lx, y0 + 0.56, zf - 0.32), (lx - 0.16, y0 + 0.62, zf - 0.36), (lx - 0.2, y0 + 0.46, zf - 0.08), (lx - 0.06, y0 + 0.36, zf - 0.04), (lx + 0.01, y0 + 0.4, zf - 0.12)], 0.024, "CrtRed")
    tube([(lx, y0 + 0.47, zf - 0.34), (lx - 0.13, y0 + 0.4, zf - 0.3), (lx - 0.16, y0 + 0.18, zf - 0.16), (lx - 0.1, y0 + 0.04, zf - 0.04), (lx - 0.02, y0 + 0.12, zf - 0.05), (lx + 0.01, y0 + 0.2, zf - 0.08)], 0.024, "CrtBlue")
    tube([(lx, y0 + 0.43, zf - 0.28), (lx - 0.1, y0 + 0.4, zf - 0.14), (lx - 0.12, y0 + 0.26, zf - 0.02), (lx - 0.03, y0 + 0.2, zf + 0.0), (lx + 0.01, y0 + 0.27, zf - 0.06)], 0.022, "CrtOrange")

    for o in PARTS:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = "CrtRadio"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def setup_render(res=(800, 700)):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.render.resolution_x, sc.render.resolution_y = res
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.05, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.4
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.75, 0.25, -0.6)
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "SUN"))
    fill.data.energy = 1.0
    fill.rotation_euler = (1.2, -0.3, 2.4)
    sc.collection.objects.link(fill)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 60
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def aim(cam, az_deg, el_deg, dist=3.6, target=(0, 0.55, 0)):
    """Camera round the radio: az 0 = straight at the screen (three.js +Z), positive = to its right."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    t = B(target)
    p = Vector((math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)))
    cam.location = t + B(p) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "crt.glb")), export_format="GLB", export_apply=True, export_yup=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "crt.blend")))
    if RENDER or VIEWS:
        sc, cam = setup_render()
        if RENDER:
            aim(cam, -14, 12)
            sc.render.filepath = os.path.abspath(RENDER)
            bpy.ops.render.render(write_still=True)
        if VIEWS:
            # Same turntable as the atlas: 16 steps, the first a little to the screen's right.
            sc.render.resolution_x = sc.render.resolution_y = 384
            sc.cycles.samples = 24
            for i in range(16):
                aim(cam, -10 + i * 22.5, 12)
                sc.render.filepath = os.path.abspath(os.path.join(VIEWS, f"v{i:02d}.png"))
                bpy.ops.render.render(write_still=True)
    print("crt done")


main()
