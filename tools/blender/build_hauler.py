"""
"Block Hauler" train for stage 2 of Blocked Pixel Warriors (Blender 4.2+/5.x), after the
BLOCK HAULER key art: a heavy grey locomotive with a slatted snow plough, four round headlights
around a grille, hazard stripes, big rusty gears on the flanks, twin chimneys and yellow hook
arms at the front; a red hopper full of coloured cubes; a crane car whose yellow boom swings a
wrecking ball on a chain; a silver cage car with ice blocks and a grey ore hopper.

    python tools/blender/build_hauler.py [--render captures]
or inside Blender: Scripting tab > Open > this file > Run Script.

Output: assets/models/hauler.glb (+ hauler.blend). One root per car, laid out side by side
(the game re-parents them). Car roots and the node names the game looks up:

  HaulerLoco      locomotive. Children: Core (weak point, glowing furnace eye), TurretMount,
                  Chimney0, Chimney1 (smoke points), Headlight0..3
  HaulerHopper    red cube hopper. Child: CargoDeck (top of the cube floor, centre)
  HaulerCrane     crane car. Children: CraneSlew (turns about +Y) > CraneTip (chain anchor),
                  CraneChain (unit length, hangs along -Y), WreckingBall (origin = shackle top)
  HaulerCage      silver cage car with ice blocks. Child: TurretMount
  HaulerOre       grey ore hopper

Every car faces +Z in three.js (glTF), origin at the car centre on rail-top height. The script
writes geometry in three.js axes (x right, y up, z forward); `B()` converts to Blender axes.
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
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models"))
PI = math.pi

# ---------------------------------------------------------------------------------------------
# Axes: three.js (x, y up, z forward) -> Blender (x, -z, y). glTF export (+Y up) maps it back.
# ---------------------------------------------------------------------------------------------


def B(p):
    return (p[0], -p[2], p[1])


def BS(s):
    return (s[0], s[2], s[1])


# Rotations for primitives whose axis is Blender Z (= three.js Y, vertical).
AXIS_X = (0, PI / 2, 0)   # cylinder along three.js X (sideways)
AXIS_Z = (PI / 2, 0, 0)   # cylinder along three.js Z (forward)


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


MATS = {}


def mat(name, hexv, rough=0.5, metal=0.0, emit=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    if image is not None:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Linear"
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    MATS[name] = m
    return m


def stripe_image(name, colors, size=32):
    """Diagonal 45-degree stripes (two colours), tiling."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = []

    # Byte images hold sRGB values (the texture node decodes them).
    def raw(h):
        return (((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, 1)
    a, b = raw(colors[0]), raw(colors[1])
    for y in range(size):
        for x in range(size):
            px.extend(a if ((x + y) // (size // 2)) % 2 == 0 else b)
    img.pixels = px
    img.pack()
    return img


class Part:
    """Collects primitives into named groups, then joins each group into one object."""

    def __init__(self):
        self.groups = {}

    def _finish(self, o, m, group, bevel, seg=2, stripes=0):
        o.data.materials.append(MATS[m])
        if stripes:
            # World-scaled cube projection so stripes keep their width on any box size.
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.cube_project(cube_size=stripes)
            bpy.ops.object.mode_set(mode="OBJECT")
        if bevel:
            mod = o.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = "ANGLE"
        self.groups.setdefault(group, []).append(o)
        return o

    def box(self, loc, size, m, group="Body", rot=(0, 0, 0), bevel=0.02, seg=2, stripes=0):
        """loc / size in three.js axes; rot is a Blender euler."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=B(loc), rotation=rot)
        o = bpy.context.active_object
        o.scale = BS(size)
        bpy.ops.object.transform_apply(scale=True)
        return self._finish(o, m, group, min(bevel, min(size) * 0.45), seg, stripes)

    def rod(self, a, b, thick, m, group="Body", bevel=0.02):
        """Box from point a to point b (three.js axes), square cross-section."""
        a, b = Vector(a), Vector(b)
        mid = (a + b) / 2
        db = Vector(B(b - a))
        rot = Vector((0, 1, 0)).rotation_difference(db.normalized()).to_euler()
        bpy.ops.mesh.primitive_cube_add(size=1, location=B(mid), rotation=rot)
        o = bpy.context.active_object
        o.scale = (thick, db.length, thick)
        bpy.ops.object.transform_apply(scale=True)
        return self._finish(o, m, group, min(bevel, thick * 0.45))

    def cyl(self, loc, r, depth, m, group="Body", rot=(0, 0, 0), verts=16, bevel=0.01, r2=None):
        if r2 is None:
            bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=B(loc), rotation=rot)
        else:
            bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=B(loc), rotation=rot)
        o = bpy.context.active_object
        for p in o.data.polygons:
            p.use_smooth = len(p.vertices) == 4
        return self._finish(o, m, group, bevel)

    def sphere(self, loc, r, m, group="Body", seg=20):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=B(loc))
        o = bpy.context.active_object
        for p in o.data.polygons:
            p.use_smooth = True
        return self._finish(o, m, group, 0)

    def torus(self, loc, r, tube, m, group="Body", rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=tube, major_segments=14, minor_segments=6, location=B(loc), rotation=rot)
        o = bpy.context.active_object
        for p in o.data.polygons:
            p.use_smooth = True
        return self._finish(o, m, group, 0)

    def gear(self, loc, r, width, m, teeth=12, group="Body", hub=None):
        """Spur gear with its axle along three.js X."""
        self.cyl(loc, r, width, m, group, rot=AXIS_X, verts=28, bevel=0.015)
        for i in range(teeth):
            a = i * 2 * PI / teeth
            y = loc[1] + math.cos(a) * (r + 0.04)
            z = loc[2] + math.sin(a) * (r + 0.04)
            self.box((loc[0], y, z), (width * 0.9, 0.12, 0.13), m, group, rot=(a, 0, 0), bevel=0.012)
        # Spokes + hub.
        for i in range(4):
            a = i * PI / 4
            self.box((loc[0] + math.copysign(0.02, loc[0]), loc[1], loc[2]), (width * 0.6, r * 1.6, 0.07), hub or m, group, rot=(a, 0, 0), bevel=0.01)
        self.cyl((loc[0] + math.copysign(0.03, loc[0]), loc[1], loc[2]), r * 0.28, width * 1.2, hub or m, group, rot=AXIS_X, verts=14)

    def empty(self, name, loc, parent_group):
        o = bpy.data.objects.new(name, None)
        o.empty_display_type = "PLAIN_AXES"
        o.empty_display_size = 0.2
        o.location = B(loc)
        bpy.context.scene.collection.objects.link(o)
        self.groups.setdefault("__empties__" + parent_group, []).append(o)
        return o

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
        bpy.context.scene.cursor.location = B(origin)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        o.select_set(False)
        return o


def parent(child, par):
    """Parents keeping the world transform."""
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = mw


def reset():
    MATS.clear()
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------
def materials():
    hazard = stripe_image("HazardStripes", (0xf2b51c, 0x18191c))
    mat("HlGrey", 0x6c7178, 0.45, 0.55)
    mat("HlGreyLight", 0x91969c, 0.42, 0.55)
    mat("HlGreyDark", 0x44484e, 0.5, 0.5)
    mat("HlBlack", 0x18191c, 0.6, 0.3)
    mat("HlRust", 0x8f4c1c, 0.55, 0.55)
    mat("HlRustDark", 0x5e2f12, 0.6, 0.5)
    mat("HlBrass", 0xc99a3a, 0.3, 0.85)
    mat("HlYellow", 0xf0b21c, 0.45, 0.15)
    mat("HlYellowDark", 0xb97f0e, 0.5, 0.15)
    mat("HlHazard", 0xffffff, 0.5, 0.2, image=hazard)
    mat("HlRed", 0xc42a20, 0.6, 0.05)
    mat("HlRedDark", 0x7e1812, 0.65, 0.05)
    mat("HlBlue", 0x1e78d6, 0.55, 0.05)
    mat("HlGold", 0xf2c21c, 0.5, 0.05)
    mat("HlWood", 0x8a5a2e, 0.75, 0.0)
    mat("HlGlass", 0x1a2a38, 0.12, 0.3)
    mat("HlLamp", 0xfff0c0, 0.3, 0.0, emit=7)
    mat("HlLampRim", 0xffb54a, 0.3, 0.0, emit=3)
    mat("HlCore", 0xff5a14, 0.25, 0.0, emit=6)
    mat("HlSteel", 0xc2c8d0, 0.28, 0.9)
    mat("HlIce", 0xbfe8ff, 0.08, 0.0, emit=0.35)
    mat("HlSnow", 0xf2f6fa, 0.85, 0.0)
    mat("HlChain", 0x2a2c30, 0.35, 0.9)
    mat("HlBall", 0x26282c, 0.3, 0.9)


# ---------------------------------------------------------------------------------------------
# Shared parts
# ---------------------------------------------------------------------------------------------
def undercarriage(p, L, wheel_zs, r=0.44, hazard=True):
    """Chassis beam, hazard-striped side skirts, big black wheels with rusty hubs + side rods."""
    p.box((0, 0.6, 0), (1.95, 0.3, L), "HlBlack", bevel=0.03)
    for s in (-1, 1):
        p.box((s * 1.0, 0.86, 0), (0.1, 0.22, L - 0.3), "HlHazard" if hazard else "HlGreyDark", bevel=0.02, stripes=0.45)
        for z in wheel_zs:
            p.cyl((s * 0.86, r, z), r, 0.2, "HlBlack", rot=AXIS_X, verts=24, bevel=0.03)
            p.cyl((s * 0.97, r, z), r * 0.72, 0.05, "HlRust", rot=AXIS_X, verts=20)
            for k in range(3):
                p.box((s * 1.0, r, z), (0.04, r * 1.35, 0.08), "HlRustDark", rot=(k * PI / 3, 0, 0), bevel=0.01)
            p.cyl((s * 1.02, r, z), r * 0.22, 0.06, "HlBrass", rot=AXIS_X, verts=12)
        if len(wheel_zs) > 1:
            z0, z1 = wheel_zs[0], wheel_zs[-1]
            p.box((s * 1.06, r * 0.8, (z0 + z1) / 2), (0.05, 0.09, abs(z1 - z0)), "HlGreyLight", bevel=0.015)
    # Couplers.
    for s in (-1, 1):
        p.box((0, 0.62, s * (L / 2 + 0.12)), (0.3, 0.2, 0.3), "HlWood", bevel=0.03)


def rivets(p, x, y0, y1, z0, z1, step=0.32, m="HlGreyLight", group="Body"):
    """Rivet rows on a side face at x (sign = side)."""
    n = max(2, int(abs(z1 - z0) / step))
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        for y in (y0, y1):
            p.box((x, y, z), (0.04, 0.05, 0.05), m, group, bevel=0.012)


def chimney(p, x, y, z, h, r=0.2):
    p.cyl((x, y + h / 2, z), r, h, "HlGreyDark", verts=16, bevel=0.015)
    p.cyl((x, y + 0.12, z), r + 0.06, 0.14, "HlBlack", verts=16)
    p.cyl((x, y + h * 0.55, z), r + 0.03, 0.08, "HlRust", verts=16)
    p.cyl((x, y + h - 0.05, z), r + 0.08, 0.14, "HlBlack", verts=16)
    p.cyl((x, y + h + 0.08, z), r + 0.03, 0.1, "HlGreyDark", verts=16)
    return (x, y + h + 0.16, z)


# ---------------------------------------------------------------------------------------------
# Locomotive (front at +Z = 2.95)
# ---------------------------------------------------------------------------------------------
def build_loco():
    p = Part()
    L = 5.6
    F = L / 2  # front face of the frame
    undercarriage(p, L, [-1.9, -0.55, 0.85], r=0.47)

    # Snow plough: slatted wedge in front of the buffer beam, toothed bottom edge.
    for i in range(7):
        x = -1.08 + i * 0.36
        p.box((x, 0.5, F + 0.42), (0.26, 0.82, 0.07), "HlGreyLight", rot=(-0.62, 0, 0), bevel=0.02)
    p.box((0, 0.88, F + 0.18), (2.4, 0.12, 0.2), "HlGrey", bevel=0.03)
    p.box((0, 0.13, F + 0.66), (2.44, 0.1, 0.16), "HlGreyDark", bevel=0.02)
    for i in range(9):
        p.box((-1.1 + i * 0.275, 0.04, F + 0.72), (0.12, 0.12, 0.16), "HlGreyDark", bevel=0.02)
    for s in (-1, 1):
        p.box((s * 1.2, 0.5, F + 0.36), (0.1, 0.84, 0.66), "HlGrey", rot=(0.0, 0, 0), bevel=0.03)
    # Coupler block in the middle of the plough.
    p.box((0, 0.62, F + 0.62), (0.34, 0.28, 0.3), "HlWood", bevel=0.04)
    p.box((0, 0.62, F + 0.78), (0.16, 0.16, 0.08), "HlRustDark", bevel=0.02)

    # Buffer beam with hazard stripes.
    p.box((0, 1.0, F), (2.4, 0.42, 0.32), "HlHazard", bevel=0.04, stripes=0.42)
    p.box((0, 1.24, F - 0.02), (2.44, 0.06, 0.34), "HlBlack", bevel=0.01)

    # Hood: the big front block.
    hz0, hz1 = 0.55, F - 0.05
    hc = (hz0 + hz1) / 2
    p.box((0, 1.88, hc), (2.2, 1.36, hz1 - hz0), "HlGrey", bevel=0.07, seg=3)
    p.box((0, 2.58, hc - 0.05), (1.9, 0.1, hz1 - hz0 - 0.2), "HlGreyLight", bevel=0.04)
    p.box((0, 2.66, hc + 0.3), (1.0, 0.08, 0.8), "HlGreyDark", bevel=0.03)
    # Hazard band across the hood front + dark edges.
    p.box((0, 1.32, hz1 + 0.02), (2.22, 0.22, 0.06), "HlHazard", bevel=0.01, stripes=0.42)
    for s in (-1, 1):
        p.box((s * 1.1, 1.88, hz1 + 0.01), (0.08, 1.36, 0.08), "HlGreyDark", bevel=0.02)
    # Grille: frame + vertical slats.
    gz = hz1 + 0.03
    p.box((0, 1.95, gz), (0.92, 0.95, 0.08), "HlBlack", bevel=0.03)
    for i in range(7):
        p.box((-0.36 + i * 0.12, 1.95, gz + 0.04), (0.06, 0.86, 0.06), "HlGreyLight", bevel=0.01)
    p.box((0, 2.47, gz + 0.03), (1.02, 0.1, 0.1), "HlGreyDark", bevel=0.02)
    # Headlights: two big ones beside the grille, two small ones below.
    lights = [((-0.78, 2.12), 0.26), ((0.78, 2.12), 0.26), ((-0.78, 1.6), 0.16), ((0.78, 1.6), 0.16)]
    for (x, y), r in lights:
        p.cyl((x, y, gz + 0.02), r + 0.07, 0.12, "HlBlack", rot=AXIS_Z, verts=24, bevel=0.02)
        p.cyl((x, y, gz + 0.06), r + 0.03, 0.06, "HlLampRim", rot=AXIS_Z, verts=24)
        p.cyl((x, y, gz + 0.09), r, 0.04, "HlLamp", rot=AXIS_Z, verts=24)
    # Core: the glowing furnace eye under the grille (the weak point, shielded like the gem).
    CY = 1.95
    p.cyl((0, CY, gz + 0.1), 0.3, 0.1, "HlBlack", rot=AXIS_Z, verts=8, bevel=0.02)
    p.cyl((0, CY, gz + 0.14), 0.23, 0.06, "HlCore", group="Core", rot=AXIS_Z, verts=8)
    for i in range(4):
        p.box((0, CY, gz + 0.18), (0.04, 0.48, 0.03), "HlBlack", rot=(0, i * PI / 4, 0), bevel=0.0)

    # Hood sides: louvres, a big rusty gear and a smaller one.
    for s in (-1, 1):
        for i in range(5):
            p.box((s * 1.11, 2.25, hz0 + 0.35 + i * 0.2), (0.05, 0.42, 0.08), "HlGreyDark", rot=(0.4, 0, 0), bevel=0.01)
        rivets(p, s * 1.12, 1.32, 2.62, hz0 + 0.1, hz1 - 0.15)
        p.gear((s * 1.2, 1.88, 1.05), 0.5, 0.16, "HlRust", teeth=14, hub="HlRustDark")
        p.gear((s * 1.22, 1.5, 1.95), 0.3, 0.12, "HlRust", teeth=10, hub="HlRustDark")

    # Front hook arms (yellow), one at each front corner, hook + short chain.
    for s in (-1, 1):
        x = s * 1.3
        base = (x, 2.3, F - 0.45)
        elbow = (x, 2.55, F + 0.2)
        hand = (x, 1.75, F + 0.55)
        p.box(base, (0.26, 0.34, 0.44), "HlYellowDark", bevel=0.04)
        p.rod(base, elbow, 0.15, "HlYellow")
        p.rod(elbow, hand, 0.13, "HlYellow")
        p.rod((x, 2.3, F - 0.2), (x, 2.2, F + 0.45), 0.07, "HlGreyLight")  # hydraulic ram
        p.cyl(elbow, 0.1, 0.2, "HlGreyDark", rot=AXIS_X, verts=12)
        for k in range(3):
            p.torus((x, 1.62 - k * 0.13, F + 0.55), 0.06, 0.018, "HlChain", rot=(PI / 2, 0, (k % 2) * PI / 2))
        p.torus((x, 1.2, F + 0.55), 0.11, 0.035, "HlChain", rot=(PI / 2, 0, PI / 2))
        p.box((x, 1.07, F + 0.55), (0.05, 0.12, 0.1), "HlChain", bevel=0.01)

    # Cab: behind the hood, taller, windows on all sides.
    cz0, cz1 = -0.95, 0.55
    cc = (cz0 + cz1) / 2
    p.box((0, 2.2, cc), (2.2, 2.2, cz1 - cz0), "HlGrey", bevel=0.07, seg=3)
    p.box((0, 3.36, cc), (2.34, 0.14, cz1 - cz0 + 0.2), "HlGreyDark", bevel=0.04)
    p.box((0, 3.47, cc), (1.6, 0.1, cz1 - cz0 - 0.2), "HlGreyLight", bevel=0.03)
    for x in (-0.5, 0.5):
        p.box((x, 2.9, cz1 + 0.02), (0.72, 0.56, 0.06), "HlGlass", bevel=0.02)
        p.box((x, 3.2, cz1 + 0.03), (0.8, 0.07, 0.06), "HlGreyDark", bevel=0.01)
        p.box((x, 3.13, cz1 + 0.05), (0.18, 0.08, 0.05), "HlLampRim", bevel=0.01)
    for s in (-1, 1):
        p.box((s * 1.11, 2.9, cc + 0.15), (0.06, 0.56, 0.8), "HlGlass", bevel=0.02)
        p.box((s * 1.12, 2.9, cc + 0.15), (0.05, 0.64, 0.06), "HlGreyDark", bevel=0.01)
        p.box((s * 1.12, 1.55, cc), (0.06, 0.5, 1.2), "HlHazard", bevel=0.01, stripes=0.42)
        rivets(p, s * 1.12, 1.25, 1.85, cz0 + 0.1, cz1 - 0.1, step=0.3)

    # Twin chimneys on the hood (the key art's smoke columns).
    c0 = chimney(p, -0.42, 2.6, 1.55, 1.55, 0.22)
    c1 = chimney(p, 0.42, 2.6, 1.0, 1.3, 0.19)

    # Rear: engine room with a hazard-striped lower band, ladders and the turret deck.
    rz0, rz1 = -F + 0.1, cz0 - 0.02
    rc = (rz0 + rz1) / 2
    p.box((0, 1.55, rc), (2.1, 1.2, rz1 - rz0), "HlGreyDark", bevel=0.06, seg=3)
    p.box((0, 2.2, rc), (2.2, 0.12, rz1 - rz0 + 0.06), "HlGreyLight", bevel=0.03)
    for s in (-1, 1):
        p.box((s * 1.06, 1.12, rc), (0.06, 0.22, rz1 - rz0 - 0.1), "HlHazard", bevel=0.01, stripes=0.42)
        for i in range(4):
            p.box((s * 1.08, 1.55, rz0 + 0.3 + i * 0.4), (0.04, 0.5, 0.2), "HlBlack", bevel=0.01)
        p.gear((s * 1.12, 1.62, rc), 0.32, 0.1, "HlRust", teeth=10, hub="HlRustDark")
    # Railing around the turret deck.
    for s in (-1, 1):
        p.box((s * 1.0, 2.55, rc), (0.05, 0.05, rz1 - rz0 - 0.1), "HlYellow", bevel=0.01)
        for z in (rz0 + 0.1, rc, rz1 - 0.1):
            p.box((s * 1.0, 2.38, z), (0.05, 0.36, 0.05), "HlYellow", bevel=0.01)

    body = p.join("Body", "HaulerLoco")
    core = p.join("Core", "Core", (0, CY, gz + 0.14))
    parent(core, body)
    for name, loc in (("TurretMount", (0, 2.26, rc)), ("Chimney0", c0), ("Chimney1", c1)):
        e = p.empty(name, loc, "loco")
        parent(e, body)
    for i, ((x, y), _) in enumerate(lights):
        e = p.empty(f"Headlight{i}", (x, y, gz + 0.14), "loco")
        parent(e, body)
    return body, L


# ---------------------------------------------------------------------------------------------
# Red hopper full of coloured cubes (cubes are game objects: shot off, they fall to the floor)
# ---------------------------------------------------------------------------------------------
def build_hopper():
    p = Part()
    L = 4.4
    undercarriage(p, L, [-1.45, 1.45], r=0.42)
    y0, y1 = 0.82, 2.0
    p.box((0, 0.88, 0), (2.25, 0.16, L - 0.1), "HlGreyDark", bevel=0.03)
    # Walls of red planks with dark ribs, a yellow and a blue band near the bottom.
    for s in (-1, 1):
        p.box((s * 1.1, (y0 + y1) / 2 + 0.06, 0), (0.1, y1 - y0, L - 0.1), "HlRed", bevel=0.03)
        for i in range(4):
            p.box((s * 1.155, y0 + 0.28 + i * 0.27, 0), (0.02, 0.025, L - 0.14), "HlRedDark", bevel=0.0)
        for i in range(6):
            p.box((s * 1.17, (y0 + y1) / 2 + 0.06, -L / 2 + 0.25 + i * (L - 0.5) / 5), (0.07, y1 - y0 + 0.04, 0.12), "HlRedDark", bevel=0.02)
        p.box((s * 1.16, y0 + 0.2, 0), (0.04, 0.12, L - 0.2), "HlGold", bevel=0.01)
        p.box((s * 1.16, y0 + 0.08, 0), (0.04, 0.1, L - 0.2), "HlBlue", bevel=0.01)
    for s in (-1, 1):
        p.box((0, (y0 + y1) / 2 + 0.06, s * (L / 2 - 0.05)), (2.3, y1 - y0, 0.1), "HlRed", bevel=0.03)
        p.box((0, y1 + 0.08, s * (L / 2 - 0.05)), (2.36, 0.08, 0.14), "HlRedDark", bevel=0.02)
    for s in (-1, 1):
        p.box((s * 1.13, y1 + 0.08, 0), (0.14, 0.08, L), "HlRedDark", bevel=0.02)
    # Inner cube floor (the cubes sit on it, their tops poke out above the walls).
    deck = 1.35
    p.box((0, deck - 0.05, 0), (2.1, 0.1, L - 0.25), "HlWood", bevel=0.01)
    body = p.join("Body", "HaulerHopper")
    e = p.empty("CargoDeck", (0, deck, 0), "hopper")
    parent(e, body)
    return body, L


# ---------------------------------------------------------------------------------------------
# Crane car: yellow slewing crane, lattice boom, chain + wrecking ball
# ---------------------------------------------------------------------------------------------
def build_crane():
    p = Part()
    L = 4.6
    undercarriage(p, L, [-1.5, 1.5], r=0.42)
    p.box((0, 0.92, 0), (2.25, 0.2, L - 0.1), "HlGreyDark", bevel=0.03)
    p.box((0, 1.04, 0), (2.28, 0.05, L - 0.06), "HlHazard", bevel=0.0, stripes=0.42)
    # Outriggers (stabiliser legs) folded at the sides.
    for s in (-1, 1):
        for z in (-1.4, 1.4):
            p.box((s * 1.2, 0.9, z), (0.3, 0.16, 0.22), "HlYellowDark", bevel=0.02)
            p.box((s * 1.32, 0.62, z), (0.1, 0.5, 0.1), "HlGreyLight", bevel=0.01)
    # Turntable (static) + slewing part (cab, counterweight, boom).
    sz = -0.55
    p.cyl((0, 1.15, sz), 0.95, 0.18, "HlBlack", verts=28)
    p.cyl((0, 1.27, sz), 0.85, 0.08, "HlYellowDark", verts=28)
    S = "Slew"
    p.box((0, 1.6, sz - 0.35), (1.5, 0.6, 1.6), "HlYellow", group=S, bevel=0.05, seg=3)
    p.box((0, 1.33, sz - 1.25), (1.4, 0.7, 0.5), "HlGreyDark", group=S, bevel=0.05)  # counterweight
    p.box((0, 1.33, sz - 1.25), (1.44, 0.16, 0.54), "HlHazard", group=S, bevel=0.01, stripes=0.42)
    p.box((0.42, 2.3, sz + 0.05), (0.62, 0.85, 0.8), "HlYellow", group=S, bevel=0.05, seg=3)  # cab
    p.box((0.42, 2.38, sz + 0.46), (0.5, 0.42, 0.04), "HlGlass", group=S, bevel=0.01)
    p.box((0.74, 2.38, sz + 0.05), (0.04, 0.42, 0.55), "HlGlass", group=S, bevel=0.01)
    p.box((0.42, 2.76, sz + 0.05), (0.7, 0.07, 0.88), "HlYellowDark", group=S, bevel=0.02)
    p.box((-0.35, 2.05, sz - 0.6), (0.3, 0.3, 0.3), "HlGreyDark", group=S, bevel=0.03)  # winch drum housing
    p.cyl((-0.35, 2.05, sz - 0.6), 0.2, 0.5, "HlChain", group=S, rot=AXIS_X, verts=16)
    # Boom: lattice of 4 chords + braces, from the pivot up and forward.
    pivot = Vector((-0.25, 2.0, sz + 0.25))
    ang = math.radians(52)
    length = 3.3
    d = Vector((0, math.sin(ang), math.cos(ang)))
    tip = pivot + d * length
    side = Vector((1, 0, 0))
    up_n = Vector((0, math.cos(ang), -math.sin(ang)))
    w0, w1 = 0.22, 0.12  # half width at the base / tip

    def chord(sx, sy):
        a = pivot + side * (sx * w0) + up_n * (sy * w0)
        b = tip + side * (sx * w1) + up_n * (sy * w1)
        mid = (a + b) / 2
        dv = b - a
        rot = (math.atan2(dv.y, dv.z), 0, 0)  # pitch about X (three Z->Y)
        p.box(tuple(mid), (0.07, 0.07, dv.length), "HlYellow", group=S, rot=(-rot[0], 0, 0), bevel=0.01)

    for sx in (-1, 1):
        for sy in (-1, 1):
            chord(sx, sy)
    # Braces along the boom (cross pieces).
    n = 7
    for i in range(1, n):
        t = i / n
        c = pivot + d * (length * t)
        w = w0 + (w1 - w0) * t
        p.box(tuple(c + up_n * w), (2 * w, 0.04, 0.04), "HlYellowDark", group=S, rot=(-ang, 0, 0), bevel=0.0)
        p.box(tuple(c - up_n * w), (2 * w, 0.04, 0.04), "HlYellowDark", group=S, rot=(-ang, 0, 0), bevel=0.0)
        for sx in (-1, 1):
            p.box(tuple(c + side * (sx * w)), (0.04, 2 * w, 0.04), "HlYellowDark", group=S, rot=(-ang, 0, 0), bevel=0.0)
    # Boom foot + tip sheave.
    p.cyl(tuple(pivot), 0.12, 0.6, "HlGreyDark", group=S, rot=AXIS_X, verts=14)
    p.cyl(tuple(tip), 0.16, 0.2, "HlGreyDark", group=S, rot=AXIS_X, verts=18)
    p.cyl(tuple(tip), 0.08, 0.3, "HlSteel", group=S, rot=AXIS_X, verts=12)
    # Support cable from the cab top to the boom tip (two thin rods).
    a = Vector((-0.25, 2.75, sz - 0.6))
    for sx in (-0.08, 0.08):
        aa = a + Vector((sx, 0, 0))
        bb = tip + Vector((sx, 0, 0)) - d * 0.05
        dv = bb - aa
        mid = (aa + bb) / 2
        p.box(tuple(mid), (0.025, 0.025, dv.length), "HlChain", group=S, rot=(-math.atan2(dv.y, dv.z), 0, 0), bevel=0.0)
    tip_hang = tip + Vector((0, -0.18, 0))

    body = p.join("Body", "HaulerCrane")
    slew = p.join(S, "CraneSlew", (0, 1.27, sz))
    parent(slew, body)
    e = p.empty("CraneTip", tuple(tip_hang), "crane")
    parent(e, slew)

    # Chain: unit length along -Y, alternating links (the game scales it to the swing length).
    C = "Chain"
    links = 9
    for i in range(links):
        y = -(i + 0.5) / links
        p.torus((0, y, 0), 0.055, 0.016, "HlChain", group=C, rot=(PI / 2, 0, (i % 2) * PI / 2))
    chain = p.join(C, "CraneChain", (0, 0, 0))
    # Wrecking ball ("gülle"): iron ball with a band, a cap and a shackle on top. Origin = shackle top.
    W = "Ball"
    r = 0.46
    p.sphere((0, -0.2 - r, 0), r, "HlBall", group=W, seg=24)
    p.cyl((0, -0.2 - r, 0), r + 0.015, 0.12, "HlChain", group=W, verts=28)
    p.cyl((0, -0.22, 0), 0.14, 0.12, "HlChain", group=W, verts=14)
    p.torus((0, -0.08, 0), 0.08, 0.025, "HlSteel", group=W, rot=(PI / 2, 0, 0))
    for k in range(6):
        a = k * PI / 3
        p.box((math.cos(a) * r * 0.75, -0.2 - r * 1.62, math.sin(a) * r * 0.75), (0.06, 0.06, 0.06), "HlRust", group=W, bevel=0.01)
    ball = p.join(W, "WreckingBall", (0, 0, 0))
    # Park the chain and ball under the boom tip for the preview (the game re-parents them).
    chain.location = B(tuple(tip_hang))
    chain.scale = (1, 1, 1.6)  # Blender Z = three Y
    ball.location = B(tuple(tip_hang + Vector((0, -1.6, 0))))
    parent(chain, body)
    parent(ball, body)
    return body, L


# ---------------------------------------------------------------------------------------------
# Cage car with ice blocks, ore hopper
# ---------------------------------------------------------------------------------------------
def build_cage():
    p = Part()
    L = 4.2
    undercarriage(p, L, [-1.4, 1.4], r=0.42, hazard=False)
    p.box((0, 0.92, 0), (2.25, 0.2, L - 0.1), "HlGreyDark", bevel=0.03)
    y0, y1 = 1.02, 2.3
    # Ice blocks inside.
    for (x, z, h) in ((-0.5, -1.3, 1), (0.5, -1.3, 1), (-0.5, -0.4, 1), (0.5, -0.45, 0.85), (-0.5, 0.5, 0.9), (0.5, 0.45, 1), (-0.5, 1.35, 1), (0.5, 1.3, 0.8)):
        p.box((x, y0 + 0.42 * h, z), (0.8, 0.84 * h, 0.8), "HlIce", bevel=0.05)
        if h > 0.95:
            p.box((x, y0 + 0.84 * h + 0.07, z), (0.62, 0.1, 0.62), "HlSnow", bevel=0.04)
    # Frame + bars.
    for s in (-1, 1):
        for z in (-L / 2 + 0.12, 0, L / 2 - 0.12):
            p.box((s * 1.08, (y0 + y1) / 2, z), (0.12, y1 - y0, 0.12), "HlSteel", bevel=0.02)
        for i in range(13):
            z = -L / 2 + 0.25 + i * (L - 0.5) / 12
            p.cyl((s * 1.08, (y0 + y1) / 2, z), 0.03, y1 - y0, "HlSteel", verts=8, bevel=0)
        p.box((s * 1.08, y1, 0), (0.12, 0.12, L - 0.1), "HlSteel", bevel=0.02)
        p.box((s * 1.08, y0 + 0.06, 0), (0.12, 0.12, L - 0.1), "HlSteel", bevel=0.02)
    for s in (-1, 1):
        for i in range(9):
            x = -0.96 + i * 0.24
            p.cyl((x, (y0 + y1) / 2, s * (L / 2 - 0.12)), 0.03, y1 - y0, "HlSteel", verts=8, bevel=0)
        p.box((0, y1, s * (L / 2 - 0.12)), (2.28, 0.12, 0.12), "HlSteel", bevel=0.02)
    # Roof grid + snow, turret deck in the middle.
    for i in range(7):
        x = -0.96 + i * 0.32
        p.box((x, y1 + 0.02, 0), (0.05, 0.05, L - 0.2), "HlSteel", bevel=0.0)
    p.box((0, y1 + 0.06, 0), (1.1, 0.1, 1.1), "HlGreyDark", bevel=0.03)
    p.box((-0.6, y1 + 0.1, 1.4), (0.8, 0.08, 0.9), "HlSnow", bevel=0.04)
    p.box((0.5, y1 + 0.1, -1.5), (0.9, 0.08, 0.7), "HlSnow", bevel=0.04)
    body = p.join("Body", "HaulerCage")
    e = p.empty("TurretMount", (0, y1 + 0.11, 0), "cage")
    parent(e, body)
    return body, L


def build_ore():
    p = Part()
    L = 3.9
    undercarriage(p, L, [-1.25, 1.25], r=0.4, hazard=False)
    p.box((0, 0.9, 0), (2.0, 0.16, L - 0.2), "HlGreyDark", bevel=0.03)
    # Sloped hopper body: a box with slanted end walls.
    p.box((0, 1.65, 0), (2.25, 1.0, L - 0.9), "HlGrey", bevel=0.06, seg=3)
    for s in (-1, 1):
        p.box((0, 1.55, s * (L / 2 - 0.4)), (2.25, 1.0, 0.18), "HlGrey", rot=(s * 0.45, 0, 0), bevel=0.05)
        rivets(p, s * 1.13, 1.3, 2.0, -L / 2 + 0.7, L / 2 - 0.7, step=0.35)
    p.box((0, 2.17, 0), (2.33, 0.1, L - 0.6), "HlGreyLight", bevel=0.03)
    # Dark ore heap on top.
    for (x, z, s) in ((-0.4, -0.5, 0.45), (0.35, 0.4, 0.5), (0.1, -1.0, 0.35), (-0.3, 0.9, 0.38), (0.5, -0.4, 0.33)):
        p.box((x, 2.2 + s * 0.3, z), (s * 1.6, s * 0.7, s * 1.6), "HlGreyDark", rot=(0.2, 0.4, 0.1), bevel=0.06)
    for s in (-1, 1):
        p.gear((s * 1.15, 1.25, 0), 0.3, 0.1, "HlRust", teeth=10, hub="HlRustDark")
    body = p.join("Body", "HaulerOre")
    return body, L


# ---------------------------------------------------------------------------------------------
def export(name):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{name}.glb"), export_format="GLB", export_apply=True, export_yup=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{name}.blend"))


def render(name, cam_pos, target, lens=50, size=(1200, 700)):
    if not RENDER_DIR:
        return
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = os.path.abspath(os.path.join(RENDER_DIR, f"{name}.png"))
    if not sc.world:
        w = bpy.data.worlds.new("W")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.7, 0.95, 1)
        w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 3.4
        sun.rotation_euler = (0.8, -0.3, -0.9)
        sc.collection.objects.link(sun)
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.location = B(cam_pos)
    cam.rotation_euler = (Vector(B(target)) - Vector(B(cam_pos))).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.render.render(write_still=True)


def main():
    reset()
    materials()
    cars = [build_loco(), build_hopper(), build_crane(), build_cage(), build_ore()]
    # Lay the cars out in a row (train order, front first) for the .blend preview; the game
    # re-parents each root at its own place in the train.
    z = 0.0
    for i, (obj, L) in enumerate(cars):
        if i:
            z -= L / 2
        obj.location = B((0, 0, z))
        z -= L / 2 + 0.4
    export("hauler")
    render("hauler_front", (6.5, 4.2, 8.5), (0, 1.6, 0.5), lens=32)
    render("hauler_side", (11, 5.5, -6), (0, 1.5, -7), lens=28, size=(1600, 700))


main()
