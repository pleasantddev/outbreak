extends SceneTree
## Dev tool: height of the Head and LeftFoot bones in world space (the true standing height of a rigged model).
func _init() -> void:
	for path in OS.get_cmdline_user_args():
		var n: Node3D = load(path).instantiate()
		root.add_child(n)
		var sk: Skeleton3D = n.find_children("*", "Skeleton3D", true, false)[0]
		var head := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("Head"))
		var foot := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("LeftFoot"))
		print("%s head y %.2f  foot y %.2f  head %s  skeleton scale %s" % [path.get_file(), head.origin.y, foot.origin.y, str(head.origin), str(sk.global_transform.basis.get_scale())])
		n.free()
	quit()
