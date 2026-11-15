extends SceneTree
## Dev tool: first animation track path, and every mesh surface's material name, for the given scenes.
func _init() -> void:
	for path in OS.get_cmdline_user_args():
		var n: Node = load(path).instantiate()
		for ap in n.find_children("*", "AnimationPlayer", true, false):
			var a: Animation = ap.get_animation(ap.get_animation_list()[0])
			print(path.get_file(), " track0 ", a.track_get_path(0))
		for m: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
			for s in m.mesh.get_surface_count():
				var mat := m.mesh.surface_get_material(s)
				print(path.get_file(), " ", m.name, " surface ", s, " ", mat.resource_name if mat else "none", " ", mat.get_class() if mat else "")
		n.free()
	quit()
