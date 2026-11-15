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
			# about one window band in three is lit (someone has a generator running)
			w.material_override = _lit_window_material() if (hash(n + str(f) + str(side)) % 3) == 0 else _window_material()
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
	mat.albedo_color = Color(0.9, 0.15, 0.08, 0.1)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(0.9, 0.18, 0.08)
	mat.emission_energy_multiplier = 0.35
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.add_to_group(&"objective_point")
	add_child(mi)
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = r - 0.12
	torus.outer_radius = r
	torus.rings = 64
	torus.ring_segments = 4
	ring.mesh = torus
	ring.scale = Vector3(1, 0.3, 1)
	ring.position = p + Vector3(0, 0.03, 0)
	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.albedo_color = Color(1.0, 0.25, 0.12)
	rm.emission_enabled = true
	rm.emission = Color(1.0, 0.22, 0.1)
	rm.emission_energy_multiplier = 3.0
	ring.material_override = rm
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ring)


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
	# wet ground after rain: roughness scaled down so lamps smear across the road
	if set_name in ["road", "sidewalk", "concrete"]:
		m.roughness = 0.55
	_mats[key] = m
	return m


func _window_material() -> Material:
	if _mats.has("window"):
		return _mats["window"]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.03, 0.035, 0.04)
	m.metallic = 0.6
	m.roughness = 0.12
	_mats["window"] = m
	return m


## A warm lit window: someone is home on a generator. Emissive only, no light cost.
func _lit_window_material() -> Material:
	if _mats.has("window_lit"):
		return _mats["window_lit"]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.9, 0.62, 0.3)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.62, 0.28)
	m.emission_energy_multiplier = 2.2
	_mats["window_lit"] = m
	return m


# Sodium Noir (the outbreak art direction): dusk sliding into night, a blood-red horizon, a cold moon for shape,
# sodium street lamps carrying the light, fog swallowing distance, wet ground doubling every lamp.
func _environment() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.025, 0.02, 0.035)
	sky_mat.sky_horizon_color = Color(0.32, 0.06, 0.04)
	sky_mat.sky_curve = 0.12
	sky_mat.ground_horizon_color = Color(0.12, 0.03, 0.02)
	sky_mat.ground_bottom_color = Color(0.01, 0.008, 0.008)
	sky_mat.sun_angle_max = 6.0
	sky_mat.sky_energy_multiplier = 1.0
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.3, 0.27, 0.36)
	env.ambient_light_energy = 0.75
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.35
	env.tonemap_white = 6.0
	env.glow_enabled = true
	env.glow_intensity = 0.9
	env.glow_bloom = 0.08
	env.glow_hdr_threshold = 0.85
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
	env.ssao_enabled = true
	env.ssao_radius = 1.4
	env.ssao_intensity = 2.5
	env.ssr_enabled = true
	env.ssr_max_steps = 48
	# depth fog for every tier: distance dissolves into dark red-brown haze
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_light_color = Color(0.15, 0.07, 0.055)
	env.fog_light_energy = 1.0
	env.fog_density = 0.014
	env.fog_sky_affect = 0.6
	env.fog_height = 3.0
	env.fog_height_density = 0.04
	# volumetric fog on PC tiers: the lamps get visible cones in the haze
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.018
	env.volumetric_fog_albedo = Color(0.75, 0.68, 0.66)
	env.volumetric_fog_emission = Color(0.02, 0.004, 0.003)
	env.volumetric_fog_length = 48.0
	env.volumetric_fog_ambient_inject = 0.25
	env.volumetric_fog_sky_affect = 0.2
	# split grade: crushed blacks, a little extra contrast and warmth
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.12
	env.adjustment_saturation = 1.08
	env.adjustment_brightness = 0.98
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	add_child(we)
	# cold moon: low, blue, dim; it gives silhouettes and long shadows, the lamps do the rest
	var moon := DirectionalLight3D.new()
	moon.name = "Moon"
	moon.rotation_degrees = Vector3(-24, 140, 0)
	moon.light_color = Color(0.45, 0.55, 0.85)
	moon.light_energy = 0.8
	moon.light_volumetric_fog_energy = 0.5
	moon.shadow_enabled = true
	add_child(moon)
	GameSettings.apply_to_environment(env, moon)
	_lamps()


## Sodium street lamps along the routes and around the plaza. A third are dead; a couple stutter.
func _lamps() -> void:
	var spots := [
		[Vector3(-12.5, 0, -12.5), 1], [Vector3(12.5, 0, 12.5), 1], [Vector3(12.5, 0, -12.5), 2], [Vector3(-12.5, 0, 12.5), 1],
		[Vector3(-21, 0, -14), 1], [Vector3(-21, 0, 14), 0], [Vector3(21, 0, -6), 1], [Vector3(21, 0, 16), 2],
		[Vector3(-4, 0, -27), 1], [Vector3(4, 0, 27), 1], [Vector3(27, 0, -26), 0], [Vector3(-27, 0, 26), 1],
	]
	var shadowed := 0
	for entry in spots:
		var p: Vector3 = entry[0]
		var mode: int = entry[1]   # 0 dead, 1 on, 2 flickering
		_box("LampPole", p + Vector3(0, 3.0, 0), Vector3(0.16, 6.0, 0.16), "rust", 1.0)
		var toward := (Vector3(0, 0, 0) - p)
		toward.y = 0
		toward = toward.normalized() if toward.length() > 0.1 else Vector3.FORWARD
		var head := p + Vector3(0, 6.0, 0) + toward * 1.1
		_box("LampArm", (p + Vector3(0, 6.0, 0) + head) * 0.5, Vector3(0.1, 0.1, 1.2) if absf(toward.z) > absf(toward.x) else Vector3(1.2, 0.1, 0.1), "rust", 1.0)
		var bulb := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.5, 0.12, 0.3)
		bulb.mesh = bm
		bulb.position = head - Vector3(0, 0.08, 0)
		var on := mode != 0
		var bmat := StandardMaterial3D.new()
		bmat.albedo_color = Color(0.2, 0.15, 0.1)
		if on:
			bmat.emission_enabled = true
			bmat.emission = Color(1.0, 0.55, 0.18)
			bmat.emission_energy_multiplier = 6.0
		bulb.material_override = bmat
		add_child(bulb)
		if not on:
			continue
		var light := SpotLight3D.new()
		light.position = head - Vector3(0, 0.15, 0)
		light.rotation_degrees = Vector3(-90, 0, 0)
		light.light_color = Color(1.0, 0.56, 0.22)
		light.light_energy = 11.0
		light.spot_range = 19.0
		light.spot_angle = 62.0
		light.spot_attenuation = 0.9
		light.light_volumetric_fog_energy = 2.5
		# shadows from a few lamps only: each shadowed light is expensive, especially on phones
		light.shadow_enabled = shadowed < 3 and GameSettings.tier <= GameSettings.Tier.HIGH
		if light.shadow_enabled:
			shadowed += 1
		add_child(light)
		if mode == 2:
			var f := LampFlicker.new()
			f.light = light
			f.bulb = bmat
			add_child(f)
