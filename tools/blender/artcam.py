"""
Key-art camera previews for the NEON RAIN models (scenario 03).

Renders a model from the camera solved off the key art (assets/textures/menu/night.jpg,
1672 x 941; values = src/night/NightLayout.js NIGHT_CAMERA), crops a region and writes an
"art crop | ours" side by side for checking a piece against the art.

    import artcam
    artcam.place(obj, pos=(-11.9, 0.9, -1.3), rot_y=0.1, scale=1.46, tilt_x=-0.65)
    artcam.context(["DeskTop", "NightTray"])        # pieces of night_desk.glb round the model
    artcam.lights()
    artcam.render("out.png", box=(1420, 410, 1672, 680), samples=48)
    artcam.side_by_side((1420, 410, 1672, 680), "out.png", "tools/night/ref/design_wheel.png")
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from PIL import Image, ImageDraw

import bkit

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ART = os.path.join(ROOT, "assets", "textures", "menu", "night.jpg")
W, H = 1672, 941
CAM_POS = (0.1685, 26.915, -18.1358)
CAM_QUAT = (-0.035874, 0.894539, 0.444841, 0.025081)   # three.js (x, y, z, w)
VFOV = 28.391


def project(p):
    """three.js world point -> art pixel (x, y) and depth."""
    q = Quaternion((CAM_QUAT[3], CAM_QUAT[0], CAM_QUAT[1], CAM_QUAT[2]))
    loc = q.inverted() @ (Vector(p) - Vector(CAM_POS))
    t = math.tan(math.radians(VFOV) / 2)
    x = loc.x / (-loc.z * t * W / H)
    y = loc.y / (-loc.z * t)
    return ((x + 1) / 2 * W, (1 - y) / 2 * H, -loc.z)


def unproject(px, py, plane_y):
    """Art pixel -> three.js point on the horizontal plane y = plane_y."""
    q = Quaternion((CAM_QUAT[3], CAM_QUAT[0], CAM_QUAT[1], CAM_QUAT[2]))
    t = math.tan(math.radians(VFOV) / 2)
    d = q @ Vector(((px / W * 2 - 1) * t * W / H, (1 - py / H * 2) * t, -1))
    c = Vector(CAM_POS)
    s = (plane_y - c.y) / d.y
    return tuple(c + d * s)


def place(o, pos=(0, 0, 0), rot_y=0.0, scale=1.0, tilt_x=0.0, quat=None):
    """Set a root's transform like three.js: root at pos, turned rot_y about y, scaled, then the
    child tilted tilt_x about x (ColorWheel.place: root.rotation.y, dial.rotation.x); or `quat` =
    a three.js quaternion (x, y, z, w) instead of rot_y / tilt_x."""
    T = Matrix.Translation(bkit.tb(pos))
    if quat is not None:
        q = Quaternion((quat[3], quat[0], quat[1], quat[2]))
        Rq = (bkit.T2B @ q.to_matrix().to_4x4() @ bkit.T2B.inverted())
        o.matrix_world = T @ Rq @ Matrix.Scale(scale, 4)
        return
    Ry = Matrix.Rotation(rot_y, 4, "Z")          # three.js y = Blender z
    Rx = Matrix.Rotation(tilt_x, 4, "X")         # three.js x = Blender x
    S = Matrix.Scale(scale, 4)
    o.matrix_world = T @ Ry @ S @ Rx


def context(names, glb=None):
    """Import night_desk.glb and keep only the named top-level nodes (placed as the engine does
    for DeskTop / NightTray at the origin)."""
    glb = glb or os.path.join(ROOT, "assets", "models", "night_desk.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [o for o in bpy.data.objects if o not in before]
    keep = []
    for o in new:
        top = o
        while top.parent is not None:
            top = top.parent
        if top.name.split(".")[0] in names:
            keep.append(o)
    for o in new:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    return [o for o in keep if o.parent is None]


def _emit_plane(name, centre, size, img_path=None, colour=(0.02, 0.04, 0.1), strength=1.0, crop=None, facing=-1):
    """Vertical emissive plane facing three.js -z (toward the desk) at `centre`."""
    cx, cy, cz = centre
    sx, sy = size
    verts = [(cx + sx / 2, cy - sy / 2, cz), (cx - sx / 2, cy - sy / 2, cz), (cx - sx / 2, cy + sy / 2, cz), (cx + sx / 2, cy + sy / 2, cz)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([bkit.tb(v) for v in verts], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = c
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    if img_path:
        im = Image.open(img_path).convert("RGB")
        if crop:
            im = im.crop(crop)
        p = os.path.join(bkit.TMP, name + ".png")
        im.save(p)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(p)
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (*colour, 1)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    o.data.materials.append(m)
    o.visible_camera = False      # only seen in reflections / as light
    return o


def env_image():
    """The art's window strip (rows 0-150) with the title logo painted out (the reflected
    environment of the previews); assets/textures/night/backdrop.jpg replaces it once built."""
    bd = os.path.join(ROOT, "assets", "textures", "night", "backdrop.jpg")
    if os.path.exists(bd):
        return bd
    p = os.path.join(bkit.TMP, "env_strip.png")
    if os.path.exists(p):
        return p
    from PIL import ImageFilter
    a = np.asarray(Image.open(ART).convert("RGB").crop((0, 0, W, 150)), np.float32)
    x0, x1 = 520, 1110
    left, right = a[:, x0 - 20:x0].mean(1), a[:, x1:x1 + 20].mean(1)
    t = np.linspace(0, 1, x1 - x0)[None, :, None]
    a[:, x0:x1] = left[:, None] * (1 - t) + right[:, None] * t
    im = Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
    im.save(p)
    return p


def lights(window=True, lamp=True, scale=1.0, env=0.4):
    """The engine's light rig (NightDesk.buildLights) in Cycles terms, plus the rainy window
    (the art's top strip) as an emissive plane behind the desk for the reflections."""
    sc = bpy.context.scene

    def add(kind, pos, energy, colour, size=0.5, aim=None, spot=None):
        L = bpy.data.lights.new("L", kind)
        L.energy = energy * scale
        L.color = bkit.srgb(colour)[:3]
        if kind == "AREA":
            L.size = size
        elif kind in ("POINT", "SPOT"):
            L.shadow_soft_size = size
        if spot:
            L.spot_size = spot
            L.spot_blend = 0.7
        lo = bpy.data.objects.new("L", L)
        lo.location = bkit.tb(pos)
        if aim is not None:
            d = bkit.tb(aim) - lo.location
            lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(lo)
        return lo
    if lamp:
        add("POINT", (11.6, 5.8, 7.6), 2600, 0xffb060, size=0.6)          # the lamp bulb
        add("POINT", (11, 3, 4.5), 700, 0xffa860, size=1.0)               # warm spill on the desk
    add("AREA", (-14, 16, 16), 9000, 0x6cc0ff, size=8, aim=(-2, 0, 2))   # cold window light
    add("POINT", (-12.5, 5, -1), 500, 0x9ab4ff, size=1.5)              # side fill on crates / dial
    add("POINT", (2.5, 5, 0.5), 600, 0xff3aa8, size=1.0)               # pink neon spill
    add("POINT", (-4, 4.5, -2.5), 700, 0x2f8cff, size=1.0)             # blue spill
    add("SUN", (6, 20, -30), 0.6, 0xffd2b0, aim=(0, 0, 0))              # room fill behind the camera
    if window:
        # The art's top strip (window + building) as the reflected environment.
        _emit_plane("EnvWindow", (0, 9, 30), (120, 26), env_image(), strength=env)
        _emit_plane("EnvRoom", (0, 12, -60), (160, 50), colour=(0.06, 0.05, 0.05), strength=1.0)


def world(colour=(0.012, 0.02, 0.045), strength=1.0):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*colour, 1)
    bg.inputs["Strength"].default_value = strength


def camera():
    sc = bpy.context.scene
    c = bpy.data.objects.new("ArtCam", bpy.data.cameras.new("ArtCam"))
    sc.collection.objects.link(c)
    sc.camera = c
    c.location = bkit.tb(CAM_POS)
    qt = Quaternion((CAM_QUAT[3], CAM_QUAT[0], CAM_QUAT[1], CAM_QUAT[2]))
    c.rotation_mode = "QUATERNION"
    c.rotation_quaternion = bkit.T2B.to_quaternion() @ qt
    c.data.sensor_fit = "VERTICAL"
    c.data.angle_y = math.radians(VFOV)
    c.data.clip_end = 400
    return c


def render(out_png, box=None, samples=48, res_scale=1.0, dof=None, film_transparent=False, exposure=0.0):
    """Cycles still from the art camera; box = (x0, y0, x1, y1) in art pixels renders and crops
    just that region (full-frame coordinates kept, so crops line up with the art)."""
    sc = bpy.context.scene
    if sc.camera is None or sc.camera.name != "ArtCam":
        camera()
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.max_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.cycles.glossy_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = int(100 * res_scale)
    sc.render.film_transparent = film_transparent
    names = [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items]
    sc.view_settings.view_transform = "AgX" if "AgX" in names else "Filmic"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = exposure
    if box:
        x0, y0, x1, y1 = box
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = x0 / W, x1 / W
        sc.render.border_min_y, sc.render.border_max_y = 1 - y1 / H, 1 - y0 / H
    else:
        sc.render.use_border = False
    cam = sc.camera.data
    if dof:
        cam.dof.use_dof = True
        cam.dof.focus_distance = dof[0]
        cam.dof.aperture_fstop = dof[1]
        cam.dof.aperture_blades = 0
    else:
        cam.dof.use_dof = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.abspath(out_png)
    bpy.ops.render.render(write_still=True)
    return out_png


def side_by_side(box, ours_png, out_png, height=520, labels=("art", "ours"), overlay=None):
    """'art crop | ours' at the same scale; `overlay` = list of polylines (art pixels) drawn on both."""
    art = Image.open(ART).convert("RGB").crop(box)
    ours = Image.open(ours_png).convert("RGB")
    if ours.size != art.size:
        ours = ours.resize(art.size, Image.LANCZOS)
    k = height / art.size[1]
    size = (int(art.size[0] * k), height)
    a, b = art.resize(size, Image.LANCZOS), ours.resize(size, Image.LANCZOS)
    out = Image.new("RGB", (size[0] * 2 + 8, height + 22), (20, 20, 24))
    out.paste(a, (0, 22))
    out.paste(b, (size[0] + 8, 22))
    d = ImageDraw.Draw(out)
    d.text((6, 4), labels[0], fill=(255, 255, 255))
    d.text((size[0] + 14, 4), labels[1], fill=(255, 255, 255))
    if overlay:
        for line in overlay:
            for off in (0, size[0] + 8):
                pts = [((x - box[0]) * k + off, (y - box[1]) * k + 22) for x, y in line]
                d.line(pts, fill=(255, 0, 255), width=1)
    os.makedirs(os.path.dirname(os.path.abspath(out_png)), exist_ok=True)
    out.save(out_png)
    return out_png
