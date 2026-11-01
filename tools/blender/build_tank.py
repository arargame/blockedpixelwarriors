"""
Player tank for the tank level (Blender 4.2+/5.x), built part by part to match the Meshy concept
of the Blocked Pixel Panzer main tank (10 views in tools/blender/ref/tank/meshy_*.png):

  * TRACKS: tall loops with big rounded ends, chunky two-pad rubber links all the way round
    (exported as one link template + loop parameters so the game can run them);
  * PODS: a dark side skirt with raised armour panels (three at the back, a stepped split pair at
    the front, a dark latch with two hinge pins between), on top four big bevelled armour tiles on
    a dark base with an orange glow slot after the second tile, twin red tail lamps on the back
    of the rear tile;
  * HULL between the pods: front plate with a dark slot and two small orange lamps, a sloped glacis
    with a raised hatch, an engine block with a raised cover and a slotted rear plate;
  * TURRET: two stacked chamfered blocks, a mantlet with stepped angular cheeks either side, big
    + small octagonal discs on each side, a sloped orange glow strip along each rear flank, a
    framed rear panel with two stacked amber lamps on each rear corner, a blue lens behind the
    barrel root;
  * BARREL: a long chamfered square tube with a collar and a chunky muzzle block with a dark bore.

Pixel camouflage (mid / dark / light greens, nearest filtering) with the light green highlight on
every bevel, as in the concept.

    python tools/blender/build_tank.py [--render out_dir] [--card out.png]
        --render  the ten Meshy reference angles (TANK_VIEWS=01,05 limits them)
        --card    the main-menu card painting (square, tank on a test range at golden hour)

Output: assets/models/tank.glb (+ tank.blend). Hierarchy (three.js axes, front = +Z):
  Tank              root on the ground under the hull centre; extras.track = loop parameters
    TankHull        pods, skirts, hull, track cores (static)
    TankLink        one track link (template; the game instances it round both loops)
    TankTurret      turns about +Y (origin = turret ring centre)
      TankBarrel    recoils along its own axis (origin = trunnion)
        TankMuzzle  empty at the muzzle (shell spawn point)
Blinking lamps use their own materials: TankRed (tail lamps), TankAmber (turret rear lamps).
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER_DIR = argv[argv.index("--render") + 1] if "--render" in argv else None
CARD = argv[argv.index("--card") + 1] if "--card" in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "models")
PI = math.pi

# Layout (three.js units).
POD_X = 1.44           # pod / track centre line
POD_W = 1.12           # pod armour width
TRACK_W = 1.02
TRACK = dict(yc=0.72, r=0.66, zc=1.72, spacing=0.27)   # loop centre height, end radius, half straight
DECK_Y = 1.55          # hull deck (turret sits on it)
TILE_Y0, TILE_Y1 = 1.5, 2.0
BARREL_PITCH = math.radians(28)
TRUNNION = (0.0, 2.55, 1.2)
RING = (0.0, DECK_Y, -0.25)
MUZZLE_Z = 4.2

# three.js (x, y up, z front) -> Blender (x, -z, y)
T2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def tb(p):
    return (T2B @ Vector(p).to_4d()).to_3d()


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


MATS = {}


def camo_image():
    """Pixel camouflage: clustered blocks of four close greens (Meshy concept palette)."""
    size = 64
    img = bpy.data.images.new("TankCamo", size, size)
    rnd = random.Random(7)
    pal = [srgb(0x78A24A), srgb(0x84AC54), srgb(0x6A9442), srgb(0x92BA5E)]
    grid = [[0] * size for _ in range(size)]
    for _ in range(620):
        c = rnd.choice((1, 1, 2, 2, 2, 3))
        x, y = rnd.randrange(size), rnd.randrange(size)
        w, h = rnd.choice(((2, 2), (3, 2), (2, 3), (3, 3), (4, 2), (2, 4), (1, 2), (2, 1)))
        for dy in range(h):
            for dx in range(w):
                grid[(y + dy) % size][(x + dx) % size] = c
    px = []
    for y in range(size):
        for x in range(size):
            px.extend(pal[grid[y][x]])
    img.pixels = px
    img.pack()
    return img


def mat(name, hexv=None, rough=0.55, metal=0.0, emit=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(hexv)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m


EDGE_OF = {"TankCamo": "TankEdge", "TankTread": "TankTreadEdge", "TankDark": "TankDarkEdge"}


class Builder:
    """Collects boxes / prisms (three.js coordinates) into one bmesh per (part, material, bevel)."""

    def __init__(self):
        self.groups = {}

    def _bm(self, part, m, bevel, edge):
        key = (part, m, round(bevel, 3), edge)
        if key not in self.groups:
            self.groups[key] = bmesh.new()
        return self.groups[key]

    def _emit(self, bm, pts, faces):
        vs = [bm.verts.new(tb(p)) for p in pts]
        for f in faces:
            bm.faces.new([vs[i] for i in f])

    def _edge(self, m, edge, bevel):
        if edge is None:
            edge = bevel > 0 and m in EDGE_OF
        return edge

    def box(self, part, m, c, s, bevel=0.06, inset=(0, 0, 0, 0), rot=(0, 0, 0), xf=None, edge=None):
        """Box at c (size s). inset = top face pulled in at (x-, x+, z-, z+)."""
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        il, ir, ib, iff = inset
        local = [
            Vector((-hx, -hy, -hz)), Vector((hx, -hy, -hz)), Vector((hx, -hy, hz)), Vector((-hx, -hy, hz)),
            Vector((-hx + il, hy, -hz + ib)), Vector((hx - ir, hy, -hz + ib)), Vector((hx - ir, hy, hz - iff)), Vector((-hx + il, hy, hz - iff)),
        ]
        M = Matrix.Translation(Vector(c)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
        if xf is not None:
            M = xf @ M
        pts = [M @ p for p in local]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._emit(self._bm(part, m, bevel, self._edge(m, edge, bevel)), pts, faces)

    def obox(self, part, m, c, s, cut=0.3, top=0.08, bevel=0.08, front_top=0.0, edge=None):
        """Box with chamfered vertical corners (octagonal footprint); top face pulled in by `top`
        (and by `front_top` more at the front)."""
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2

        def ring(ex, ez0, ez1, y):
            return [Vector(p) for p in ((-ex + cut, y, ez0), (ex - cut, y, ez0), (ex, y, ez0 + cut), (ex, y, ez1 - cut),
                                        (ex - cut, y, ez1), (-ex + cut, y, ez1), (-ex, y, ez1 - cut), (-ex, y, ez0 + cut))]
        lo = ring(hx, -hz, hz, -hy)
        hi = ring(hx - top, -hz + top, hz - top - front_top, hy)
        pts = [Vector(c) + p for p in lo + hi]
        faces = [tuple(range(7, -1, -1)), tuple(range(8, 16))]
        for i in range(8):
            j = (i + 1) % 8
            faces.append((i, j, 8 + j, 8 + i))
        self._emit(self._bm(part, m, bevel, self._edge(m, edge, bevel)), pts, faces)

    def poly_x(self, part, m, x0, x1, zy, bevel=0.04, edge=None):
        """Prism along x (from x0 to x1) through a convex (z, y) outline."""
        n = len(zy)
        pts = [Vector((x0, y, z)) for z, y in zy] + [Vector((x1, y, z)) for z, y in zy]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        self._emit(self._bm(part, m, bevel, self._edge(m, edge, bevel)), pts, faces)

    def prism(self, part, m, c, r, length, axis="z", sides=8, bevel=0.03, spin=PI / 8, xf=None, edge=None):
        """Regular n-gon prism along a three.js axis."""
        ring = [(math.cos(spin + i * 2 * PI / sides) * r, math.sin(spin + i * 2 * PI / sides) * r) for i in range(sides)]
        pts = []
        for h in (-length / 2, length / 2):
            for u, v in ring:
                pts.append({"z": Vector((u, v, h)), "x": Vector((h, u, v)), "y": Vector((u, h, v))}[axis])
        M = Matrix.Translation(Vector(c))
        if xf is not None:
            M = xf @ M
        pts = [M @ p for p in pts]
        n = sides
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        self._emit(self._bm(part, m, bevel, self._edge(m, edge, bevel)), pts, faces)

    def objects(self):
        out = {}
        for (part, m, bevel, edge), bm in self.groups.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f"{part}_{m}")
            bm.to_mesh(me)
            bm.free()
            o = bpy.data.objects.new(me.name, me)
            bpy.context.scene.collection.objects.link(o)
            o.data.materials.append(MATS[m])
            if edge:
                # Bevels in the light edge colour: the concept's highlighted armour outlines.
                o.data.materials.append(MATS[EDGE_OF[m]])
            if bevel > 0:
                mod = o.modifiers.new("Bevel", "BEVEL")
                mod.width = bevel
                mod.segments = 3 if bevel >= 0.06 else 2
                mod.limit_method = "ANGLE"
                mod.angle_limit = math.radians(35)
                mod.use_clamp_overlap = True
                if edge:
                    mod.material = 1
            out.setdefault(part, []).append(o)
        return out


# ---------------------------------------------------------------------------------------------
# Tracks
# ---------------------------------------------------------------------------------------------

def loop_points():
    """Positions round the loop: list of (z, y, angle) for every link (angle 0 = bottom run)."""
    yc, R, zc, sp = TRACK["yc"], TRACK["r"], TRACK["zc"], TRACK["spacing"]
    straight = 2 * zc
    arc = PI * R
    perim = 2 * straight + 2 * arc
    n = round(perim / sp)
    out = []
    for k in range(n):
        d = k * perim / n
        if d < straight:
            z, y, ang = -zc + d, yc - R, 0.0
        elif d < straight + arc:
            a = (d - straight) / R
            z, y, ang = zc + math.sin(a) * R, yc - math.cos(a) * R, a
        elif d < 2 * straight + arc:
            z, y, ang = zc - (d - straight - arc), yc + R, PI
        else:
            a = (d - 2 * straight - arc) / R
            z, y, ang = -zc - math.sin(a) * R, yc + math.cos(a) * R, PI + a
        out.append((z, y, ang))
    return out, perim


def link(b, part):
    """One chunky link (centred on its pivot): two rubber pads side by side on a dark plate."""
    b.box(part, "TankDark", (0, 0.03, 0), (TRACK_W - 0.04, 0.07, 0.2), 0.02, edge=False)
    for dx in (-0.245, 0.245):
        b.box(part, "TankTread", (dx, -0.03, 0), (0.46, 0.13, 0.23), 0.04)


def track_core(b, side):
    cx = side * POD_X
    yc, R, zc = TRACK["yc"], TRACK["r"], TRACK["zc"]
    core_r = R - 0.1
    b.box("hull", "TankTreadCore", (cx, yc, 0), (TRACK_W - 0.08, 2 * core_r, 2 * zc), 0.02, edge=False)
    for z in (zc, -zc):
        b.prism("hull", "TankTreadCore", (cx, yc, z), core_r, TRACK_W - 0.08, axis="x", sides=16, bevel=0.02, spin=0, edge=False)
        # Sprocket / idler hubs on the inner face.
        b.prism("hull", "TankMetal", (cx - side * (TRACK_W / 2 - 0.02), yc, z), 0.26, 0.06, axis="x", sides=10, bevel=0.015, edge=False)
        b.prism("hull", "TankDark", (cx - side * (TRACK_W / 2 + 0.01), yc, z), 0.1, 0.05, axis="x", sides=8, bevel=0.01, edge=False)
    # Road wheels along the bottom run, inner face.
    for z in (-0.95, -0.32, 0.32, 0.95):
        b.prism("hull", "TankMetal", (cx - side * (TRACK_W / 2 - 0.02), yc - 0.2, z), 0.2, 0.06, axis="x", sides=10, bevel=0.015, edge=False)


# ---------------------------------------------------------------------------------------------
# Pods (skirts + armour tiles)
# ---------------------------------------------------------------------------------------------

def skirt(b, side):
    out = side * (POD_X + POD_W / 2)
    # Dark backing plate (the grooves between the panels are this plate showing through).
    x0, x1 = sorted((out - side * 0.13, out - side * 0.03))
    b.poly_x("hull", "TankDark", x0, x1, [(-2.12, 0.4), (2.05, 0.4), (2.18, 0.52), (2.18, 1.5), (2.05, 1.58), (-2.12, 1.58)], 0.02, edge=False)
    # Raised panels.
    p0, p1 = sorted((out - side * 0.05, out + side * 0.04))
    panels = [
        # back: three side by side, the last with its top-back corner cut
        [(-2.08, 0.46), (-1.5, 0.46), (-1.5, 1.52), (-1.9, 1.52), (-2.08, 1.36)],
        [(-1.44, 0.46), (-0.92, 0.46), (-0.92, 1.52), (-1.44, 1.52)],
        [(-0.86, 0.46), (-0.3, 0.46), (-0.3, 1.0), (-0.42, 1.12), (-0.42, 1.52), (-0.86, 1.52)],
        # front: a stepped split pair
        [(0.26, 0.46), (1.86, 0.46), (2.12, 0.6), (2.12, 0.8), (1.22, 0.8), (0.88, 1.08), (0.26, 1.08)],
        [(0.26, 1.15), (0.91, 1.15), (1.25, 0.87), (2.12, 0.87), (2.12, 1.36), (1.94, 1.52), (0.26, 1.52)],
    ]
    for zy in panels:
        b.poly_x("hull", "TankCamo", p0, p1, zy, 0.035)
    # Latch between the panel groups: dark block, two hinge pins.
    b.box("hull", "TankDark", (out + side * 0.02, 1.2, -0.02), (0.16, 0.34, 0.42), 0.03, edge=False)
    for z in (-0.12, 0.08):
        b.prism("hull", "TankMetal", (out + side * 0.1, 1.2, z), 0.08, 0.1, axis="x", sides=10, bevel=0.015, edge=False)
    b.box("hull", "TankDark", (out + side * 0.02, 0.62, -0.02), (0.12, 0.5, 0.18), 0.02, edge=False)


def pod(b, side):
    cx = side * POD_X
    track_core(b, side)
    skirt(b, side)
    # Dark base under the tiles (shows in the gaps), inner wall down to the deck.
    b.box("hull", "TankDark", (cx, 1.47, 0), (POD_W - 0.04, 0.12, 4.32), 0.02, edge=False)
    b.box("hull", "TankCamo", (cx - side * (POD_W / 2 - 0.08), 1.15, 0), (0.16, 0.7, 3.0), 0.04)
    # Big tiles: back (tail lamps), second, [orange slot], third, front (sloped nose).
    tiles = (
        (-2.26, -1.26, (0.05, 0.05, 0.12, 0.05)),
        (-1.2, -0.6, (0.05, 0.05, 0.05, 0.05)),
        (-0.26, 0.96, (0.05, 0.05, 0.05, 0.05)),
        (1.02, 2.12, (0.05, 0.05, 0.05, 0.42)),
    )
    for z0, z1, ins in tiles:
        b.box("hull", "TankCamo", (cx, (TILE_Y0 + TILE_Y1) / 2, (z0 + z1) / 2), (POD_W + 0.06, TILE_Y1 - TILE_Y0, z1 - z0), 0.1, inset=ins)
    # Front face of the nose tile reaches down over the track (tall plate, as in the concept).
    b.box("hull", "TankCamo", (cx, 1.48, 2.08), (POD_W + 0.02, 0.5, 0.16), 0.06, inset=(0.03, 0.03, 0.0, 0.08))
    # Orange glow slot (recessed between the 2nd and 3rd tiles) and its dark bracket.
    b.box("hull", "TankGlow", (cx, 1.7, -0.43), (POD_W - 0.1, 0.3, 0.24), 0.02)
    b.box("hull", "TankDark", (cx, 1.6, -0.43), (POD_W - 0.04, 0.16, 0.34), 0.02, edge=False)
    # Twin tail lamps on the back of the rear tile, in a dark frame.
    b.box("hull", "TankDark", (cx, 1.76, -2.27), (0.82, 0.26, 0.05), 0.02, edge=False)
    for dx in (-0.19, 0.19):
        b.box("hull", "TankRed", (cx + dx, 1.76, -2.3), (0.3, 0.16, 0.05), 0.015)
    # Small orange marker lamp low on the front of the pod (inner corner).
    b.box("hull", "TankGlow", (cx - side * 0.36, 1.32, 2.14), (0.07, 0.2, 0.05), 0.01)


# ---------------------------------------------------------------------------------------------
# Hull
# ---------------------------------------------------------------------------------------------

def hull(b):
    for side in (-1, 1):
        pod(b, side)
    hw = POD_X - POD_W / 2 + 0.02        # half width between the pods
    b.box("hull", "TankCamo", (0, 0.95, -0.02), (2 * hw, 1.2, 4.1), 0.06)
    # Front plate: dark slot, two small orange lamps.
    b.box("hull", "TankCamo", (0, 0.98, 2.04), (2 * hw - 0.1, 0.9, 0.16), 0.06)
    b.box("hull", "TankDark", (0, 0.92, 2.12), (0.95, 0.1, 0.04), 0.015, edge=False)
    for dx in (-0.66, 0.66):
        b.box("hull", "TankDark", (dx, 0.96, 2.12), (0.16, 0.28, 0.04), 0.015, edge=False)
        b.box("hull", "TankGlow", (dx, 0.96, 2.14), (0.08, 0.2, 0.04), 0.01)
    # Underside plates.
    for z, l in ((1.1, 1.2), (-0.35, 1.4), (-1.55, 0.7)):
        b.box("hull", "TankCamo", (0, 0.3, z), (1.3, 0.1, l), 0.04)
    # Lower nose lip.
    b.box("hull", "TankCamo", (0, 0.52, 1.98), (2 * hw - 0.2, 0.2, 0.2), 0.05)
    # Sloped glacis with a raised hatch.
    b.box("hull", "TankCamo", (0, 1.5, 1.45), (2 * hw - 0.06, 0.18, 1.2), 0.07, inset=(0.04, 0.04, 0.0, 0.5))
    b.box("hull", "TankCamo", (0, 1.62, 1.4), (0.95, 0.16, 0.6), 0.05, inset=(0.06, 0.06, 0.06, 0.12))
    # Engine block: raised cover and grille, slotted rear plate.
    b.box("hull", "TankCamo", (0, 1.62, -1.62), (2 * hw - 0.1, 0.3, 0.9), 0.07, inset=(0.05, 0.05, 0.08, 0.05))
    b.box("hull", "TankCamo", (0, 1.82, -1.66), (0.9, 0.14, 0.5), 0.04, inset=(0.04, 0.04, 0.04, 0.04))
    b.box("hull", "TankCamo", (0, 1.0, -2.1), (2 * hw - 0.1, 0.95, 0.14), 0.06)
    b.box("hull", "TankDark", (0, 0.86, -2.18), (0.85, 0.08, 0.04), 0.012, edge=False)
    for dx in (-0.62, 0.62):
        b.box("hull", "TankCamo", (dx, 1.28, -2.2), (0.36, 0.24, 0.08), 0.03)


# ---------------------------------------------------------------------------------------------
# Turret
# ---------------------------------------------------------------------------------------------

def turret(b):
    """A wedge: low at the back, tall at the front (side profile of the concept), layered side
    plates, the orange strip along the sloped rear flank."""
    hw = 0.92
    # Plinth between the pods, then the body overhanging the pod tiles.
    b.poly_x("turret", "TankCamo", -0.84, 0.84, [(-1.45, DECK_Y), (1.0, DECK_Y), (1.0, 2.08), (-1.45, 2.08)], 0.05)
    prof = [(-1.55, 2.02), (1.05, 2.02), (1.05, 2.75), (0.88, 2.95), (-0.15, 2.95), (-1.4, 2.36), (-1.55, 2.24)]
    b.poly_x("turret", "TankCamo", -hw, hw, prof, 0.09)
    # Top: plate at the front, a raised hatch block with a dark recess over the sloped back.
    b.box("turret", "TankCamo", (0, 3.0, 0.5), (1.24, 0.14, 0.9), 0.05, inset=(0.06, 0.06, 0.06, 0.06))
    rise = math.atan2(0.59, 1.25)
    hatch = Matrix.Translation(Vector((0, 2.74, -0.62))) @ Euler((rise, 0, 0), "XYZ").to_matrix().to_4x4()
    b.box("turret", "TankCamo", (0, 0.04, 0), (1.12, 0.16, 1.0), 0.05, inset=(0.05, 0.05, 0.05, 0.05), xf=hatch)
    b.box("turret", "TankDark", (0, 0.1, 0.0), (0.6, 0.08, 0.5), 0.02, xf=hatch, edge=False)
    for side in (-1, 1):
        x0, x1 = sorted((side * hw, side * (hw + 0.1)))
        # Layered side plate (a little inside the main outline).
        b.poly_x("turret", "TankCamo", x0, x1, [(-1.32, 2.08), (0.95, 2.08), (0.95, 2.6), (0.76, 2.8), (-0.12, 2.8), (-1.22, 2.3), (-1.32, 2.2)], 0.05)
        # Orange glow strip along the sloped rear flank, set into the side plate.
        g0, g1 = sorted((side * (hw - 0.02), side * (hw + 0.035)))
        b.poly_x("turret", "TankGlow", g0, g1, [(-1.2, 2.31), (-0.2, 2.76), (-0.2, 2.87), (-1.3, 2.36)], 0.0)
        # Big + small octagonal discs at the front of the flank.
        sx = side * (hw + 0.16)
        b.prism("turret", "TankCamo", (sx, 2.55, 0.55), 0.37, 0.16, axis="x", sides=8, bevel=0.04)
        b.prism("turret", "TankCamo", (sx + side * 0.09, 2.55, 0.55), 0.22, 0.08, axis="x", sides=8, bevel=0.03)
        b.prism("turret", "TankDark", (sx + side * 0.135, 2.55, 0.55), 0.1, 0.03, axis="x", sides=8, bevel=0.01)
        b.prism("turret", "TankCamo", (sx - side * 0.02, 2.6, 1.05), 0.23, 0.14, axis="x", sides=8, bevel=0.03)
        b.prism("turret", "TankDark", (sx + side * 0.06, 2.6, 1.05), 0.08, 0.03, axis="x", sides=8, bevel=0.01)
        # Low stowage box under the discs (on the plinth).
        b.box("turret", "TankCamo", (side * 0.8, 1.86, 0.62), (0.14, 0.34, 0.7), 0.04)
        # Stepped cheeks either side of the mantlet (the "pagoda" seen from the front).
        b.box("turret", "TankCamo", (side * 0.55, 2.42, 1.2), (0.36, 0.78, 0.34), 0.06, inset=(0.1 if side > 0 else 0.0, 0.1 if side < 0 else 0.0, 0.0, 0.12))
        b.box("turret", "TankCamo", (side * 0.46, 2.98, 1.1), (0.24, 0.34, 0.28), 0.04, inset=(0.06 if side > 0 else 0.0, 0.06 if side < 0 else 0.0, 0.0, 0.1))
        # Two stacked amber lamps on each rear corner (blink).
        for y in (1.86, 2.08):
            b.box("turret", "TankDark", (side * (hw - 0.14), y + 0.22, -1.56), (0.2, 0.18, 0.1), 0.02, edge=False)
            b.box("turret", "TankAmber", (side * (hw - 0.14), y + 0.22, -1.6), (0.15, 0.13, 0.06), 0.015)
    # Mantlet.
    b.box("turret", "TankCamo", (0, 2.55, 1.22), (0.74, 0.86, 0.4), 0.08, inset=(0.05, 0.05, 0.0, 0.1))
    # Framed rear panel with a dark recess and slot.
    b.box("turret", "TankCamo", (0, 2.1, -1.6), (1.0, 0.36, 0.1), 0.04)
    b.box("turret", "TankDark", (0, 2.1, -1.64), (0.7, 0.2, 0.06), 0.015, edge=False)
    b.box("turret", "TankDark", (0, 2.1, -1.67), (0.44, 0.05, 0.04), 0.0, edge=False)
    # Blue lens on top, behind the barrel root.
    b.box("turret", "TankCamo", (0, 3.12, 0.85), (0.5, 0.16, 0.42), 0.04, inset=(0.04, 0.04, 0.04, 0.04))
    b.box("turret", "TankDark", (0, 3.22, 0.83), (0.4, 0.1, 0.3), 0.02, edge=False)
    b.box("turret", "TankBlue", (0, 3.25, 0.82), (0.3, 0.08, 0.2), 0.02)


def barrel(b):
    """Built along +Z from the trunnion, raised by BARREL_PITCH."""
    xf = Matrix.Translation(Vector(TRUNNION)) @ Euler((-BARREL_PITCH, 0, 0), "XYZ").to_matrix().to_4x4()
    b.box("barrel", "TankCamo", (0, 0, 0.12), (0.6, 0.52, 0.56), 0.07, inset=(0.04, 0.04, 0.0, 0.1), xf=xf)
    b.box("barrel", "TankCamo", (0, 0, 2.0), (0.42, 0.42, 3.3), 0.09, xf=xf)
    b.box("barrel", "TankCamo", (0, 0, 3.62), (0.5, 0.5, 0.14), 0.04, xf=xf)
    b.box("barrel", "TankCamo", (0, 0, 3.94), (0.72, 0.72, 0.6), 0.1, xf=xf)
    b.box("barrel", "TankDark", (0, 0, MUZZLE_Z - 0.03), (0.26, 0.32, 0.1), 0.02, xf=xf, edge=False)


# ---------------------------------------------------------------------------------------------

def box_uv(o, scale=0.24):
    """Cube-projected UVs so the camo pixels tile evenly over every face."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = lp.vert.co
            a, c = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            lp[uv].uv = (a * scale, c * scale)
    bm.to_mesh(me)
    bm.free()


def finalize(objs, name):
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
    box_uv(o)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def set_origin(o, three_pos):
    bpy.context.scene.cursor.location = tb(three_pos)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def build():
    mat("TankCamo", rough=0.55, image=camo_image())
    mat("TankEdge", 0xB8D888, 0.5)
    mat("TankDark", 0x1C2018, 0.7)
    mat("TankDarkEdge", 0x2E3428, 0.7)
    mat("TankTread", 0x2A2B2D, 0.8)
    mat("TankTreadEdge", 0x5B5E62, 0.6, 0.2)
    mat("TankTreadCore", 0x141517, 0.9)
    mat("TankMetal", 0x4A4E50, 0.4, 0.7)
    mat("TankGlow", 0xFF6A14, 0.3, 0.0, 1.8)
    mat("TankRed", 0xFF2A10, 0.3, 0.0, 2.5)
    mat("TankAmber", 0xFFB030, 0.3, 0.0, 2.5)
    mat("TankBlue", 0x2CC4FF, 0.2, 0.0, 3.0)
    b = Builder()
    hull(b)
    turret(b)
    barrel(b)
    link(b, "link")
    parts = b.objects()
    hull_o = finalize(parts["hull"], "TankHull")
    turret_o = finalize(parts["turret"], "TankTurret")
    barrel_o = finalize(parts["barrel"], "TankBarrel")
    link_o = finalize(parts["link"], "TankLink")
    set_origin(turret_o, RING)
    set_origin(barrel_o, TRUNNION)
    root = bpy.data.objects.new("Tank", None)
    bpy.context.scene.collection.objects.link(root)
    pts, perim = loop_points()
    root["track"] = json.dumps({"x": [-POD_X, POD_X], "yc": TRACK["yc"], "r": TRACK["r"], "zc": TRACK["zc"], "count": len(pts), "perimeter": round(perim, 5)})
    muzzle = bpy.data.objects.new("TankMuzzle", None)
    bpy.context.scene.collection.objects.link(muzzle)
    tip = Matrix.Translation(Vector(TRUNNION)) @ Euler((-BARREL_PITCH, 0, 0), "XYZ").to_matrix().to_4x4() @ Vector((0, 0, MUZZLE_Z, 1))
    muzzle.location = (T2B @ tip).to_3d()
    # matrix_world is only refreshed by a view-layer update (the muzzle was just placed).
    bpy.context.view_layer.update()
    for child, parent in ((hull_o, root), (link_o, root), (turret_o, root), (barrel_o, turret_o), (muzzle, barrel_o)):
        mw = child.matrix_world.copy()
        child.parent = parent
        child.matrix_world = mw
    bpy.context.view_layer.update()
    return root, link_o, pts


def preview_links(link_o, pts):
    """Instances of the link round both loops (Blender preview / renders only, not exported)."""
    col = bpy.data.collections.new("TrackPreview")
    bpy.context.scene.collection.children.link(col)
    for side in (-1, 1):
        for z, y, ang in pts:
            o = bpy.data.objects.new("LinkPreview", link_o.data)
            col.objects.link(o)
            M = Matrix.Translation(Vector((side * POD_X, y, z))) @ Euler((-ang, 0, 0), "XYZ").to_matrix().to_4x4()
            o.matrix_world = T2B @ M @ T2B.inverted()
    link_o.hide_render = True
    link_o.hide_set(True)
    return col


def render_card(path):
    """Menu card art: 3/4 front view, low sun, a concrete pad fading into haze."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.render.resolution_x = sc.render.resolution_y = 960
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    w = bpy.data.worlds.get("CardWorld") or bpy.data.worlds.new("CardWorld")
    sc.world = w
    w.use_nodes = True
    nt_w = w.node_tree
    sky = nt_w.nodes.new("ShaderNodeTexSky") if hasattr(bpy.types, "ShaderNodeTexSky") else None
    if sky is not None:
        try:
            sky.sky_type = "NISHITA"
            sky.sun_elevation = math.radians(12)
            sky.sun_rotation = math.radians(220)
        except Exception:
            pass
        nt_w.links.new(sky.outputs["Color"], nt_w.nodes["Background"].inputs["Color"])
    else:
        nt_w.nodes["Background"].inputs["Color"].default_value = (0.75, 0.55, 0.4, 1)
    nt_w.nodes["Background"].inputs["Strength"].default_value = 0.35
    for o in [o for o in sc.objects if o.type in ("LIGHT", "CAMERA") or o.name == "CardGround"]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "CardGround"
    gm = bpy.data.materials.new("CardGround")
    gm.use_nodes = True
    nt = gm.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = srgb(0x4E5442)
    ramp.color_ramp.elements[1].color = srgb(0x7A7C66)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    g.data.materials.append(gm)
    sun = bpy.data.objects.new("CardSun", bpy.data.lights.new("CardSun", "SUN"))
    sun.data.energy = 4.5
    sun.data.angle = 0.06
    sun.data.color = (1.0, 0.78, 0.55)
    sun.rotation_euler = (math.radians(68), 0, math.radians(-150))
    sc.collection.objects.link(sun)
    rim = bpy.data.objects.new("CardRim", bpy.data.lights.new("CardRim", "SUN"))
    rim.data.energy = 1.2
    rim.data.color = (0.7, 0.8, 1.0)
    rim.rotation_euler = (math.radians(55), 0, math.radians(30))
    sc.collection.objects.link(rim)
    cam = bpy.data.objects.new("CardCam", bpy.data.cameras.new("CardCam"))
    cam.data.lens = 32
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0.2, -0.9, 1.9))
    cam.location = target + Vector((-0.58, -0.78, 0.2)).normalized() * 9.0
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    root, link_o, pts = build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "tank.glb")), export_format="GLB", export_yup=True, use_selection=True, export_extras=True)
    preview_links(link_o, pts)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "tank.blend")))
    if RENDER_DIR:
        os.makedirs(RENDER_DIR, exist_ok=True)
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 40
        sc.render.resolution_x, sc.render.resolution_y = 800, 600
        sc.view_settings.view_transform = "Standard"
        sc.render.film_transparent = True
        w = bpy.data.worlds.new("W")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.05, 0.06, 1)
        w.node_tree.nodes["Background"].inputs["Strength"].default_value = 2.2
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 2.6
        sun.data.angle = 0.3
        sun.rotation_euler = (0.6, 0.0, -0.9)
        sc.collection.objects.link(sun)
        fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "SUN"))
        fill.data.energy = 0.9
        fill.rotation_euler = (1.0, 0.0, 2.4)
        sc.collection.objects.link(fill)
        cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
        cam.data.lens = 50
        sc.collection.objects.link(cam)
        sc.camera = cam
        # View directions (Blender coords; front = -Y, left = -X) of the ten Meshy reference shots.
        views = {
            "01": (0.85, -0.25, 0.62),
            "02": (0.45, -0.05, 0.9),
            "03": (0.0, 0.88, 0.48),
            "04": (-0.62, 0.62, 0.48),
            "05": (-1.0, 0.0, 0.16),
            "06": (-0.62, -0.72, 0.32),
            "07": (0.0, -1.0, 0.24),
            "08": (0.05, 0.0, -1.0),
            "09": (0.0, 1.0, 0.04),
            "10": (0.3, 0.8, 0.6),
        }
        target = Vector((0, -0.6, 1.7))
        only = os.environ.get("TANK_VIEWS")
        for name, d in views.items():
            if only and name not in only.split(","):
                continue
            cam.location = target + Vector(d).normalized() * 14.5
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.abspath(os.path.join(RENDER_DIR, f"tank_{name}.png"))
            bpy.ops.render.render(write_still=True)
    if CARD:
        render_card(CARD)
    print("tank done")


main()
