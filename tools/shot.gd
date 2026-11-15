extends Node
## Plays a short scripted fight in the sandbox and saves screenshots plus frame timings. Used to check the look.
## Run (not headless): godot --path . -- --shot=/abs/dir   (the sandbox adds this node when it sees --shot=)
## Writes shot_1_spawn.png, shot_2_plaza.png, shot_3_combo.png, shot_4_bolt.png, shot_5_slam.png, plus timings.txt.

var out_dir := "user://shots"
var sandbox: Sandbox
var frame_ms: Array[float] = []


func start(sb: Sandbox, dir: String) -> void:
	sandbox = sb
	out_dir = dir
	DirAccess.make_dir_recursive_absolute(out_dir)
	_run.call_deferred()


func _run() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var p := sandbox.player
	var input: PlayerInput = sandbox.get_node("PlayerInput")
	input.enabled = false
	await _frames(90)
	await _shot("shot_1_spawn")
	# walk out onto the plaza along the open lane between the stalls
	p.cmd_move = Vector2(0, 1)
	await _frames(150)
	p.cmd_move = Vector2.ZERO
	await _frames(20)
	await _shot("shot_2_plaza")
	# step up to the still dummy and punch through the combo
	var target := _nearest_enemy(p)
	p.global_position = target.global_position + Vector3(1.0, 0.0, -2.0)
	_face(p, target)
	await _frames(30)
	for i in 3:
		while not p.abilities.request(0):
			_face(p, target)
			await _frames(1)
		await _frames(8)
		if i == 1:
			await _shot("shot_3_combo")
	await _frames(40)
	# back off and aim a spirit bolt at it
	p.global_position = target.global_position + Vector3(3.0, 0.0, -9.0)
	_face(p, target)
	p.cmd_aim_pitch = -0.06
	await _frames(20)
	p.abilities.request(1)
	await _frames(9)
	await _shot("shot_4_bolt")
	await _frames(40)
	p.global_position = target.global_position + Vector3(0.5, 0.0, -2.2)
	_face(p, target)
	await _frames(20)
	p.abilities.request(4)
	await _frames(28)
	await _shot("shot_5_slam")
	while not p.abilities.request(3):
		await _frames(1)
	await _frames(20)
	await _shot("shot_6_guard")
	frame_ms.sort()
	var n := frame_ms.size()
	var report := "frames %d  p50 %.1f ms  p95 %.1f ms  max %.1f ms  fps(p50) %.0f\n%s\n" % [n, frame_ms[n / 2], frame_ms[int(n * 0.95)], frame_ms[-1], 1000.0 / frame_ms[n / 2], RenderingServer.get_video_adapter_name()]
	var f := FileAccess.open(out_dir.path_join("timings.txt"), FileAccess.WRITE)
	f.store_string(report)
	print(report)
	get_tree().quit()


func _frames(n: int) -> void:
	for i in n:
		var t := Time.get_ticks_usec()
		await get_tree().process_frame
		frame_ms.append((Time.get_ticks_usec() - t) / 1000.0)


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(out_dir.path_join(name + ".png"))
	print("saved ", name)


func _nearest_enemy(p: Champion) -> Champion:
	var best: Champion
	for c in get_tree().get_nodes_in_group(&"champions"):
		if c.team != p.team and (best == null or c.global_position.distance_to(p.global_position) < best.global_position.distance_to(p.global_position)):
			best = c
	return best


func _face(p: Champion, t: Champion) -> void:
	var to := t.global_position - p.global_position
	p.cmd_aim_yaw = atan2(-to.x, -to.z)


func _walk_to(p: Champion, t: Champion, stop: float) -> void:
	for i in 300:
		_face(p, t)
		if p.global_position.distance_to(t.global_position) <= stop:
			break
		p.cmd_move = Vector2(0, 1)
		await _frames(1)
	p.cmd_move = Vector2.ZERO
	_face(p, t)
