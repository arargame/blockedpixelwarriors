"""
Backdrop for scenario 03 NEON RAIN: the apartment building ACROSS THE STREET at night in the rain,
seen through our window from the key-art camera, strongly out of focus (macro-photo bokeh).

The art camera looks DOWN (its top row meets the window plane z = 11.6 at y ~ 3-5), so through
the window it sees the lower floors of the building opposite: a facade at z ~ 62 with rows of
windows (most dark, a few cold white / blue TV / teal lit — the art's building is COLD, the only warm light
in the strip is our lamp), balcony slabs with faintly glowing rails,
the cyan neon strip (art x 900-1200 at the top), the pink / magenta vertical sign (art x
1335-1375 and a dimmer one at 1250-1270), the horizontal blue rail glow lines (art y ~120 left,
~85 right), round bokeh lights, plus the dark window mullion behind the lamp (art x ~290) on the
window plane itself. Elements that the art fixes on screen are placed by art pixel (ray from the
art camera onto their depth), so they land exactly where the art has them whatever the depth.

    python tools/blender/build_night_backdrop.py

Output: assets/textures/night/backdrop.jpg (1672 x 941, JPEG q92): a render from the art camera
(pixel = art pixel), ONLY the outside (no desk, no tray) - project it onto the window plane
with the art camera (screen-space / projective UVs). Preview: tools/night/ref/design_backdrop.png
(art top strip above ours). The .blend is saved to assets/models/night_backdrop.blend.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
import artcam  # noqa: E402

ROOT = artcam.ROOT
OUT = os.path.join(ROOT, "assets", "textures", "night", "backdrop.jpg")
REF = os.path.join(ROOT, "tools", "night", "ref", "design_backdrop.png")
ZF = 62.0                 # facade plane
YS = -150.0               # street level (ground floor shop fronts at the facade foot)
OUT_STREET = os.path.join(ROOT, "assets", "textures", "night", "backdrop_street.jpg")
REF_STREET = os.path.join(ROOT, "tools", "night", "ref", "design_backdrop_street.png")
# Street (three.js z): our own building's foot at z ~8, near sidewalk 8-18, road 18-52 (4 lanes),
# far sidewalk 52-62, facade at 62.
LANES = [(18.0, 26.5), (26.5, 35.0), (35.0, 43.5), (43.5, 52.0)]
FOCUS = 32.0              # the tray (sharp foreground)
FSTOP = 0.045             # macro bokeh: ~35-45 px discs on the facade
rng = np.random.default_rng(5)


def ray(px, py):
    q = Quaternion((artcam.CAM_QUAT[3], *artcam.CAM_QUAT[:3]))
    t = math.tan(math.radians(artcam.VFOV) / 2)
    d = q @ Vector(((px / artcam.W * 2 - 1) * t * artcam.W / artcam.H, (1 - py / artcam.H * 2) * t, -1))
    return Vector(artcam.CAM_POS), d.normalized()


def at(px, py, z):
    """Art pixel -> three.js point on the plane z."""
    c, d = ray(px, py)
    return c + d * ((z - c.z) / d.z)


def emit_mat(name, hexv, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = bkit.srgb(hexv)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def dark_mat(name, hexv, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = bkit.srgb(hexv)
    b.inputs["Roughness"].default_value = rough
    return m


def quad(name, corners, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata([bkit.tb(tuple(c)) for c in corners], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o


def rect_world(name, x0, x1, y0, y1, z, material):
    return quad(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], material)


def rect_px(name, px0, px1, py0, py1, z, material):
    """Screen-designed rectangle (art pixels) on the plane z."""
    return quad(name, [at(px0, py1, z), at(px1, py1, z), at(px1, py0, z), at(px0, py0, z)], material)


def ball(name, p, r, material):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=bkit.tb(tuple(p)), segments=12, ring_count=8)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    return o


def build():
    sc = bpy.context.scene
    artcam.world(colour=(0.006, 0.01, 0.024), strength=1.0)
    # Facade: dark navy wall far behind the window.
    wall = dark_mat("Wall", 0x0a1020, rough=0.8)
    rect_world("Facade", -160, 130, YS, 30, ZF + 0.2, wall)
    wall_glow = emit_mat("WallGlow", 0x0e2448, 0.45)
    rect_world("FacadeGlow", -160, 130, YS, 30, ZF + 0.3, wall_glow)
    # Windows: a grid of floors (3.6) x bays (3.0); most dark, a few cold white / blue / teal (no warm light).
    mats = {
        "dark": emit_mat("WinDark", 0x0e1c40, 0.35),
        "cold": emit_mat("WinCold", 0xc8dcff, 1.1),
        "cold2": emit_mat("WinCold2", 0x5a8cff, 0.9),
        "tv": emit_mat("WinTV", 0x3c78ff, 1.3),
        "teal": emit_mat("WinTeal", 0x2ab8d8, 1.3),
    }
    for fy in np.arange(-140.8, 20, 3.6):
        for bx in np.arange(-150, 120, 3.0):
            k = rng.random()
            kind = "dark" if k < 0.9 else "cold" if k < 0.93 else "cold2" if k < 0.96 else "tv" if k < 0.98 else "teal"
            rect_world(f"W{fy:.0f}_{bx:.0f}", bx + 0.5, bx + 2.3, fy + 0.9, fy + 2.9, ZF, mats[kind])
    # Balcony slabs (dark) with faint blue rail glow on some floors.
    slab = dark_mat("Slab", 0x060a14, rough=0.5)
    rail = emit_mat("RailGlow", 0x2f6cff, 0.8)
    for fy in np.arange(-140.8, 20, 3.6):
        y = fy + 0.35
        rect_world(f"Slab{fy:.0f}", -150, 120, y - 0.25, y + 0.25, ZF - 1.2, slab)
        if rng.random() < 0.2:
            rect_world(f"Rail{fy:.0f}", -150, 120, y + 0.9, y + 1.0, ZF - 1.3, rail)
    # Art-fixed neon: cyan strip top centre, pink vertical signs top right, blue rail glow lines.
    cyan = emit_mat("NeonCyan", 0x28c8ff, 9.0)
    rect_px("NeonCyan", 905, 1195, 18, 24, ZF - 2.0, cyan)
    cyan2 = emit_mat("NeonCyanDim", 0x1a90d0, 2.2)
    rect_px("NeonCyanHalo", 895, 1205, 12, 30, ZF - 1.9, cyan2)
    pink = emit_mat("NeonPink", 0xff3aa8, 5.0)
    rect_px("NeonPink", 1342, 1368, -4, 72, ZF - 2.5, pink)
    pink2 = emit_mat("NeonPinkDim", 0xe040a8, 2.8)
    rect_px("NeonPink2", 1252, 1270, 6, 62, ZF - 2.5, pink2)
    # the sign panel: lilac-blue glow spanning art x 1270-1420 (art mean ~83,95,159)
    rect_px("NeonPinkHalo", 1270, 1420, 15, 110, ZF - 2.4, emit_mat("PinkHalo", 0x5a6ad8, 0.45))
    blue = emit_mat("RailBlue", 0x2f7cff, 2.0)
    rect_px("RailRight", 880, 1430, 83, 89, ZF - 3.0, blue)
    rect_px("RailRight2", 1220, 1500, 150, 158, ZF - 3.0, emit_mat("RailBlueDim", 0x2a5ad0, 1.6))
    # Round bokeh lights (art: cyan dots right of the tray, blue ones top centre; all cold).
    for (px, py, r, hexv, s) in [(1405, 170, 0.9, 0x2ad0ff, 6), (1412, 215, 0.8, 0x2ad0ff, 5), (1398, 255, 0.7, 0x30b0ff, 4),
                                 (812, 22, 0.8, 0x3a8cff, 6), (1170, 30, 0.6, 0x6ab0ff, 4), (560, 60, 0.6, 0x4a70d0, 3),
                                 (1500, 120, 0.7, 0x9a6aff, 3), (1460, 40, 0.6, 0xff5ab0, 3), (420, 30, 0.5, 0x6aa0ff, 2.0),
                                 (1600, 200, 0.7, 0x2a90ff, 3)]:
        ball(f"Bokeh{px}", at(px, py, ZF - 6), r, emit_mat(f"Bk{px}", hexv, s))
    # The window: dark mullion behind the lamp (on the window plane, art x ~285-305).
    # blue-grey night behind the lamp (art ~37,44,65): the glass catching the sky
    rect_px("GlassBlueGrey", -40, 282, -40, 320, ZF - 8.0, emit_mat("GlassBG", 0x34405e, 0.5))
    frame = dark_mat("Mullion", 0x05070c, rough=0.4)
    zw = 11.7
    rect_px("Mullion", 282, 308, -20, 300, zw, frame)
    street()
    return sc


def ground(name, x0, x1, z0, z1, y, material):
    return quad(name, [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], material)


def wet_mat(name, hexv, rough_dry=0.32, rough_wet=0.03, scale=0.08):
    """Wet asphalt / pavement: dark, puddle patches mirror-glossy (noise -> roughness)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = bkit.srgb(hexv)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (rough_wet,) * 3 + (1,)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (rough_dry,) * 3 + (1,)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Roughness"])
    return m


def street():
    """Ground floor shop fronts, sidewalks, the 4-lane wet street with lane markings, a crosswalk,
    street lamps - all cold coloured. Lanes are kept clear (the engine animates traffic)."""
    r = np.random.default_rng(23)
    asphalt = wet_mat("Asphalt", 0x0c1014)
    walk = wet_mat("Sidewalk", 0x1a1f26, rough_dry=0.4, rough_wet=0.06, scale=0.12)
    ground("Road", -220, 220, LANES[0][0], LANES[-1][1], YS, asphalt)
    ground("WalkNear", -220, 220, 6.0, LANES[0][0], YS + 0.25, walk)
    # the pavement in front of our own building (straight below the window), wet, with puddles
    ground("Forecourt", -220, 220, -40.0, 6.0, YS + 0.25, wet_mat("Forecourt", 0x141920, rough_dry=0.35, rough_wet=0.04, scale=0.06))
    for xb in np.arange(-200, 200, 9.0):
        ball(f"Bollard{xb:.0f}", (xb, YS + 1.0, 7.0), 0.18, emit_mat(f"BollardM{xb:.0f}", 0x6ab0ff, 3.0))
    ground("WalkFar", -220, 220, LANES[-1][1], ZF + 0.5, YS + 0.25, walk)
    curb = dark_mat("Curb", 0x2a3038, rough=0.3)
    for z in (LANES[0][0], LANES[-1][1]):
        rect_world(f"Curb{z:.0f}", -220, 220, YS, YS + 0.25, z, curb)
    # lane markings: dashed white between lanes, a double line in the middle
    paint = emit_mat("LanePaint", 0xb8c4d8, 0.35)
    for z in (LANES[0][1], LANES[2][1]):
        for x in np.arange(-220, 220, 7.0):
            ground(f"Dash{z:.0f}_{x:.0f}", x, x + 3.5, z - 0.2, z + 0.2, YS + 0.02, paint)
    for dz in (-0.35, 0.35):
        ground(f"Centre{dz}", -220, 220, LANES[1][1] + dz - 0.12, LANES[1][1] + dz + 0.12, YS + 0.02, paint)
    # crosswalk (screen left of centre): bars along the traffic, across the whole road
    zebra = emit_mat("Zebra", 0xc8d2e4, 0.45)
    for z in np.arange(LANES[0][0] + 0.8, LANES[-1][1] - 0.8, 3.2):
        ground(f"Zebra{z:.0f}", 6.0, 16.0, z, z + 1.6, YS + 0.03, zebra)
    # ground-floor shop fronts: lit windows (cold white / teal / blue), closed shutters, signs
    kinds = [(0xd8e6ff, 1.6), (0x2ab8d8, 1.4), (0x4a7cff, 1.4), (0x0e1830, 0.3), (0x9a8cff, 1.1)]
    x = -160.0
    while x < 130:
        w = r.uniform(8, 15)
        col, st = kinds[r.choice(len(kinds), p=[0.3, 0.2, 0.2, 0.2, 0.1])]
        rect_world(f"Shop{x:.0f}", x + 0.8, x + w - 0.8, YS + 0.4, YS + 5.0, ZF - 0.1, emit_mat(f"ShopM{x:.0f}", col, st))
        if r.random() < 0.6:
            sc_, ss = [(0x28c8ff, 4.0), (0x5a8cff, 3.0), (0xb06aff, 3.0), (0xe8f0ff, 2.5)][r.integers(4)]
            sw = r.uniform(3, w - 2)
            sx = x + r.uniform(1, w - sw - 1)
            rect_world(f"Sign{x:.0f}", sx, sx + sw, YS + 5.6, YS + 6.6, ZF - 0.4, emit_mat(f"SignM{x:.0f}", sc_, ss))
        x += w
    # street lamps on both sidewalks (cold LED heads) + their light on the wet street
    head = emit_mat("LampHead", 0xe6f0ff, 25.0)
    for zl, off in ((12.0, 0.0), (57.0, 15.0)):
        for xl in np.arange(-210 + off, 210, 30.0):
            ball(f"StreetLamp{zl:.0f}_{xl:.0f}", (xl, YS + 9.0, zl), 0.45, head)
            L = bpy.data.lights.new("SL", "POINT")
            L.energy = 9000
            L.color = bkit.srgb(0xcfe0ff)[:3]
            L.shadow_soft_size = 1.0
            lo = bpy.data.objects.new("SL", L)
            lo.location = bkit.tb((xl, YS + 8.6, zl))
            bpy.context.scene.collection.objects.link(lo)
    # walk signal at the crosswalk (cyan)
    for zc in (LANES[0][0] - 1.0, LANES[-1][1] + 1.0):
        ball(f"Walk{zc:.0f}", (17.0, YS + 3.5, zc), 0.3, emit_mat(f"WalkM{zc:.0f}", 0x30e0ff, 12.0))


def render(out_path, shift_y=0.0, samples=40):
    """Render the plate from the art camera; shift_y in frame heights (-1 = the frame directly
    below). With the art camera's VERTICAL sensor fit, Blender's lens shift is in frame heights
    (checked: the street plate lands exactly where artcam.project puts it)."""
    sc = bpy.context.scene
    cam = sc.camera if sc.camera and sc.camera.name == "ArtCam" else artcam.camera()
    cam.data.clip_end = 1200
    cam.data.shift_y = shift_y
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = FOCUS
    cam.data.dof.aperture_fstop = FSTOP
    cam.data.dof.aperture_blades = 0
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = artcam.W, artcam.H
    sc.render.resolution_percentage = 100
    names = [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items]
    sc.view_settings.view_transform = "AgX" if "AgX" in names else "Filmic"
    tmp = os.path.join(bkit.TMP, os.path.basename(out_path) + ".png")
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    im = Image.open(tmp).convert("RGB")
    im.save(out_path, quality=92)
    return im


def previews(im, ims):
    # backdrop: art top strip | ours (top 300 rows)
    art = Image.open(artcam.ART).convert("RGB")
    h = 300
    out = Image.new("RGB", (artcam.W, h * 2 + 30), (20, 20, 24))
    out.paste(art.crop((0, 0, artcam.W, h)), (0, 12))
    out.paste(im.crop((0, 0, artcam.W, h)), (0, h + 28))
    d = ImageDraw.Draw(out)
    d.text((6, 0), "art top strip", fill=(255, 255, 255))
    d.text((6, h + 16), "ours: backdrop.jpg (outside only, from the art camera)", fill=(255, 255, 255))
    out.save(REF)
    # street: backdrop.jpg stacked over backdrop_street.jpg (half size) - continuity check
    if ims is not None:
        a, b = im.resize((836, 470)), ims.resize((836, 470))
        o2 = Image.new("RGB", (836, 940 + 20), (20, 20, 24))
        o2.paste(a, (0, 0))
        o2.paste(b, (0, 490))
        ImageDraw.Draw(o2).text((6, 474), "above: backdrop.jpg   below: backdrop_street.jpg (lens shifted down one frame)", fill=(255, 255, 255))
        o2.save(REF_STREET)


def main():
    bkit.reset()
    build()
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else "both"
    im = render(OUT) if only in ("both", "backdrop") else Image.open(OUT).convert("RGB")
    ims = render(OUT_STREET, shift_y=-1.0) if only in ("both", "street") else None
    previews(im, ims)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets", "models", "night_backdrop.blend"))
    print("backdrop done")


main()
