import bpy, sys
h = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/claude/hl/v2/public/assets/chars/male.glb', bone_heuristic=h)
bpy.ops.export_scene.gltf(filepath=f'/home/claude/hl/charbake/out/rt_{h}.glb', export_format='GLB', export_animations=False)
