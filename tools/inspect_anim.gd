extends SceneTree
## Dev tool: track counts and lengths of chosen clips in an animation pack.
## Run: godot --headless --path . --script res://tools/inspect_anim.gd -- res://assets/animations/ual_core.glb Idle_Loop Jog_Fwd_Loop
func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var n: Node = load(args[0]).instantiate()
	var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
	for clip in args.slice(1):
		if not ap.has_animation(clip):
			print(clip, " missing"); continue
		var a := ap.get_animation(clip)
		var keys := 0
		for t in a.get_track_count(): keys += a.track_get_key_count(t)
		print("%s tracks %d keys %d length %.2f loop %d" % [clip, a.get_track_count(), keys, a.length, a.loop_mode])
	n.free()
	quit()
