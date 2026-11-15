extends Node
## Stands every candidate body in a row in the sandbox light, playing idle, and saves a front and a close-up shot.
## Run (not headless): godot --path . -- --lineup=/abs/dir

const BODIES := ["rocketbox/male_adult_18/Male_Adult_18.fbx", "rocketbox/male_adult_12/Male_Adult_12.fbx", "rocketbox/male_adult_04/Male_Adult_04.fbx",
	"rocketbox/female_party_02/Female_Party_02.fbx", "rocketbox/military_male_06/Military_Male_06.fbx", "realistic/survivor.glb"]


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
		var path := "res://assets/characters/%s" % BODIES[i]
		var m: Node3D = load(path).instantiate()
		if path.ends_with(".fbx"):
			CharacterSkin.apply(m, path)
		for old in m.find_children("*", "AnimationPlayer", true, false):
			old.free()
		stage.add_child(m)
		m.position = base + Vector3(i * 2.2, -CharacterSkin.ground_offset(m), 0)
		var ap := AnimationPlayer.new()
		m.add_child(ap)
		ap.root_node = NodePath("..")
		ap.add_animation_library(&"core", ChampionVisual._library(&"core"))
		ap.play(&"core/Idle")
		ap.seek(i * 0.4, true)
		var l := Label3D.new()
		l.text = BODIES[i].get_file().get_basename()
		l.position = Vector3(0, 2.15, 0)
		l.pixel_size = 0.004
		l.font_size = 48
		m.add_child(l)
	# a soft key and fill for judging faces (the arena itself is night-lit)
	var key := OmniLight3D.new()
	key.position = base + Vector3(3.0, 3.0, 5.0)
	key.omni_range = 20.0
	key.light_energy = 3.0
	key.light_color = Color(1.0, 0.9, 0.8)
	stage.add_child(key)
	var fill := OmniLight3D.new()
	fill.position = base + Vector3(9.0, 2.0, 4.0)
	fill.omni_range = 16.0
	fill.light_energy = 1.2
	fill.light_color = Color(0.7, 0.8, 1.0)
	stage.add_child(fill)
	var cam := Camera3D.new()
	sb.add_child(cam)
	cam.fov = 40
	cam.global_position = base + Vector3(5.5, 1.3, 9.5)
	cam.look_at(base + Vector3(5.5, 1.0, 0))
	cam.make_current()
	await _wait(60)
	for m in stage.get_children():
		var sks := m.find_children("*", "Skeleton3D", true, false)
		if sks.is_empty():
			continue
		var sk: Skeleton3D = sks[0]
		var h := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("Head"))
		var f := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("LeftFoot"))
		print("%s root %s head %s foot %s" % [m.name, str(m.global_position), str(h.origin), str(f.origin)])
	await _save(dir.path_join("lineup_full.png"))
	for i in 3:
		cam.global_position = base + Vector3(i * 2.2, 1.62, 1.35)
		cam.look_at(base + Vector3(i * 2.2, 1.55, 0))
		await _wait(5)
		await _save(dir.path_join("lineup_face_%d.png" % i))
	get_tree().quit()


func _wait(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _save(path: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
