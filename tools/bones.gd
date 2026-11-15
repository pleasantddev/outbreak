extends SceneTree
## Dev tool: prints every bone name of the first Skeleton3D in each given scene.
func _init() -> void:
	for path in OS.get_cmdline_user_args():
		var n: Node = load(path).instantiate()
		var sk: Skeleton3D = n.find_children("*", "Skeleton3D", true, false)[0]
		var names := PackedStringArray()
		for i in sk.get_bone_count(): names.append(sk.get_bone_name(i))
		print(path.get_file(), " (", n.get_path_to(sk), "): ", ", ".join(names))
		n.free()
	quit()
