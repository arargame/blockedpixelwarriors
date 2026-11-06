"""
Shared Blender helpers for the newer model scripts (night city kit, colour wheel, gem).

Geometry is written in three.js coordinates (x right, y up, z toward the viewer of a front
elevation) and converted to Blender's z-up axes on the way in (tb), so the glTF export (+Y up)
hands three.js back exactly the numbers in the script.

    import bkit
    bkit.reset()
    bkit.mat("Steel", 0x3a3e44, rough=0.4, metal=0.9)
    o = bkit.box("Post", (0, 1, 0), (0.2, 2, 0.2), "Steel", bevel=0.02)
    root = bkit.group("Lamp", [o])
    bkit.export([root], "assets/models/x.glb")
"""
import bpy
import bmesh
import math
import os
import tempfile
from mathutils import Vector, Matrix

import numpy as np
from PIL import Image

T2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
TMP = tempfile.mkdtemp()
MATS = {}
FONT_PATHS = (
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)


def reset():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def tb(p):
    """three.js point -> Blender point."""
    return (T2B @ Vector(p).to_4d()).to_3d()


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


# ---------------------------------------------------------------------------------------------
# Materials and textures
# ---------------------------------------------------------------------------------------------
def image(name, rgb):
    """numpy float image (h, w, 3|4) in 0..1 -> packed Blender image."""
    arr = np.clip(rgb, 0, 1)
    mode = "RGBA" if arr.shape[2] == 4 else "RGB"
    path = os.path.join(TMP, f"{name}.png")
    Image.fromarray((arr * 255).astype(np.uint8), mode).save(path)
    im = bpy.data.images.load(path)
    im.name = name
    im.pack()
    return im


def height_to_normal(h, strength=1.0):
    """Height field (rows top->bottom = v 1->0, cols = u 0->1) -> tangent-space normal map
    (OpenGL / glTF convention, +v = green)."""
    h = np.asarray(h, np.float32)
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dv = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-du, -dv, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def data_image(name, rgb):
    """Like image(), tagged Non-Color (normal / roughness-metal maps)."""
    im = image(name, rgb)
    im.colorspace_settings.name = "Non-Color"
    return im


def mat(name, hexv=0xffffff, rough=0.55, metal=0.0, emit=0.0, image=None, emit_hex=None, normal=None, alpha=None,
        rough_metal=None, coat=None, transmission=None, ior=None, normal_strength=1.0, spec=None):
    """Principled material; `image` drives the base colour, `emit` > 0 makes it glow (emit_hex or
    the base colour), `normal` is a normal-map image, `rough_metal` a glTF metallicRoughness image
    (G = roughness, B = metallic), coat = (weight, roughness) clearcoat, transmission = 0..1
    (water / glass, with ior)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if rough_metal is not None:
        rt = nt.nodes.new("ShaderNodeTexImage")
        rt.image = rough_metal
        rough_metal.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(rt.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    if coat is not None:
        b.inputs["Coat Weight"].default_value = coat[0]
        b.inputs["Coat Roughness"].default_value = coat[1]
    if transmission is not None:
        b.inputs["Transmission Weight"].default_value = transmission
    if ior is not None:
        b.inputs["IOR"].default_value = ior
    if spec is not None:
        b.inputs["Specular IOR Level"].default_value = spec
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if image.name.endswith("_a"):
            nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    else:
        b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if normal is not None:
        nt_ = nt.nodes.new("ShaderNodeTexImage")
        nt_.image = normal
        normal.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(nt_.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit:
        if image is not None and emit_hex is None:
            # Glowing picture (lit windows): the image is the emission colour too.
            nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        else:
            b.inputs["Emission Color"].default_value = srgb(emit_hex if emit_hex is not None else hexv)
        b.inputs["Emission Strength"].default_value = emit
    if alpha is not None:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    MATS[name] = m
    return m


# ---------------------------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------------------------
def new_obj(name, me, material):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material:
        o.data.materials.append(MATS[material])
    return o


def mesh(name, verts, faces, material, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tb(v) for v in verts], [], faces)
    me.validate()
    o = new_obj(name, me, material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def box(name, c, s, material, bevel=0.0, segs=2, uv=None, swap_top=False):
    """Axis box centred at c with size s (three.js axes); optional bevel and box-projected UVs
    (`uv` = texture repeats per unit)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = tb((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me, material)
    if uv:
        uv_box(o, uv, swap_top)
    if bevel:
        m = o.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = segs
        m.limit_method = "ANGLE"
    return o


def cylinder(name, a, b, r, material, sides=16, r2=None, caps=True, smooth=True):
    """Tube from a to b (three.js points), radius r (r2 at b: a cone / taper)."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    L = axis.length
    axis.normalize()
    up = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(up).normalized()
    w = axis.cross(u).normalized()
    r2 = r if r2 is None else r2
    verts = []
    for t, rr in ((0, r), (1, r2)):
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            verts.append(a + axis * (L * t) + (u * math.cos(ang) + w * math.sin(ang)) * rr)
    faces = []
    if caps:
        faces += [tuple(range(sides - 1, -1, -1)), tuple(range(sides, 2 * sides))]
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    o = mesh(name, verts, faces, material)
    for p in o.data.polygons:
        p.use_smooth = smooth and len(p.vertices) == 4
    return o


def lathe(name, profile, material, sides=24, y0=0.0, centre=(0, 0, 0), smooth=True, caps=(True, True)):
    """Surface of revolution about the vertical axis: profile = [(radius, y), ...] bottom to top;
    caps = (first ring, last ring) closed with a disc (open shells: lamp shade, mug)."""
    verts = []
    for r, y in profile:
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            verts.append((centre[0] + math.cos(ang) * r, centre[1] + y + y0, centre[2] + math.sin(ang) * r))
    faces = []
    n = len(profile)
    for k in range(n - 1):
        for i in range(sides):
            j = (i + 1) % sides
            a, b = k * sides, (k + 1) * sides
            faces.append((a + i, b + i, b + j, a + j))
    if caps[0] and profile[0][0] > 1e-4:
        faces.append(tuple(range(sides)))
    if caps[1] and profile[-1][0] > 1e-4:
        faces.append(tuple(range((n - 1) * sides + sides - 1, (n - 1) * sides - 1, -1)))
    o = mesh(name, verts, faces, material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def vertex_uvs(o, uvs):
    """Per-vertex UVs (list indexed like the mesh's vertices) written to every face corner."""
    me = o.data
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            layer.data[li].uv = uvs[me.loops[li].vertex_index]
    return o


def lathe_uv(name, profile, material, sides=32, centre=(0, 0, 0), smooth=True, u0=0.0, cap_top=False, cap_bottom=False):
    """Lathe with texture coordinates: u runs round the axis (u = 0.5 faces three.js -z, the
    camera), v runs up the profile by arc length. The seam column is duplicated."""
    verts, uvs = [], []
    lens = [0.0]
    for k in range(1, len(profile)):
        lens.append(lens[-1] + math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
    total = lens[-1] or 1.0
    for k, (r, y) in enumerate(profile):
        for i in range(sides + 1):
            u = i / sides
            # u = 0.5 at angle pointing to -z.
            ang = 2 * math.pi * (u - 0.5 + u0) - math.pi / 2
            verts.append((centre[0] + math.cos(ang) * r, centre[1] + y, centre[2] + math.sin(ang) * r))
            uvs.append((u, lens[k] / total))
    faces = []
    n = len(profile)
    W = sides + 1
    for k in range(n - 1):
        for i in range(sides):
            a, b = k * W, (k + 1) * W
            faces.append((a + i, b + i, b + i + 1, a + i + 1))
    if cap_bottom:
        c = len(verts)
        verts.append((centre[0], centre[1] + profile[0][1], centre[2]))
        uvs.append((0.5, 0.0))
        for i in range(sides):
            faces.append((c, i + 1, i))
    if cap_top:
        c = len(verts)
        verts.append((centre[0], centre[1] + profile[-1][1], centre[2]))
        uvs.append((0.5, 1.0))
        base = (n - 1) * W
        for i in range(sides):
            faces.append((c, base + i, base + i + 1))
    o = mesh(name, verts, faces, material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    vertex_uvs(o, uvs)
    return o


def tube_path(name, pts, r, material, ring=10, smooth=True):
    """Tube along a polyline of three.js points."""
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    prev_n = None
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
        n1 = t.cross(ref).normalized() if prev_n is None else (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n1
        n2 = t.cross(n1).normalized()
        for i in range(ring):
            ang = 2 * math.pi * i / ring
            verts.append(p + (n1 * math.cos(ang) + n2 * math.sin(ang)) * r)
    for k in range(len(pts) - 1):
        for i in range(ring):
            j = (i + 1) % ring
            a, b = k * ring, (k + 1) * ring
            faces.append((a + i, a + j, b + j, b + i))
    return mesh(name, verts, faces, material, smooth)


def text(name, body, size, material, extrude=0.02, bevel=0.004, align="CENTER"):
    """3D text standing upright facing -z (three.js), centred on the origin."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.align_x = align
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = extrude
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    for path in FONT_PATHS:
        if os.path.exists(path):
            curve.font = bpy.data.fonts.load(path, check_existing=True)
            break
    o = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    # Text lies in Blender's XY plane facing up; stand it up facing three.js -z (the game camera),
    # reading left to right on screen (screen right = three.js -x): (x, y, z) -> (-x, z, y).
    for v in o.data.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Vector((-x, z, y))
    o.data.materials.clear()
    o.data.materials.append(MATS[material])
    return o


def uv_box(o, scale=1.0, swap_top=False):
    """Box-projected UVs; swap_top turns the map on the top / bottom faces by 90 degrees (wood grain
    along a beam that runs along three.js z)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = lp.vert.co
            a, c = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            if swap_top and ax == 2:
                a, c = c, a
            lp[uv].uv = (a * scale, c * scale)
    bm.to_mesh(o.data)
    bm.free()


def move(o, offset):
    """Translate an object's mesh data by a three.js offset."""
    d = tb(offset)
    for v in o.data.vertices:
        v.co += d
    return o


def rotate_y(o, ang, pivot=(0, 0, 0)):
    """Rotate mesh data about the three.js y axis (Blender z) through pivot."""
    pv = tb(pivot)
    R = Matrix.Rotation(ang, 4, "Z")
    for v in o.data.vertices:
        v.co = (R @ (v.co - pv).to_4d()).to_3d() + pv
    return o


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    for o in objs:
        apply_mods(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


def group(name, children):
    """Empty parent at the origin (a three.js Object3D in the glTF) holding `children`."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    for c in children:
        c.parent = e
    return e


def empty(name, p, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = tb(p)
    if parent is not None:
        e.parent = parent
    return e


def export(roots, path, image_format="AUTO"):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for r in roots:
        r.select_set(True)
        for c in r.children_recursive:
            c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format="GLB", export_yup=True, use_selection=True, export_extras=True,
                              export_image_format=image_format, export_jpeg_quality=90)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path[:-4] + ".blend"))


def preview(out_png, target=(0, 0, 0), cam=(6, 5, 8), lens=40, res=(900, 600), samples=48, night=True, lights=(), cam_quat=None, vfov=None):
    """Quick Cycles still for checking a model (three.js coordinates)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.02, 0.03, 0.06, 1) if night else (0.5, 0.55, 0.6, 1)
    bg.inputs["Strength"].default_value = 0.6 if night else 1.0
    for kind, pos, energy, colour in lights:
        L = bpy.data.lights.new("L", kind)
        L.energy = energy
        L.color = srgb(colour)[:3]
        lo = bpy.data.objects.new("L", L)
        lo.location = tb(pos)
        if kind == "SUN":
            lo.rotation_euler = (0.7, 0.2, 0.6)
        sc.collection.objects.link(lo)
    c = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    c.data.lens = lens
    sc.collection.objects.link(c)
    sc.camera = c
    c.location = tb(cam)
    if cam_quat is not None:
        # three.js camera quaternion (x, y, z, w): same local axes as a Blender camera.
        from mathutils import Quaternion
        qt = Quaternion((cam_quat[3], cam_quat[0], cam_quat[1], cam_quat[2]))
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = (T2B.to_quaternion() @ qt)
    else:
        c.rotation_euler = (tb(target) - c.location).to_track_quat("-Z", "Y").to_euler()
    if vfov:
        c.data.sensor_fit = "VERTICAL"
        c.data.angle_y = math.radians(vfov)
    sc.render.filepath = os.path.abspath(out_png)
    bpy.ops.render.render(write_still=True)


def uv_planar(o, half=1.0, plane="xz", centre=(0, 0)):
    """Planar UVs from three.js coordinates: plane 'xz' = top-down (u = x, v = z), 'xy' = front
    (u = -x so the image reads left to right on screen, v = y); square of side 2*half about centre."""
    me = o.data
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            bx, by, bz = me.vertices[me.loops[li].vertex_index].co
            x, y, z = bx, bz, -by          # Blender -> three.js
            if plane == "xz":
                u, v = (x - centre[0]) / half, (z - centre[1]) / half
            else:
                u, v = -(x - centre[0]) / half, (y - centre[1]) / half
            layer.data[li].uv = ((u + 1) / 2, (v + 1) / 2)
    return o


def drops(name, items, material, sides=8, rings=3, flat=0.6):
    """Water droplets: `items` = [(pos, normal, radius)] in three.js coordinates; each drop is a
    flattened spherical cap sitting on the surface (one mesh)."""
    verts, faces = [], []
    for pos, nrm, r in items:
        n = Vector(nrm).normalized()
        ref = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
        t1 = n.cross(ref).normalized()
        t2 = n.cross(t1).normalized()
        p0 = Vector(pos)
        base = len(verts)
        for k in range(rings):
            a = (math.pi / 2) * k / rings
            rr, hh = r * math.cos(a), r * flat * math.sin(a)
            for i in range(sides):
                ang = 2 * math.pi * i / sides
                verts.append(tuple(p0 + (t1 * math.cos(ang) + t2 * math.sin(ang)) * rr + n * hh))
        top = len(verts)
        verts.append(tuple(p0 + n * r * flat))
        for k in range(rings - 1):
            for i in range(sides):
                j = (i + 1) % sides
                a, b = base + k * sides, base + (k + 1) * sides
                faces.append((a + i, a + j, b + j, b + i))
        last = base + (rings - 1) * sides
        for i in range(sides):
            faces.append((last + i, last + (i + 1) % sides, top))
    o = mesh(name, verts, faces, material, smooth=True)
    return o
