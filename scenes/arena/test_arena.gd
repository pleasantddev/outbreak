class_name TestArena
extends Node3D
## Blockout of the combat sandbox: a Lagos-style junction plaza, built from a layout table so it can be tuned fast.
## Not The Crossing (that is phase 4); this exists to test movement, aim, cover and verticality.
## Layout (metres, +z is toward team B):
##   spawns at z = -34 (A) and +34 (B), each in a three-walled bay facing the plaza
##   central objective pad (r 5) on a raised plaza; low walls and market stalls as cover
##   side routes at x = -24 (covered passage under a corrugated roof) and x = +24 (open street)
##   pedestrian overpass across the plaza at 4.5 m with ramps at both ends
##   buildings of 6, 9 and 13 m at the corners; invisible walls at the edge; kill plane below

const HALF := 42.0

var _mats: Dictionary = {}


func _ready() -> void:
	build()


func build() -> void:
	_environment()
	# ground and plaza
	_box("Ground", Vector3(0, -0.5, 0), Vector3(HALF * 2, 1, HALF * 2), "road", 0.25)
	_box("Plaza", Vector3(0, 0.075, 0), Vector3(26, 0.15, 26), "sidewalk", 0.5)
	_objective_pad(Vector3(0, 0.16, 0), 5.0)
	# sidewalks along the side routes
	_box("WalkWest", Vector3(-24, 0.075, 0), Vector3(6, 0.15, 70), "sidewalk", 0.5)
	_box("WalkEast", Vector3(24, 0.075, 0), Vector3(6, 0.15, 70), "sidewalk", 0.5)
	# corner buildings (different heights) leave the plaza, two side routes and the spawn lanes open
	_building("BldgNW", Vector3(-15, 0, -24), Vector3(10, 9, 12), "plaster")
	_building("BldgNE", Vector3(15, 0, -24), Vector3(10, 6, 12), "block")
	_building("BldgSW", Vector3(-15, 0, 24), Vector3(10, 6, 12), "block")
	_building("BldgSE", Vector3(15, 0, 24), Vector3(10, 13, 12), "plaster")
	_building("BldgFarW", Vector3(-34, 0, 0), Vector3(8, 11, 30), "plaster")
	_building("BldgFarE", Vector3(34, 0, 0), Vector3(8, 8, 30), "block")
	# covered passage on the west route: a corrugated roof on posts
	_box("PassageRoof", Vector3(-24, 3.6, 0), Vector3(6.5, 0.2, 18), "corrugated", 0.5)
	for z in [-8.0, 0.0, 8.0]:
		_box("Post", Vector3(-27.0, 1.75, z), Vector3(0.3, 3.5, 0.3), "rust", 1.0)
		_box("Post", Vector3(-21.0, 1.75, z), Vector3(0.3, 3.5, 0.3), "rust", 1.0)
	# pedestrian overpass across the plaza (east-west) with ramps
	_box("Overpass", Vector3(0, 4.5, 0), Vector3(22, 0.4, 3.2), "concrete", 0.5)
	_ramp("RampW", Vector3(-11, 0, 0), Vector3(-21, 0, 0), 4.7, 3.2)
	_ramp("RampE", Vector3(11, 0, 0), Vector3(21, 0, 0), 4.7, 3.2)
	_box("RailN", Vector3(0, 5.2, 1.55), Vector3(21, 1.0, 0.1), "rust", 1.0)
	_box("RailS", Vector3(0, 5.2, -1.55), Vector3(21, 1.0, 0.1), "rust", 1.0)
	for x in [-6.0, 6.0]:
		_box("Pier", Vector3(x, 2.15, 0), Vector3(0.8, 4.3, 0.8), "concrete", 0.5)
	# cover: low walls and market stalls around the plaza
	for p in [Vector3(-8, 0.6, -9), Vector3(8, 0.6, 9), Vector3(-9, 0.6, 7), Vector3(9, 0.6, -7)]:
		_box("LowWall", p, Vector3(4.0, 1.2, 0.5), "block", 0.5)
	for p in [Vector3(-12, 0, -2), Vector3(12, 0, 2), Vector3(-3, 0, -13), Vector3(3, 0, 13)]:
		_stall(p)
	# spawn bays
	_spawn_bay(0, Vector3(0, 0, -34))
	_spawn_bay(1, Vector3(0, 0, 34))
	# boundaries
	for b in [[Vector3(0, 10, -HALF), Vector3(HALF * 2, 20, 1)], [Vector3(0, 10, HALF), Vector3(HALF * 2, 20, 1)], [Vector3(-HALF, 10, 0), Vector3(1, 20, HALF * 2)], [Vector3(HALF, 10, 0), Vector3(1, 20, HALF * 2)]]:
		_invisible_wall(b[0], b[1])


# ------------------------------------------------------------------------------------------------ pieces

func _box(n: String, center: Vector3, size: Vector3, mat: String, tile: float) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = n
	body.collision_layer = Targeting.LAYER_WORLD
	body.collision_mask = 0
	body.position = center
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	mi.material_override = _material(mat, tile)
	body.add_child(mi)
	add_child(body)
	return body


func _building(n: String, base: Vector3, size: Vector3, mat: String) -> void:
	_box(n, base + Vector3(0, size.y * 0.5, 0), size, mat, 0.33)
	# a parapet and a dark band of windows sell the scale
	_box(n + "Parapet", base + Vector3(0, size.y + 0.3, 0), Vector3(size.x + 0.3, 0.6, size.z + 0.3), "concrete", 0.5)
	var floors := int(size.y / 3.2)
	for f in floors:
		var y := 1.9 + f * 3.2
		for side in [-1.0, 1.0]:
			var w := MeshInstance3D.new()
			var q := BoxMesh.new()
			q.size = Vector3(size.x * 0.8, 1.3, 0.05)
			w.mesh = q
			w.position = base + Vector3(0, y, side * (size.z * 0.5 + 0.03))
			w.material_override = _window_material()
			add_child(w)


func _ramp(n: String, top: Vector3, bottom: Vector3, height: float, width: float) -> void:
	var run := top.distance_to(bottom)
	var length := sqrt(run * run + height * height)
	var mid := (top + bottom) * 0.5 + Vector3(0, height * 0.5, 0)
	var body := _box(n, mid, Vector3(length, 0.35, width), "concrete", 0.5)
	var dir := (bottom - top).normalized()
	var angle := atan2(height, run)
	# tilt about the axis across the ramp so its high end meets the overpass
	body.rotation = Vector3(0, 0, -angle if dir.x > 0 else angle)


func _stall(p: Vector3) -> void:
	_box("StallCounter", p + Vector3(0, 0.55, 0), Vector3(3.0, 1.1, 1.4), "planks", 0.7)
	for dx in [-1.4, 1.4]:
		_box("StallPole", p + Vector3(dx, 1.4, -0.6), Vector3(0.1, 2.8, 0.1), "rust", 1.0)
	var roof := _box("StallRoof", p + Vector3(0, 2.75, 0), Vector3(3.4, 0.08, 2.2), "corrugated", 0.6)
	roof.rotation.x = 0.12


func _spawn_bay(team: int, center: Vector3) -> void:
	var facing := 1.0 if team == 0 else -1.0
	_box("BayBack", center + Vector3(0, 2.0, -facing * 4.5), Vector3(14, 4.0, 0.6), "block", 0.5)
	_box("BaySideW", center + Vector3(-7, 2.0, 0), Vector3(0.6, 4.0, 9), "block", 0.5)
	_box("BaySideE", center + Vector3(7, 2.0, 0), Vector3(0.6, 4.0, 9), "block", 0.5)
	_box("BayFloor", center + Vector3(0, 0.1, 0), Vector3(13.4, 0.2, 9), "concrete", 0.5)
	for i in 4:
		var m := Marker3D.new()
		m.name = "Spawn%d_%d" % [team, i]
		m.position = center + Vector3(-4.5 + i * 3.0, 0.3, 0)
		# face the plaza: team A looks toward +z (yaw PI), team B toward -z (yaw 0)
		m.rotation.y = PI if team == 0 else 0.0
		m.add_to_group(&"spawn_a" if team == 0 else &"spawn_b")
		add_child(m)


func _objective_pad(p: Vector3, r: float) -> void:
	var mi := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = r
	cyl.bottom_radius = r
	cyl.height = 0.06
	cyl.radial_segments = 48
	mi.mesh = cyl
	mi.position = p
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.95, 0.72, 0.2, 0.35)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.65, 0.15)
	mat.emission_energy_multiplier = 0.8
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.add_to_group(&"objective_point")
	add_child(mi)


func _invisible_wall(center: Vector3, size: Vector3) -> void:
	var body := StaticBody3D.new()
	body.name = "Boundary"
	body.collision_layer = Targeting.LAYER_WORLD
	body.position = center
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	add_child(body)


# ------------------------------------------------------------------------------------------------ look

func _material(set_name: String, tile: float) -> Material:
	var key := "%s@%.2f" % [set_name, tile]
	if _mats.has(key):
		return _mats[key]
	var m := ORMMaterial3D.new()
	var base := "res://assets/textures/%s_" % set_name
	m.albedo_texture = load(base + "diff.webp")
	m.normal_enabled = true
	m.normal_texture = load(base + "nor.webp")
	m.orm_texture = load(base + "arm.webp")
	# world-space triplanar mapping: no UV work on blockout boxes and texel density stays even
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE * tile
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	_mats[key] = m
	return m


func _window_material() -> Material:
	if _mats.has("window"):
		return _mats["window"]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.08, 0.1, 0.12)
	m.metallic = 0.6
	m.roughness = 0.15
	_mats["window"] = m
	return m


func _environment() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	# hazy Lagos late afternoon
	sky_mat.sky_top_color = Color(0.36, 0.52, 0.72)
	sky_mat.sky_horizon_color = Color(0.86, 0.74, 0.6)
	sky_mat.ground_horizon_color = Color(0.6, 0.5, 0.42)
	sky_mat.ground_bottom_color = Color(0.25, 0.22, 0.2)
	sky_mat.sun_angle_max = 20.0
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.05
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_hdr_threshold = 0.95
	env.ssao_enabled = true
	env.ssao_radius = 1.2
	env.fog_enabled = true
	env.fog_light_color = Color(0.85, 0.76, 0.65)
	env.fog_density = 0.004
	env.fog_aerial_perspective = 0.4
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-38, -35, 0)
	sun.light_color = Color(1.0, 0.86, 0.68)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	add_child(sun)
	GameSettings.apply_to_environment(env, sun)
