class_name CharacterSkin
extends RefCounted
## Gives Rocketbox avatars their PBR materials. Their FBX files point at textures on the original artist's disk, so the
## importer finds none; here each surface material named "<id>_body", "<id>_head" or "<id>_opacity" is rebuilt from
## the textures that sit next to the FBX: <id>_<part>_color*.webp, <id>_<part>_normal.webp, <id>_<part>_rough.webp.
## Hair, lashes and beards live on the opacity surface and use alpha scissor (cheap, sorts correctly, works on phones).

static var _cache: Dictionary = {}


static func apply(model: Node, scene_path: String) -> void:
	var dir := scene_path.get_base_dir()
	for m: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		for s in m.mesh.get_surface_count():
			var src := m.mesh.surface_get_material(s)
			if src == null:
				continue
			var mat := material_for(dir, String(src.resource_name))
			if mat:
				m.set_surface_override_material(s, mat)


static func material_for(dir: String, slot: String) -> Material:
	var key := dir.path_join(slot)
	if _cache.has(key):
		return _cache[key]
	var files := DirAccess.get_files_at(dir)
	var color := _find(files, slot + "_color")
	if color == "":
		_cache[key] = null
		return null
	var m := StandardMaterial3D.new()
	m.resource_name = slot
	m.albedo_texture = load(dir.path_join(color))
	var nor := _find(files, slot + "_normal")
	if nor != "":
		m.normal_enabled = true
		m.normal_texture = load(dir.path_join(nor))
	var rough := _find(files, slot + "_rough")
	if rough != "":
		m.roughness_texture = load(dir.path_join(rough))
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
		m.roughness = 1.0
	else:
		m.roughness = 0.7
	if slot.ends_with("_head"):
		# skin: a touch of subsurface-like softness without the cost of real SSS on phones
		m.rim_enabled = true
		m.rim = 0.25
		m.rim_tint = 0.6
	if slot.ends_with("_opacity"):
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.35
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	_cache[key] = m
	return m


static func _find(files: PackedStringArray, prefix: String) -> String:
	for f in files:
		if f.begins_with(prefix) and f.ends_with(".webp"):
			return f
	return ""


## Rocketbox's root bone (Bip01) sits at hip height; the animations' root sits on the ground, so retargeted clips lift the
## body by that height. Returns the drop that puts the feet back on the floor (0 for skeletons rooted at the ground).
static func ground_offset(model: Node) -> float:
	var sks := model.find_children("*", "Skeleton3D", true, false)
	if sks.is_empty():
		return 0.0
	var sk: Skeleton3D = sks[0]
	var r := sk.find_bone("Root")
	if r < 0:
		return 0.0
	# work in the model's own space so this is valid before the model joins the scene tree
	var xf := Transform3D()
	var n: Node = sk
	while n != null and n != model:
		if n is Node3D:
			xf = (n as Node3D).transform * xf
		n = n.get_parent()
	return (xf * sk.get_bone_global_rest(r).origin).y - xf.origin.y
