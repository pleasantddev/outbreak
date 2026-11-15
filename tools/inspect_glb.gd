extends SceneTree
## Prints the node tree, skeleton and animation track paths of imported models. Dev tool.
## Run: godot --headless --path . --script res://tools/inspect_glb.gd -- res://assets/characters/male.glb ...
func _init() -> void:
	for path in OS.get_cmdline_user_args():
		var n: Node = load(path).instantiate()
		print("== ", path)
		_tree(n, 0)
		for ap in n.find_children("*", "AnimationPlayer", true, false):
			var lib_names: Array = ap.get_animation_library_list()
			print("  player ", n.get_path_to(ap), " libs ", lib_names, " root_node ", ap.root_node)
			var a: Animation = ap.get_animation(ap.get_animation_list()[1])
			for t in mini(a.get_track_count(), 3):
				print("    track ", a.track_get_path(t), " type ", a.track_get_type(t))
		for sk in n.find_children("*", "Skeleton3D", true, false):
			print("  skeleton ", n.get_path_to(sk), " bones ", sk.get_bone_count(), " first ", sk.get_bone_name(0), " ", sk.get_bone_name(1))
		n.free()
	quit()

func _tree(n: Node, d: int) -> void:
	if d > 4: return
	print("  ".repeat(d + 1), n.name, " (", n.get_class(), ")")
	for c in n.get_children(): _tree(c, d + 1)
