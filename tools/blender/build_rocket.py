"""
Homing rocket for the R power-up (Blender 4.2+/5.x).

    python tools/blender/build_rocket.py [--render out.png]
or inside Blender: Scripting tab > Open > this file > Run Script.

Exports assets/models/rocket.glb (+ .blend). The rocket points along +Y in Blender
(= -Z forward in glTF / three.js), length ~1 unit; the game scales it.
"""
import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
RENDER = argv[argv.index("--render") + 1] if "--render" in argv else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models")


def srgb(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1)


MATS = {}


def mat(name, hexv, rough=0.4, metal=0.2, emit=0.0):
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


def finish(o, m, bevel=0.0):
    o.data.materials.append(MATS[m])
    if bevel:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return o


def cyl(z, r, depth, m, r2=None, verts=16, bevel=0.01):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(0, z, 0), rotation=(-math.pi / 2, 0, 0))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=(0, z, 0), rotation=(-math.pi / 2, 0, 0))
    return finish(bpy.context.active_object, m, bevel)


def box(loc, size, m, rot=(0, 0, 0), bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, m, bevel)


def build():
    mat("RocketBody", 0xE9E6DC, 0.45, 0.1)
    mat("RocketNose", 0xD8282E, 0.35, 0.1)
    mat("RocketBand", 0xF2C230, 0.4, 0.3)
    mat("RocketFin", 0x3A6C45, 0.5, 0.1)
    mat("RocketMetal", 0x2B2E33, 0.35, 0.7)
    mat("RocketFlame", 0xFF9A30, 0.5, 0.0, emit=8.0)
    cyl(0.0, 0.11, 0.62, "RocketBody")
    cyl(0.39, 0.11, 0.16, "RocketNose", r2=0.07)
    cyl(0.52, 0.07, 0.12, "RocketNose", r2=0.0, bevel=0.0)
    cyl(0.2, 0.115, 0.05, "RocketBand")
    cyl(-0.14, 0.115, 0.04, "RocketBand")
    cyl(-0.36, 0.1, 0.1, "RocketMetal", r2=0.075)
    cyl(-0.42, 0.06, 0.03, "RocketFlame", bevel=0.0)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        box((math.cos(a) * 0.17, -0.24, math.sin(a) * 0.17), (0.15, 0.22, 0.025), "RocketFin", rot=(0, -a, 0))
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    rocket = bpy.context.active_object
    rocket.name = "Rocket"
    return rocket


def main():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    rocket = build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "rocket.glb")), export_format="GLB", export_apply=True, export_yup=True)
    if RENDER:
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 48
        sc.render.resolution_x, sc.render.resolution_y = 800, 500
        sc.render.filepath = os.path.abspath(RENDER)
        w = bpy.data.worlds.new("W")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.6, 1, 1)
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 3.5
        sun.rotation_euler = (0.7, -0.4, -0.6)
        sc.collection.objects.link(sun)
        cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
        cam.data.lens = 50
        cam.location = (1.4, -0.4, 0.9)
        from mathutils import Vector
        cam.rotation_euler = (Vector((0, 0.05, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(cam)
        sc.camera = cam
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "rocket.blend")))
    if RENDER:
        bpy.ops.render.render(write_still=True)
    print("rocket done")


main()
