"""
Blender props for Blocked Pixel Warriors (Blender 4.2+/5.x):

  bullet.glb   grey turret round (sized to the turret's twin barrels)
  forklift.glb yellow forklift driven by the capped, uniformed, booted engineer soldier
  chinook.glb  CH-47F tandem-rotor cargo helicopter in the yellow / green / dark camo of the photo

    python tools/blender/build_props.py [--only bullet|forklift|chinook] [--render captures]
or inside Blender: Scripting tab > Open > this file > Run Script (builds all three).

Each model is exported to assets/models/<name>.glb (+ <name>.blend). Node names used by the game:
  forklift: Forklift (body), Forks (lifting carriage), Soldier
  chinook:  Chinook (body), RotorFront, RotorRear
Axes: Blender +Y = forward (nose), +Z = up. glTF export turns +Y into -Z (three.js forward).
"""
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ONLY = arg("--only")
RENDER_DIR = arg("--render")
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models"))


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------
def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


MATS = {}


def mat(name, hexv, rough=0.5, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


class Part:
    """Collects primitives into named groups, then joins each group into one object."""

    def __init__(self):
        self.groups = {}

    def _finish(self, o, m, group, bevel, seg=2):
        o.data.materials.append(MATS[m])
        if bevel:
            mod = o.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = "ANGLE"
        self.groups.setdefault(group, []).append(o)
        return o

    def box(self, loc, size, m, group="Body", rot=(0, 0, 0), bevel=0.02, seg=2):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        return self._finish(o, m, group, min(bevel, min(size) * 0.45), seg)

    def cyl(self, loc, r, depth, m, group="Body", rot=(0, 0, 0), verts=16, bevel=0.01, r2=None):
        if r2 is None:
            bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
        else:
            bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
        return self._finish(bpy.context.active_object, m, group, bevel)

    def sphere(self, loc, r, m, group="Body", scale=(1, 1, 1), seg=16):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
        o = bpy.context.active_object
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        for p in o.data.polygons:
            p.use_smooth = True
        return self._finish(o, m, group, 0)

    def join(self, group, name, origin=(0, 0, 0)):
        objs = self.groups[group]
        for o in objs:
            bpy.context.view_layer.objects.active = o
            for mod in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        o = bpy.context.active_object
        o.name = name
        o.data.name = name
        bpy.context.scene.cursor.location = origin
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        o.select_set(False)
        return o


def reset():
    MATS.clear()
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)


def export(name):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{name}.glb"), export_format="GLB", export_apply=True, export_yup=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{name}.blend"))


def render(name, cam_pos, target, lens=50, size=(900, 600)):
    if not RENDER_DIR:
        return
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = os.path.abspath(os.path.join(RENDER_DIR, f"{name}_blender.png"))
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.68, 0.95, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (0.75, -0.35, -0.7)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = lens
    cam.location = cam_pos
    cam.rotation_euler = (Vector(target) - Vector(cam_pos)).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------------------------
# Bullet: grey round with a darker driving band, ~0.13 calibre to match the turret barrels.
# ---------------------------------------------------------------------------------------------
def build_bullet():
    reset()
    mat("BulletGrey", 0x9aa0a8, 0.3, 0.85)
    mat("BulletBand", 0x5a5f66, 0.4, 0.8)
    mat("BulletTip", 0xc8ccd2, 0.25, 0.9)
    p = Part()
    rx = (-math.pi / 2, 0, 0)
    p.cyl((0, -0.06, 0), 0.065, 0.26, "BulletGrey", rot=rx, verts=14)
    p.cyl((0, -0.16, 0), 0.068, 0.04, "BulletBand", rot=rx, verts=14)
    p.cyl((0, 0.12, 0), 0.065, 0.1, "BulletTip", rot=rx, verts=14, r2=0.045)
    p.cyl((0, 0.2, 0), 0.045, 0.06, "BulletTip", rot=rx, verts=14, r2=0.0, bevel=0)
    p.join("Body", "Bullet")
    export("bullet")
    render("bullet", (0.45, -0.15, 0.25), (0, 0.02, 0), lens=60)


# ---------------------------------------------------------------------------------------------
# Forklift + engineer soldier (peaked cap, olive uniform, belt, black boots), seated, driving.
# Forklift faces +Y (forks at the front). Base at z = 0. Length ~2.3, width ~1.1.
# ---------------------------------------------------------------------------------------------
def build_forklift():
    reset()
    mat("FkYellow", 0xf2b51c, 0.45, 0.1)
    mat("FkYellowDark", 0xc98a10, 0.5, 0.1)
    mat("FkBlack", 0x1c1d20, 0.6, 0.2)
    mat("FkSteel", 0x7d838b, 0.35, 0.8)
    mat("FkRubber", 0x141414, 0.9, 0.0)
    mat("FkBeacon", 0xff8a1c, 0.4, 0.0, emit=6)
    mat("FkLight", 0xfff3c4, 0.3, 0.0, emit=5)
    mat("Olive", 0x56602f, 0.75, 0.0)
    mat("OliveDark", 0x3f4823, 0.75, 0.0)
    mat("Skin", 0xe0b08a, 0.6, 0.0)
    mat("Boot", 0x17181a, 0.5, 0.1)
    mat("Belt", 0x5a3a1e, 0.6, 0.0)
    mat("Visor", 0x111214, 0.3, 0.2)
    mat("Badge", 0xd8b13a, 0.3, 0.8)
    p = Part()
    # Chassis + counterweight + wheels.
    p.box((0, -0.15, 0.42), (1.05, 1.6, 0.42), "FkYellow", bevel=0.08, seg=3)
    p.box((0, -0.85, 0.62), (1.08, 0.45, 0.72), "FkYellowDark", bevel=0.1, seg=3)
    p.box((0, -1.09, 0.62), (0.8, 0.04, 0.35), "FkBlack", bevel=0.01)
    for x in (-0.55, 0.55):
        for y, r in ((0.45, 0.26), (-0.7, 0.22)):
            p.cyl((x, y, r), r, 0.2, "FkRubber", rot=(0, math.pi / 2, 0), verts=18)
            p.cyl((x * 1.04, y, r), r * 0.45, 0.04, "FkSteel", rot=(0, math.pi / 2, 0), verts=12)
    p.box((0, 0.45, 0.62), (1.1, 0.5, 0.1), "FkBlack", bevel=0.02)  # front fenders
    # Seat, steering column, overhead guard.
    p.box((0, -0.45, 0.78), (0.5, 0.45, 0.12), "FkBlack", bevel=0.04)
    p.box((0, -0.66, 1.02), (0.5, 0.1, 0.45), "FkBlack", bevel=0.04)
    p.cyl((0, 0.2, 0.95), 0.03, 0.5, "FkBlack", rot=(0.55, 0, 0), verts=8)
    p.cyl((0, 0.08, 1.16), 0.13, 0.03, "FkBlack", rot=(0.55, 0, 0), verts=16)
    for x in (-0.48, 0.48):
        for y in (0.3, -0.75):
            p.box((x, y, 1.3), (0.06, 0.06, 1.3), "FkBlack", bevel=0.01)
    p.box((0, -0.22, 1.96), (1.02, 1.12, 0.06), "FkBlack", bevel=0.02)
    for y in (-0.55, -0.3, -0.05, 0.2):
        p.box((0, y, 2.0), (1.0, 0.04, 0.04), "FkBlack", bevel=0.0)
    p.cyl((0.38, -0.65, 2.08), 0.07, 0.12, "FkBeacon", verts=12)
    p.box((0.42, 0.33, 1.6), (0.12, 0.06, 0.1), "FkLight", bevel=0.01)
    p.box((-0.42, 0.33, 1.6), (0.12, 0.06, 0.1), "FkLight", bevel=0.01)
    # Mast (fixed rails).
    for x in (-0.35, 0.35):
        p.box((x, 0.62, 1.15), (0.07, 0.1, 1.9), "FkSteel", bevel=0.01)
    p.box((0, 0.62, 2.08), (0.78, 0.1, 0.06), "FkSteel", bevel=0.01)
    p.box((0, 0.62, 0.32), (0.78, 0.1, 0.06), "FkSteel", bevel=0.01)
    # Forks + carriage (separate object so the game can lift it).
    p.box((0, 0.72, 0.42), (0.8, 0.06, 0.42), "FkSteel", group="Forks", bevel=0.01)
    for x in (-0.18, 0.18):
        p.box((x, 0.72, 0.42), (0.04, 0.06, 0.42), "FkBlack", group="Forks", bevel=0.0)
    for x in (-0.24, 0.24):
        p.box((x, 1.18, 0.24), (0.12, 0.95, 0.04), "FkSteel", group="Forks", bevel=0.01)
    # Soldier, seated: boots, bent legs, torso, belt, arms on the wheel, head, peaked cap.
    S = "Soldier"
    for x in (-0.12, 0.12):
        p.box((x, -0.25, 0.86), (0.15, 0.4, 0.15), "Olive", group=S, bevel=0.04)   # thighs
        p.box((x, -0.06, 0.62), (0.14, 0.14, 0.38), "Olive", group=S, bevel=0.04)  # shins
        p.box((x, -0.02, 0.43), (0.15, 0.24, 0.12), "Boot", group=S, bevel=0.04)    # boots
    p.box((0, -0.47, 1.12), (0.42, 0.26, 0.5), "Olive", group=S, bevel=0.07, seg=3)  # torso
    p.box((0, -0.47, 0.9), (0.44, 0.28, 0.07), "Belt", group=S, bevel=0.02)
    p.box((0, -0.33, 0.9), (0.06, 0.02, 0.05), "Badge", group=S, bevel=0.0)
    p.box((-0.12, -0.335, 1.22), (0.1, 0.02, 0.08), "OliveDark", group=S, bevel=0.0)  # pockets
    p.box((0.12, -0.335, 1.22), (0.1, 0.02, 0.08), "OliveDark", group=S, bevel=0.0)
    for x in (-0.27, 0.27):
        p.box((x, -0.38, 1.18), (0.12, 0.13, 0.32), "Olive", group=S, bevel=0.04)   # upper arms
        p.box((x * 0.85, -0.18, 1.05), (0.11, 0.32, 0.11), "Olive", group=S, bevel=0.04)  # forearms
        p.box((x * 0.6, 0.0, 1.07), (0.09, 0.09, 0.09), "Skin", group=S, bevel=0.03)  # hands
    p.box((0, -0.47, 1.42), (0.12, 0.12, 0.08), "Skin", group=S, bevel=0.02)  # neck
    p.box((0, -0.46, 1.6), (0.28, 0.28, 0.3), "Skin", group=S, bevel=0.07, seg=3)  # head
    p.box((-0.07, -0.316, 1.63), (0.04, 0.01, 0.04), "Visor", group=S, bevel=0.0)  # eyes
    p.box((0.07, -0.316, 1.63), (0.04, 0.01, 0.04), "Visor", group=S, bevel=0.0)
    # Peaked military cap ("kasket"): crown, band, visor and badge.
    p.box((0, -0.46, 1.8), (0.34, 0.36, 0.12), "OliveDark", group=S, bevel=0.05, seg=3)
    p.box((0, -0.46, 1.75), (0.31, 0.32, 0.06), "Olive", group=S, bevel=0.02)
    p.box((0, -0.25, 1.75), (0.28, 0.14, 0.025), "Visor", group=S, rot=(0.22, 0, 0), bevel=0.01)
    p.box((0, -0.29, 1.81), (0.07, 0.02, 0.06), "Badge", group=S, bevel=0.0)
    p.join("Body", "Forklift")
    p.join("Forks", "Forks")
    p.join(S, "Soldier")
    export("forklift")
    render("forklift", (2.6, 2.4, 2.4), (0, 0, 0.9), lens=40)


# ---------------------------------------------------------------------------------------------
# CH-47F Chinook: long boxy fuselage, low front pylon, tall rear pylon with two engines, two
# 3-blade rotors, side fuel sponsons, 4 wheels, round windows, cockpit glass, rear ramp.
# Camo from the photo: yellow + green blotches on top/sides, dark grey-green underside and tail.
# Nose at +Y. Length ~10, rotor radius ~5.
# ---------------------------------------------------------------------------------------------
def build_chinook():
    reset()
    mat("ChYellow", 0xd8b83a, 0.6, 0.0)
    mat("ChGreen", 0x5a8a3c, 0.6, 0.0)
    mat("ChDark", 0x2c322c, 0.6, 0.05)
    mat("ChGlass", 0x1a2a33, 0.08, 0.3)
    mat("ChWindow", 0x8fa6b8, 0.15, 0.5)
    mat("ChMetal", 0x3a3e42, 0.4, 0.7)
    mat("ChRubber", 0x141414, 0.9, 0.0)
    mat("ChRotor", 0x23262a, 0.45, 0.3)
    mat("ChNav", 0xff3030, 0.4, 0.0, emit=5)
    mat("ChExhaust", 0x0c0c0c, 0.7, 0.2)
    p = Part()
    # Fuselage: dark lower half, yellow upper half, rounded edges.
    p.box((0, 0.2, 0.95), (2.2, 8.6, 1.1), "ChDark", bevel=0.3, seg=4)
    p.box((0, 0.2, 1.95), (2.15, 8.5, 1.2), "ChYellow", bevel=0.4, seg=4)
    # Nose: tapered cockpit section.
    p.box((0, 4.75, 1.25), (2.0, 1.0, 1.7), "ChYellow", bevel=0.45, seg=4)
    p.box((0, 4.75, 0.7), (1.9, 0.95, 0.6), "ChDark", bevel=0.25, seg=3)
    p.box((0, 5.25, 1.35), (1.7, 0.4, 1.0), "ChYellow", bevel=0.35, seg=4)
    for x in (-0.55, 0.0, 0.55):
        p.box((x, 5.36, 1.65), (0.48, 0.3, 0.42), "ChGlass", rot=(0.45, 0, 0), bevel=0.06)
    for s in (-1, 1):
        p.box((s * 0.98, 4.85, 1.7), (0.08, 0.6, 0.45), "ChGlass", bevel=0.04)
        p.box((s * 1.0, 4.2, 1.25), (0.06, 0.45, 0.6), "ChDark", bevel=0.02)  # crew door
    p.cyl((0.55, 5.55, 1.3), 0.03, 0.9, "ChMetal", rot=(-math.pi / 2, 0, 0), verts=6)  # probe
    # Green camo blotches (sides + top), like the photo.
    for s in (-1, 1):
        for (y, z, sy, sz) in ((2.6, 1.95, 1.5, 0.9), (0.4, 1.75, 1.1, 0.9), (-1.6, 2.05, 1.6, 0.7), (-3.3, 1.7, 1.0, 0.8), (3.9, 1.5, 0.7, 0.6)):
            p.box((s * 1.085, y, z), (0.04, sy, sz), "ChGreen", bevel=0.02)
        for (y, z, sy, sz) in ((1.5, 1.3, 1.2, 0.35), (-0.6, 1.25, 1.0, 0.3), (-2.6, 1.35, 1.2, 0.4)):
            p.box((s * 1.088, y, z), (0.04, sy, sz), "ChYellow", bevel=0.02)
        for y in (2.9, 1.7, 0.5, -0.7, -1.9):
            p.cyl((s * 1.1, y, 1.65), 0.17, 0.05, "ChWindow", rot=(0, math.pi / 2, 0), verts=16)
            p.cyl((s * 1.09, y, 1.65), 0.21, 0.03, "ChMetal", rot=(0, math.pi / 2, 0), verts=16)
    for (x, y, sx, sy) in ((0.3, 2.3, 1.2, 1.4), (-0.4, -0.3, 1.0, 1.6), (0.2, -2.6, 1.3, 1.2)):
        p.box((x, y, 2.56), (sx, sy, 0.04), "ChGreen", bevel=0.02)
    # Fuel sponsons along the lower sides.
    for s in (-1, 1):
        p.box((s * 1.28, 0.6, 0.72), (0.45, 5.2, 0.62), "ChDark", bevel=0.2, seg=3)
        p.box((s * 1.3, 1.2, 0.92), (0.42, 2.2, 0.25), "ChGreen", bevel=0.1)
    # Front pylon + rotor hub.
    p.box((0, 3.6, 2.75), (1.1, 1.6, 0.6), "ChDark", bevel=0.25, seg=3)
    p.box((0, 3.75, 3.05), (0.8, 0.9, 0.35), "ChDark", bevel=0.15)
    # Rear pylon (tall) with two engines on its sides.
    p.box((0, -3.4, 2.9), (1.5, 2.6, 1.3), "ChGreen", bevel=0.35, seg=4)
    p.box((0, -3.6, 3.65), (1.0, 1.3, 0.6), "ChDark", bevel=0.2, seg=3)
    p.box((0, -4.55, 2.2), (1.8, 0.6, 1.6), "ChDark", bevel=0.25, seg=3)
    for s in (-1, 1):
        p.cyl((s * 1.1, -3.5, 2.75), 0.36, 1.7, "ChDark", rot=(-math.pi / 2, 0, 0), verts=18)
        p.cyl((s * 1.1, -2.6, 2.75), 0.3, 0.12, "ChMetal", rot=(-math.pi / 2, 0, 0), verts=18)
        p.cyl((s * 1.1, -4.4, 2.75), 0.25, 0.1, "ChExhaust", rot=(-math.pi / 2, 0, 0), verts=16)
    # Rear ramp + belly hook light.
    p.box((0, -4.4, 0.75), (1.9, 0.3, 0.9), "ChDark", rot=(0.4, 0, 0), bevel=0.06)
    p.cyl((0, 0.3, 0.35), 0.09, 0.08, "ChNav", verts=12)
    p.box((0, 0.3, 0.42), (0.3, 0.3, 0.06), "ChMetal", bevel=0.02)
    # Landing gear: 2 front, 2 rear.
    for s in (-1, 1):
        for y, r in ((3.1, 0.32), (-2.6, 0.32)):
            p.box((s * 0.95, y, 0.55), (0.12, 0.12, 0.5), "ChMetal", bevel=0.02)
            p.cyl((s * 1.0, y, r - 0.05), r, 0.24, "ChRubber", rot=(0, math.pi / 2, 0), verts=18)
            p.cyl((s * 1.12, y, r - 0.05), r * 0.45, 0.04, "ChMetal", rot=(0, math.pi / 2, 0), verts=12)
    p.box((1.06, 4.1, 2.3), (0.05, 0.12, 0.08), "ChNav", bevel=0.0)
    p.box((-1.06, 4.1, 2.3), (0.05, 0.12, 0.08), "ChNav", bevel=0.0)
    # Rotors (separate objects): 3 long blades each, hub + mast.
    for name, y, z in (("RotorFront", 3.75, 3.45), ("RotorRear", -3.6, 4.15)):
        p.cyl((0, y, z - 0.15), 0.12, 0.35, "ChMetal", group=name, verts=10)
        p.cyl((0, y, z), 0.32, 0.18, "ChRotor", group=name, verts=12)
        for i in range(3):
            a = i * 2 * math.pi / 3 + (0.5 if name == "RotorRear" else 0)
            d = Vector((math.cos(a), math.sin(a), 0))
            c = Vector((0, y, z)) + d * 2.6
            p.box(tuple(c), (4.9, 0.32, 0.05), "ChRotor", group=name, rot=(0.03, 0, a), bevel=0.02)
    p.join("Body", "Chinook")
    p.join("RotorFront", "RotorFront", (0, 3.75, 3.45))
    p.join("RotorRear", "RotorRear", (0, -3.6, 4.15))
    export("chinook")
    render("chinook", (9.5, 7.5, 5.0), (0, 0.2, 1.8), lens=35, size=(1000, 620))


if __name__ == "__main__" or True:
    jobs = {"bullet": build_bullet, "forklift": build_forklift, "chinook": build_chinook}
    for key, fn in jobs.items():
        if ONLY and ONLY != key:
            continue
        fn()
        print("built", key)
