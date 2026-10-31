"""
Plasma bolts for the T (triple fire) and D (8-way burst) power-ups (Blender 4.2+/5.x).

    python tools/blender/build_plasma.py [--render out.png]
or inside Blender: Scripting tab > Open > this file > Run Script.

Exports assets/models/plasma.glb (+ .blend) with two roots:
  PlasmaBolt  T shots: faceted magenta crystal head with a white-hot core, two cyan energy rings,
              a blue tapered tail wrapped by three twisted fins.
  NovaBolt    D shots: the same bolt in ice blue / white.
Each bolt points along +Y in Blender (= -Z forward in glTF / three.js), ~1.5 units long with the
head at the origin end; the game spins it about its axis so the fins and rings read as 3D.
Every material is emissive (the bloom gives the glow).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models")


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


def mat(name, hexv, emit, rough=0.25):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Emission Color"].default_value = srgb(hexv)
    b.inputs["Emission Strength"].default_value = emit
    return m


def link(obj, m):
    obj.data.materials.append(m)
    return obj


def crystal(y, radius, length, m, facets=6):
    """Faceted bipyramid (two cones base to base) along +Y, widest at `y`."""
    objs = []
    for sign, depth in ((1, length * 0.62), (-1, length * 0.38)):
        bpy.ops.mesh.primitive_cone_add(vertices=facets, radius1=radius, radius2=0, depth=depth,
                                        location=(0, y + sign * depth / 2, 0), rotation=(-sign * math.pi / 2, 0, 0))
        o = bpy.context.active_object
        link(o, m)
        objs.append(o)
    return objs


def ring(y, major, minor, tilt, m):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=32, minor_segments=8,
                                     location=(0, y, 0), rotation=(math.pi / 2 + tilt, 0, tilt * 0.6))
    return link(bpy.context.active_object, m)


def tail(y0, y1, r0, m):
    depth = y0 - y1
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=r0, radius2=0.0, depth=depth,
                                    location=(0, (y0 + y1) / 2, 0), rotation=(math.pi / 2, 0, 0))
    return link(bpy.context.active_object, m)


def fin(angle, y0, y1, width, m, turns=0.9):
    """Thin ribbon along the tail, tapering and twisting around the axis."""
    me = bpy.data.meshes.new("Fin")
    bm = bmesh.new()
    steps = 14
    rows = []
    for i in range(steps + 1):
        t = i / steps
        y = y0 + (y1 - y0) * t
        a = angle + turns * 2 * math.pi * t
        r_in = 0.02 + 0.12 * (1 - t)
        w = width * (1 - t) ** 0.8 + 0.004
        r_out = r_in + w
        thick = 0.012 * (1 - t) + 0.003
        n = Vector((-math.sin(a), 0, math.cos(a))) * thick
        p_in = Vector((math.cos(a) * r_in, y, math.sin(a) * r_in))
        p_out = Vector((math.cos(a) * r_out, y, math.sin(a) * r_out))
        rows.append([bm.verts.new(p_in + n), bm.verts.new(p_out + n), bm.verts.new(p_out - n), bm.verts.new(p_in - n)])
    for i in range(steps):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("Fin", me)
    bpy.context.scene.collection.objects.link(o)
    return link(o, m)


def bolt(name, colors):
    head, hot, ring_c, tail_c, fin_c = colors
    m_head = mat(f"{name}Head", head, 1.6, 0.15)
    m_hot = mat(f"{name}Hot", hot, 2.5, 0.1)
    m_ring = mat(f"{name}Ring", ring_c, 1.8)
    m_tail = mat(f"{name}Tail", tail_c, 1.4)
    m_fin = mat(f"{name}Fin", fin_c, 1.6)
    parts = []
    parts += crystal(0.3, 0.22, 0.78, m_head, 6)
    parts += crystal(0.34, 0.1, 0.5, m_hot, 4)
    parts.append(ring(0.2, 0.3, 0.024, 0.35, m_ring))
    parts.append(ring(0.12, 0.25, 0.02, -0.45, m_ring))
    parts.append(tail(0.08, -1.1, 0.15, m_tail))
    for i in range(3):
        parts.append(fin(i * 2 * math.pi / 3, 0.0, -1.0, 0.05, m_fin, turns=0.7))
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Smooth rings / tail, faceted crystals (glTF keeps per-face normals from flat faces).
    for p in o.data.polygons:
        mname = o.data.materials[p.material_index].name
        p.use_smooth = mname.endswith(("Ring", "Tail", "Fin"))
    return o


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    plasma = bolt("PlasmaBolt", (0xFF1EC8, 0xFFD0F4, 0x40D8FF, 0x1E46FF, 0x5AC8FF))
    nova = bolt("NovaBolt", (0x2AC8FF, 0xE8FAFF, 0x9FE8FF, 0x1060FF, 0x6FD8FF))
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "plasma.glb")), export_format="GLB", export_apply=True, export_yup=True)
    if RENDER:
        plasma.location = (-0.45, 0, 0)
        nova.location = (0.45, 0, 0)
        for o, a in ((plasma, 0.3), (nova, -0.5)):
            o.rotation_euler = (0, a, 0)
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "CYCLES"
        if sc.render.engine == "CYCLES":
            sc.cycles.samples = 48
        sc.render.resolution_x, sc.render.resolution_y = 900, 600
        sc.render.filepath = os.path.abspath(RENDER)
        w = bpy.data.worlds.new("W")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.04, 0.07, 1)
        cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
        cam.data.lens = 45
        cam.location = (0.0, -2.6, 1.9)
        cam.rotation_euler = (Vector((0, -0.35, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(cam)
        sc.camera = cam
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "plasma.blend")))
    if RENDER:
        bpy.ops.render.render(write_still=True)
    print("plasma done")


main()
