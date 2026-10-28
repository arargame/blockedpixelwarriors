"""
Blocked Pixel Panzer - voxel attack helicopter (Blender 4.2+/5.x, run headless or in the GUI).

    python tools/blender/build_heli.py [--out assets/models] [--render out.png] [--samples 96]
        [--view keyart|side|top|front] [--campos x,y,z] [--target x,y,z] [--lens mm] [--pose rx,ry,rz]
    blender --background --python tools/blender/build_heli.py -- --render out.png
or inside Blender: Scripting tab > Open > this file > Run Script (rebuilds the model and
re-exports assets/models/helicopter.glb next to the repo).

Builds the key-art helicopter from bevelled voxel blocks, assigns named materials, adds
hardpoint empties (HP_*), saves a .blend and exports a .glb that the game loads.

Axes (Blender): +X right, +Y nose/forward, +Z up. 1 unit ~ the game's block scale / 1.5.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Euler

# ---------------------------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


OUT_DIR = arg("--out", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models"))
RENDER = arg("--render")
SAMPLES = int(arg("--samples", "96"))
VIEW = arg("--view", "keyart")

# ---------------------------------------------------------------------------------------------
# Palette (sRGB hex) - sampled from the key art
# ---------------------------------------------------------------------------------------------
PALETTE = {
    "HeliGreen": (0x5C9C2C, 0.62, 0.0),
    "HeliGreenDark": (0x3F7020, 0.65, 0.0),
    "HeliGreenLight": (0x86C247, 0.6, 0.0),
    "HeliCamo": (0x2F4F1A, 0.7, 0.0),
    "Gunmetal": (0x3A3E44, 0.45, 0.55),
    "Black": (0x1A1B1E, 0.5, 0.3),
    "Rubber": (0x161616, 0.85, 0.0),
    "Teal": (0x2FB6C8, 0.35, 0.0),
    "Glass": (0x123A48, 0.08, 0.2),
    "BladeGrey": (0x3B3E43, 0.45, 0.3),
    "BladeYellow": (0xF5C93A, 0.5, 0.0),
    "StarWhite": (0xF1EEE6, 0.6, 0.0),
    "Brass": (0xB8873A, 0.35, 0.8),
    "GlowOrange": (0xFF8A2A, 0.5, 0.0),
    "NavRed": (0xFF2A2A, 0.5, 0.0),
}
EMISSIVE = {"GlowOrange": 6.0, "NavRed": 4.0}


def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    return (srgb_to_linear((h >> 16) & 255), srgb_to_linear((h >> 8) & 255), srgb_to_linear(h & 255), 1.0)


MATS = {}


def make_materials():
    for name, (hexv, rough, metal) in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = hex_rgba(hexv)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if name in EMISSIVE:
            bsdf.inputs["Emission Color"].default_value = hex_rgba(hexv)
            bsdf.inputs["Emission Strength"].default_value = EMISSIVE[name]
        if name == "Glass":
            bsdf.inputs["Coat Weight"].default_value = 1.0
        MATS[name] = m


def enhance_materials():
    """Render-only shading (noise mottling + crevice AO). Applied after the glTF export, because
    the exporter can only read a plain Base Color value."""
    for name, m in MATS.items():
        if not name.startswith("Heli"):
            continue
        hexv = PALETTE[name][0]
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if True:
            # Painted-voxel mottling for renders (glTF keeps the flat base colour; the game adds
            # its own voxel shader on top).
            noise = nt.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 9.0
            noise.inputs["Detail"].default_value = 2.0
            ramp = nt.nodes.new("ShaderNodeMixRGB")
            ramp.blend_type = "MULTIPLY"
            ramp.inputs["Fac"].default_value = 0.22
            ramp.inputs["Color1"].default_value = hex_rgba(hexv)
            nt.links.new(noise.outputs["Fac"], ramp.inputs["Color2"])
            mix = nt.nodes.new("ShaderNodeMixRGB")
            mix.inputs["Fac"].default_value = 0.5
            mix.inputs["Color1"].default_value = hex_rgba(hexv)
            nt.links.new(ramp.outputs["Color"], mix.inputs["Color2"])
            ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
            ao.inputs["Distance"].default_value = 0.25
            dark = nt.nodes.new("ShaderNodeMixRGB")
            dark.blend_type = "MULTIPLY"
            dark.inputs["Fac"].default_value = 0.75
            nt.links.new(mix.outputs["Color"], dark.inputs["Color1"])
            nt.links.new(ao.outputs["AO"], dark.inputs["Color2"])
            nt.links.new(dark.outputs["Color"], bsdf.inputs["Base Color"])


# ---------------------------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------------------------
PARTS = {"Body": [], "Rotor": [], "TailRotor": []}


def _finish(obj, mat, group, bevel, segments):
    obj.data.materials.append(MATS[mat])
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.harden_normals = False
    for p in obj.data.polygons:
        p.use_smooth = False
    PARTS[group].append(obj)
    return obj


def box(center, size, mat="HeliGreen", rot=(0, 0, 0), bevel=0.06, segments=2, group="Body"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b = min(bevel, min(size) * 0.45)
    return _finish(o, mat, group, b, segments)


def mbox(center, size, mat="HeliGreen", **kw):
    """Box mirrored across X."""
    box(center, size, mat, **kw)
    return box((-center[0], center[1], center[2]), size, mat, **kw)


def cyl(center, radius, depth, mat="Gunmetal", rot=(0, 0, 0), verts=16, bevel=0.02, group="Body", radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=center, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=depth, location=center, rotation=rot)
    o = bpy.context.active_object
    return _finish(o, mat, group, bevel, 2)


def star(center, size, normal_axis, mat="StarWhite", depth=0.02):
    """Five-point star extruded along the given axis ('x' or 'z')."""
    bm = bmesh.new()
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        r = size if i % 2 == 0 else size * 0.4
        pts.append((math.cos(a) * r, math.sin(a) * r))
    verts = [bm.verts.new((x, y, 0)) for x, y in pts]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    me = bpy.data.meshes.new("Star")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("Star", me)
    bpy.context.collection.objects.link(o)
    o.location = center
    if normal_axis == "+x":
        o.rotation_euler = Euler((0, math.pi / 2, 0))
        o.rotation_euler.rotate_axis("X", -math.pi / 2)
    elif normal_axis == "-x":
        o.rotation_euler = Euler((0, -math.pi / 2, 0))
        o.rotation_euler.rotate_axis("X", -math.pi / 2)
    else:
        o.rotation_euler = Euler((0, 0, 0))
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.select_set(False)
    return _finish(o, mat, "Body", 0, 1)


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.15
    e.location = loc
    bpy.context.collection.objects.link(e)
    return e


# ---------------------------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------------------------
def build():
    G, GD, GL, CA = "HeliGreen", "HeliGreenDark", "HeliGreenLight", "HeliCamo"
    up = math.pi / 2

    # --- Cabin: big, tall, chunky block (the body dominates the key-art silhouette).
    box((0, 0.1, 0), (1.8, 2.4, 1.55), G, bevel=0.14, segments=3)
    box((0, 0.05, -0.76), (1.62, 2.2, 0.22), GD, bevel=0.06)
    for s in (-1, 1):
        box((s * 0.92, 0.72, 0.16), (0.08, 0.95, 1.0), G, bevel=0.04)
        box((s * 0.92, -0.33, 0.16), (0.08, 1.05, 1.0), G, bevel=0.04)
        box((s * 0.93, -0.1, -0.46), (0.06, 2.1, 0.16), GD, bevel=0.02)
        for y in (0.95, 0.4, -0.15, -0.7):
            box((s * 0.97, y, 0.6), (0.03, 0.07, 0.07), GL, bevel=0.01)
    # Stepped armour hump (layered blocks on the back).
    box((0, 0.05, 0.95), (1.55, 1.8, 0.36), G, bevel=0.12, segments=3)
    box((0, -0.25, 1.24), (1.25, 1.2, 0.26), GL, bevel=0.09, segments=3)
    box((0, -1.0, 0.9), (1.25, 0.6, 0.32), GD, bevel=0.08)
    box((-0.34, -0.5, 1.42), (0.5, 0.55, 0.14), G, bevel=0.045)
    box((0.34, 0.1, 1.4), (0.45, 0.5, 0.12), GD, bevel=0.04)
    box((0, 0.82, 1.18), (1.0, 0.45, 0.2), GD, bevel=0.05)
    box((0.48, -0.95, 1.1), (0.32, 0.34, 0.16), GL, bevel=0.035)

    # --- Engine nacelles with exhausts.
    for s in (-1, 1):
        box((s * 1.02, -0.5, 0.72), (0.56, 1.35, 0.68), G, bevel=0.1, segments=3)
        box((s * 1.02, -0.5, 1.08), (0.44, 1.1, 0.08), GL, bevel=0.03)
        box((s * 1.02, -1.2, 0.72), (0.46, 0.1, 0.46), "Black", bevel=0.03)
        box((s * 1.02, -1.25, 0.72), (0.26, 0.04, 0.26), "GlowOrange", bevel=0.01)

    # --- Nose: stepped taper, tandem canopy with teal side windows, chin gun.
    box((0, 1.78, -0.1), (1.5, 1.0, 1.3), G, bevel=0.12, segments=3)
    box((0, 2.48, -0.26), (1.1, 0.6, 0.9), GD, bevel=0.09)
    box((0, 2.88, -0.36), (0.72, 0.3, 0.6), G, bevel=0.07)
    box((0, 1.82, 0.72), (1.15, 0.8, 0.42), "Glass", bevel=0.06)
    box((0, 1.02, 0.95), (1.2, 0.6, 0.5), "Glass", bevel=0.06)
    box((0, 1.4, 0.88), (1.26, 0.13, 0.24), GD, bevel=0.035)
    for s in (-1, 1):
        box((s * 0.64, 1.82, 0.7), (0.04, 0.65, 0.3), "Teal", bevel=0.01)
        box((s * 0.68, 1.02, 0.93), (0.04, 0.5, 0.36), "Teal", bevel=0.01)
    box((0, 2.6, -0.92), (0.52, 0.52, 0.4), "Gunmetal", bevel=0.06)
    cyl((0, 3.05, -0.96), 0.085, 0.7, "Black", rot=(up, 0, 0), verts=10)

    # --- Mast and hub with chunky blade grips (the radar cube on top was removed on request).
    cyl((0, 0.05, 1.62), 0.24, 0.45, "Black", verts=12)
    box((0, 0.05, 1.92), (0.85, 0.85, 0.22), "Gunmetal", bevel=0.06)
    for i in range(4):
        a = i * up + math.pi / 4
        box((math.cos(a) * 0.6, 0.05 + math.sin(a) * 0.6, 1.92), (0.7, 0.26, 0.2), "Black", rot=(0, 0, a), bevel=0.045, group="Rotor")
    cyl((0, 0.05, 2.1), 0.16, 0.16, "Gunmetal", verts=12, group="Rotor")

    # --- Main rotor blades (4) with yellow tips.
    hub = Vector((0, 0.05, 1.98))
    for i in range(4):
        a = i * up + math.pi / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        box(tuple(hub + d * 2.05), (3.1, 0.46, 0.08), "BladeGrey", rot=(0.06, 0, a), bevel=0.03, group="Rotor")
        box(tuple(hub + d * 3.48), (0.28, 0.47, 0.085), "BladeYellow", rot=(0.06, 0, a), bevel=0.03, group="Rotor")

    # --- Stub wings with weapons: outer rocket pod and inner 4-barrel gatling.
    for s in (-1, 1):
        box((s * 1.35, 0.1, 0.12), (1.0, 0.85, 0.2), "Gunmetal", bevel=0.05)
        box((s * 1.35, 0.1, 0.24), (0.84, 0.62, 0.05), "Black", bevel=0.02)
        x = s * 1.95
        cyl((x, 0.1, -0.15), 0.4, 1.5, "Black", rot=(up, 0, 0), verts=18)
        cyl((x, 0.87, -0.15), 0.42, 0.1, "Gunmetal", rot=(up, 0, 0), verts=18)
        cyl((x, 0.1, -0.15), 0.42, 0.09, "Brass", rot=(up, 0, 0), verts=18)
        cyl((x, -0.66, -0.15), 0.42, 0.12, "Gunmetal", rot=(up, 0, 0), verts=18)
        cyl((x, -0.74, -0.15), 0.25, 0.04, "Black", rot=(up, 0, 0), verts=16, bevel=0)
        cyl((x, -0.76, -0.15), 0.14, 0.04, "GlowOrange", rot=(up, 0, 0), verts=12, bevel=0)
        for k in range(7):
            a = k / 6 * math.tau
            r = 0 if k == 6 else 0.22
            cyl((x + math.cos(a) * r, 0.93, -0.15 + math.sin(a) * r), 0.07, 0.04, "Rubber", rot=(up, 0, 0), verts=8, bevel=0)
        box((x, 0.1, 0.17), (0.18, 0.62, 0.2), "Gunmetal", bevel=0.03)
        gx = s * 1.3
        box((gx, 0.2, -0.36), (0.44, 1.05, 0.44), "Gunmetal", bevel=0.06)
        cyl((gx, 0.78, -0.36), 0.21, 0.1, "Black", rot=(up, 0, 0), verts=12)
        for k in range(4):
            a = k / 4 * math.tau + math.pi / 4
            cyl((gx + math.cos(a) * 0.11, 1.08, -0.36 + math.sin(a) * 0.11), 0.06, 0.6, "Black", rot=(up, 0, 0), verts=8, bevel=0.005)
            cyl((gx + math.cos(a) * 0.11, 1.39, -0.36 + math.sin(a) * 0.11), 0.045, 0.02, "GlowOrange", rot=(up, 0, 0), verts=8, bevel=0)
        box((gx, -0.4, -0.36), (0.36, 0.22, 0.36), "Brass", bevel=0.035)

    # --- Landing gear.
    for s in (-1, 1):
        box((s * 0.6, 0.95, -1.02), (0.17, 0.17, 0.44), "Black", bevel=0.035)
        cyl((s * 0.6, 0.95, -1.26), 0.22, 0.17, "Rubber", rot=(0, up, 0), verts=16)

    # --- Tail boom: short, thick, stepped, with camouflage patches.
    box((0, -1.65, 0.3), (1.0, 1.0, 0.85), G, bevel=0.11, segments=3)
    box((0, -2.4, 0.34), (0.86, 0.8, 0.74), G, bevel=0.1, segments=3)
    box((0, -2.95, 0.38), (0.74, 0.5, 0.66), G, bevel=0.08)
    box((0, -2.2, 0.73), (0.52, 1.5, 0.06), GL, bevel=0.02)
    for (x, y, z, sy) in [(0.505, -1.45, 0.18, 0.4), (0.505, -1.85, 0.48, 0.3), (0.435, -2.55, 0.2, 0.36),
                          (-0.505, -1.7, 0.36, 0.48), (-0.435, -2.35, 0.14, 0.3), (-0.375, -2.95, 0.46, 0.24)]:
        box((x, y, z), (0.04, sy, 0.18), CA, bevel=0.015)
    for (x, y) in [(0.15, -1.75), (-0.12, -2.45), (0.1, -2.95)]:
        box((x, y, 0.77), (0.24, 0.32, 0.04), CA, bevel=0.012)
    star((0.975, -0.33, 0.15), 0.36, "+x")
    star((-0.975, -0.33, 0.15), 0.36, "-x")
    star((0.445, -2.4, 0.36), 0.18, "+x")
    star((-0.445, -2.4, 0.36), 0.18, "-x")

    # --- Tail: big horizontal stabilizer, centre fin, wheel (the left teal fin was removed on request).
    box((0, -3.15, 0.5), (2.5, 0.75, 0.26), G, bevel=0.08)
    box((0, -3.15, 0.66), (2.1, 0.55, 0.05), GL, bevel=0.02)
    box((0, -3.3, 1.15), (0.24, 0.72, 1.2), G, bevel=0.08)
    box((0, -3.15, -0.05), (0.15, 0.15, 0.42), "Black", bevel=0.03)
    cyl((0, -3.15, -0.3), 0.19, 0.15, "Rubber", rot=(0, up, 0), verts=16)

    # --- Navigation lights.
    box((-2.4, 0.1, -0.15), (0.05, 0.14, 0.1), "NavRed", bevel=0.01)
    box((0, -3.3, 1.78), (0.09, 0.09, 0.09), "NavRed", bevel=0.01)

    # --- Tail rotor (right side of the centre fin).
    for i in range(2):
        box((0.16, -3.3, 1.25), (0.05, 0.14 if i else 1.2, 1.2 if i else 0.14), "BladeGrey", bevel=0.012, group="TailRotor")
    cyl((0.14, -3.3, 1.25), 0.1, 0.08, "Black", rot=(0, up, 0), verts=10, group="TailRotor")

    # --- Hardpoints (read by the game).
    empty("HP_chinGun", (0, 3.4, -0.96))
    for s, n in ((-1, "L"), (1, "R")):
        empty(f"HP_gun{n}", (s * 1.3, 1.45, -0.36))
        empty(f"HP_pod{n}", (s * 1.95, 1.0, -0.15))
        empty(f"HP_podRear{n}", (s * 1.95, -0.82, -0.15))
        empty(f"HP_exhaust{n}", (s * 1.02, -1.3, 0.72))


def join(group, name, origin):
    objs = PARTS[group]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="Bevel") if o.modifiers.get("Bevel") else None
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    # Pivot for spinning parts.
    bpy.context.scene.cursor.location = origin
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    o.select_set(False)
    return o


# ---------------------------------------------------------------------------------------------
# Scene / render
# ---------------------------------------------------------------------------------------------
def setup_render(path):
    enhance_materials()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1000
    sc.render.resolution_y = 840
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.filepath = path
    # Painted/cel look of the key art: thin dark outlines on silhouettes and creases.
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = "ABSOLUTE"
    sc.render.line_thickness = 1.3
    ls = sc.view_layers[0].freestyle_settings.linesets[0] if sc.view_layers[0].freestyle_settings.linesets else sc.view_layers[0].freestyle_settings.linesets.new("Lines")
    ls.select_by_visibility = True
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("HeliLines")
    ls.linestyle.color = (0.04, 0.06, 0.02)
    ls.linestyle.alpha = 0.85
    sc.view_layers[0].freestyle_settings.crease_angle = math.radians(120)
    # Attack pose: slight nose-down and a bank to the right, like the key art.
    heli = bpy.data.objects.get("Helicopter")
    if heli and VIEW == "keyart":
        heli.rotation_euler = Euler((math.radians(6), math.radians(-8), 0))

    world = bpy.data.worlds.new("Sky")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.3, 0.55, 1.0, 1)
    bg.inputs["Strength"].default_value = 0.6

    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.4
    sun.color = (1.0, 0.92, 0.78)
    sun.angle = math.radians(6)
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = Euler((math.radians(40), math.radians(-30), math.radians(-35)))
    sc.collection.objects.link(so)

    # Cloud floor far below so the heli reads against white/blue like the key art.
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -6))
    floor = bpy.context.active_object
    fm = bpy.data.materials.new("CloudFloor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.75, 0.84, 0.95, 1)
    floor.data.materials.append(fm)

    cam = bpy.data.cameras.new("Cam")
    cam.lens = float(arg("--lens", "38"))
    co = bpy.data.objects.new("Cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    views = {
        # Behind, left and above the tail, looking down the nose toward the upper right (key art).
        "keyart": ((4.5, -9.0, 9.5), (0, 0.2, 0.4)),
        "side": ((-11, 1, 2.5), (0, 0, 0.3)),
        "top": ((0, -0.5, 14), (0, -0.5, 0)),
        "front": ((4.5, 9, 4), (0, 0, 0.3)),
    }
    pos, target = views.get(VIEW, views["keyart"])
    if arg("--target"):
        target = tuple(float(v) for v in arg("--target").split(","))
    if arg("--campos"):
        pos = tuple(float(v) for v in arg("--campos").split(","))
    if arg("--pose"):
        heli_pose = [math.radians(float(v)) for v in arg("--pose").split(",")]
        bpy.data.objects["Helicopter"].rotation_euler = Euler(heli_pose)
    co.location = pos
    direction = Vector(target) - Vector(pos)
    co.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        # Inside the Blender GUI: start from an empty scene without resetting the UI.
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
            for d in list(coll):
                coll.remove(d)
    make_materials()
    build()
    body = join("Body", "HeliBody", (0, 0, 0))
    rotor = join("Rotor", "HeliRotor", (0, 0.05, 1.98))
    tail = join("TailRotor", "HeliTailRotor", (0.14, -3.3, 1.25))
    root = bpy.data.objects.new("Helicopter", None)
    bpy.context.collection.objects.link(root)
    for o in list(bpy.context.collection.objects):
        if o is not root and o.parent is None:
            o.parent = root

    os.makedirs(OUT_DIR, exist_ok=True)
    blend_path = os.path.abspath(os.path.join(OUT_DIR, "helicopter.blend"))
    glb_path = os.path.abspath(os.path.join(OUT_DIR, "helicopter.glb"))
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=False, export_apply=True,
                              export_yup=True, export_extras=True)
    if RENDER:
        setup_render(os.path.abspath(RENDER))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print("saved", blend_path, glb_path)
    if RENDER:
        bpy.ops.render.render(write_still=True)
        print("rendered", RENDER)


main()
