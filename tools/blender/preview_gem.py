"""Art-camera preview of assets/models/gem.glb (red, as the engine tints it) at the key art's gem
spot -> tools/night/ref/design_gem.png.   python tools/blender/preview_gem.py"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit  # noqa: E402
import artcam  # noqa: E402

bkit.reset()
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(artcam.ROOT, "assets", "models", "gem.glb"))
gem = [o for o in bpy.data.objects if o not in before and o.name == "Gem"][0]
# Axis along the art camera's up vector (tilted ~53 deg back): the art shows the jewel side-on.
artcam.place(gem, pos=(-3.2, 1.0, 0.9), quat=(0.4437, 0.0, 0.0483, 0.8949), scale=1.4)
artcam.context(["DeskTop", "NightTray"])
artcam.world()
artcam.lights()
box = (955, 425, 1070, 550)
p = artcam.render(os.path.join(bkit.TMP, "gem.png"), box=box, samples=32)
artcam.side_by_side(box, p, os.path.join(artcam.ROOT, "tools", "night", "ref", "design_gem.png"), height=500)
print("gem preview done")
