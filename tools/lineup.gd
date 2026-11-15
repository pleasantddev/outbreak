extends Node
## Stands every candidate body in a row in the sandbox light, playing idle, and saves a front and a close-up shot.
## Run (not headless): godot --path . -- --lineup=/abs/dir

const BODIES := ["survivor", "rogue", "trooper", "farah", "girl", "../male"]


func start(sb: Node, dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	_run.call_deferred(sb, dir)


func _run(sb: Node, dir: String) -> void:
	for c in get_tree().get_nodes_in_group(&"champions"):
		c.visible = false
	for n in sb.get_children():
		if n is CanvasLayer:
			n.visible = false
	var stage := Node3D.new()
	sb.add_child(stage)
	var base := Vector3(-6.0, 0.15, 2.0)
	for i in BODIES.size():
		var m: Node3D = load("res://assets/characters/realistic/%s.glb" % BODIES[i]).instantiate()
		stage.add_child(m)
		m.position = base + Vector3(i * 2.2, 0, 0)
		var ap := AnimationPlayer.new()
		m.add_child(ap)
		ap.root_node = NodePath("..")
		ap.add_animation_library(&"core", ChampionVisual._library(&"core"))
		ap.play(&"core/Idle")
		ap.seek(i * 0.4, true)
		var l := Label3D.new()
		l.text = BODIES[i].get_file()
		l.position = Vector3(0, 2.15, 0)
		l.pixel_size = 0.004
		l.font_size = 48
		m.add_child(l)
	var cam := Camera3D.new()
	sb.add_child(cam)
	cam.fov = 40
	cam.global_position = base + Vector3(5.5, 1.3, 9.5)
	cam.look_at(base + Vector3(5.5, 1.0, 0))
	cam.make_current()
	await _wait(60)
	await _save(dir.path_join("lineup_full.png"))
	for i in 3:
		cam.global_position = base + Vector3(i * 2.2, 1.62, 1.35)
		cam.look_at(base + Vector3(i * 2.2, 1.55, 0))
		await _wait(5)
		await _save(dir.path_join("lineup_face_%s.png" % BODIES[i].get_file()))
	get_tree().quit()


func _wait(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _save(path: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
