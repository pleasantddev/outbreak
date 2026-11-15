extends SceneTree
## Dev tool: clip names, lengths, track targets and whether the hips travel (root motion) in each Mixamo file.
func _init() -> void:
	for f in DirAccess.get_files_at("res://assets/animations/mixamo"):
		if not f.ends_with(".fbx"):
			continue
		var n: Node = load("res://assets/animations/mixamo/" + f).instantiate()
		var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
		for clip in ap.get_animation_list():
			var a := ap.get_animation(clip)
			var travel := 0.0
			for t in a.get_track_count():
				if a.track_get_type(t) == Animation.TYPE_POSITION_3D and String(a.track_get_path(t)).ends_with(":Hips") and a.track_get_key_count(t) > 1:
					var p0: Vector3 = a.track_get_key_value(t, 0)
					var p1: Vector3 = a.track_get_key_value(t, a.track_get_key_count(t) - 1)
					travel = Vector2(p1.x - p0.x, p1.z - p0.z).length()
			print("%s: %s len %.2f tracks %d first %s hips travel %.2f" % [f, clip, a.length, a.get_track_count(), a.track_get_path(0), travel])
		n.free()
	quit()
