class_name ChampionVisual
extends Node3D
## The rigged model and its animations for one champion. Client only: a dedicated server never creates this node.
## Locomotion follows the champion's state and speed; abilities play their one-shot clip; hits flinch; death falls.

const LIBS := {&"core": "res://assets/animations/ual_core.glb", &"combat": "res://assets/animations/ual_combat.glb"}
## Mixamo clips (founder's Adobe account), one per file, named by file. Not in git (licence), so each has a CC0 fallback.
const MIXAMO_DIR := "res://assets/animations/mixamo"
const MIXAMO_LOOPS: Array[StringName] = [&"idle_fight", &"idle_bounce", &"run", &"sprint", &"run_back", &"strafe_left", &"strafe_right"]
const FALLBACK := {
	&"idle_fight": &"Idle", &"idle_bounce": &"Idle", &"run": &"Jog_Fwd", &"sprint": &"Sprint", &"run_back": &"Jog_Fwd",
	&"strafe_left": &"Jog_Fwd", &"strafe_right": &"Jog_Fwd", &"jump": &"Jump", &"jab": &"Punch_Jab", &"cross": &"Punch_Cross",
	&"hook": &"Melee_Hook", &"uppercut": &"Punch_Cross", &"combo4": &"Punch_Jab", &"kick_round": &"NinjaJump_Land",
	&"cast_forward": &"Spell_Simple_Shoot", &"cast_ground": &"NinjaJump_Land", &"block": &"Shield_OneShot", &"hit": &"Hit_Chest",
	&"death": &"Death01",
}
const BLEND := 0.15
## every clip this script asks for by name (checked by tests/test_animations.gd)
const CLIPS: Array[StringName] = [&"idle_fight", &"run", &"sprint", &"run_back", &"strafe_left", &"strafe_right", &"Jump", &"Idle_Shield_Break", &"hit", &"death"]

var champion: Champion
var player: AnimationPlayer
## a different body for this one instance (training dummies, previews); null uses the champion's own model
var model_override: PackedScene
## overhead health bar (off for the local player, whose health is on the HUD)
var show_overhead := true
var _bar_back: MeshInstance3D
var _bar_fill: MeshInstance3D
var _bar_shield: MeshInstance3D
var model: Node3D
var _one_shot_left := 0.0
var _flash_left := 0.0
var _meshes: Array[MeshInstance3D] = []

static var _libraries: Dictionary = {}


func attach(c: Champion) -> void:
	champion = c
	var def := c.definition
	if model_override:
		model = model_override.instantiate()
	elif def and def.model:
		model = def.model.instantiate()
	else:
		model = load("res://assets/characters/male.glb").instantiate()
	var src_path := model_override.resource_path if model_override else (def.model.resource_path if def and def.model else "")
	if src_path.get_extension() == "fbx":
		CharacterSkin.apply(model, src_path)
	# the imported characters face +Z; champions face -Z
	model.rotation.y = PI
	model.position.y = -CharacterSkin.ground_offset(model)
	# models ship their own AnimationPlayer (empty or a rest clip); ours drives the retargeted skeleton instead
	for old in model.find_children("*", "AnimationPlayer", true, false):
		old.queue_free()
	add_child(model)
	for m in model.find_children("*", "MeshInstance3D", true, false):
		_meshes.append(m)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	if def and def.skin and model_override == null:
		for m in _meshes:
			if m.name.begins_with("SuperHero") or m.mesh.get_surface_count() == 1:
				var mat := StandardMaterial3D.new()
				mat.albedo_texture = def.skin
				mat.roughness = 0.75
				m.material_override = mat
	player = AnimationPlayer.new()
	player.name = "AnimationPlayer"
	model.add_child(player)
	player.root_node = NodePath("..")
	for lib_name in LIBS:
		player.add_animation_library(lib_name, _library(lib_name))
	player.add_animation_library(&"mixamo", mixamo_library())
	_tint_team()
	if show_overhead:
		_build_overhead()
		c.health.changed.connect(_on_health_changed)
		_on_health_changed(c.health.health, c.health.max_health, c.health.shield_total())
	c.state_changed.connect(func(_s: Champion.State) -> void: _update_locomotion(true))
	c.abilities.cast_started.connect(_on_cast)
	c.health.died.connect(func(_k: Node, _a: StringName) -> void: _play(&"death", 0.1, 1.0, true))
	c.respawned.connect(_on_respawned)
	EventBus.champion_damaged.connect(_on_damaged)
	_update_locomotion(true)


static func _library(lib_name: StringName) -> AnimationLibrary:
	if _libraries.has(lib_name):
		return _libraries[lib_name]
	var src: Node = load(LIBS[lib_name]).instantiate()
	var ap: AnimationPlayer = src.find_child("AnimationPlayer", true, false)
	var lib := AnimationLibrary.new()
	for anim_name in ap.get_animation_list():
		# the importer already strips "_Loop" from clip names and makes those clips loop
		lib.add_animation(anim_name, ap.get_animation(anim_name))
	src.free()
	_libraries[lib_name] = lib
	return lib


## Every Mixamo file present becomes a clip named after the file. Empty if the folder has none (fresh clone).
static func mixamo_library() -> AnimationLibrary:
	if _libraries.has(&"mixamo"):
		return _libraries[&"mixamo"]
	var lib := AnimationLibrary.new()
	for f in DirAccess.get_files_at(MIXAMO_DIR):
		var file := f.trim_suffix(".remap")
		if not file.ends_with(".fbx"):
			continue
		var scene := load(MIXAMO_DIR.path_join(file)) as PackedScene
		if scene == null:
			continue
		var src := scene.instantiate()
		var ap: AnimationPlayer = src.find_child("AnimationPlayer", true, false)
		if ap and not ap.get_animation_list().is_empty():
			var a: Animation = ap.get_animation(ap.get_animation_list()[0]).duplicate()
			var clip := StringName(file.get_basename())
			a.loop_mode = Animation.LOOP_LINEAR if clip in MIXAMO_LOOPS else Animation.LOOP_NONE
			lib.add_animation(clip, a)
		src.free()
	_libraries[&"mixamo"] = lib
	return lib


func _on_respawned() -> void:
	_one_shot_left = 0.0
	_update_locomotion(true)


func _process(dt: float) -> void:
	if champion == null:
		return
	if _one_shot_left > 0.0:
		_one_shot_left -= dt
		if _one_shot_left <= 0.0:
			_update_locomotion(true)
	elif champion.state in [Champion.State.MOVING, Champion.State.IDLE]:
		_update_locomotion(false)
	if _flash_left > 0.0:
		_flash_left -= dt
		if _flash_left <= 0.0:
			_set_flash(false)


func _update_locomotion(force: bool) -> void:
	if _one_shot_left > 0.0 or champion.state == Champion.State.DEAD:
		return
	var v := Vector3(champion.velocity.x, 0.0, champion.velocity.z)
	var speed := v.length()
	var clip := &"idle_fight"
	var rate := 1.0
	match champion.state:
		Champion.State.AIRBORNE:
			clip = &"Jump"
		Champion.State.DASHING:
			clip = &"sprint"
			rate = 1.5
		Champion.State.STUNNED:
			clip = &"Idle_Shield_Break"
		_:
			if speed > 7.0:
				clip = &"sprint"
			elif speed > 0.6:
				# movement relative to where the body faces: strafe and backpedal while fighting, run otherwise
				var local := champion.global_basis.inverse() * v
				var fwd := -local.z
				var side := local.x
				if fwd < -absf(side) * 0.7:
					clip = &"run_back"
				elif absf(side) > absf(fwd) * 1.2:
					clip = &"strafe_right" if side > 0.0 else &"strafe_left"
				else:
					clip = &"run"
				rate = clampf(speed / 5.6, 0.7, 1.3)
	var full := _resolve(clip)
	if full != &"" and (force or player.current_animation != full):
		player.play(full, BLEND, rate)
	elif full != &"":
		player.speed_scale = rate


func _on_cast(_slot: int, def: AbilityDefinition) -> void:
	if def.animation == &"":
		return
	var secs := def.cast_time + maxf(def.recovery, 0.25)
	_play(def.animation, 0.06, 1.0, false, secs)


func _play(clip: StringName, blend: float, rate: float, hold: bool, seconds: float = -1.0) -> void:
	var full := _resolve(clip)
	if full == &"":
		return
	player.play(full, blend, rate)
	var anim_len := player.get_animation(full).length / rate
	_one_shot_left = INF if hold else (seconds if seconds > 0.0 else anim_len)
	if seconds > 0.0 and anim_len > seconds:
		# speed the clip up so its hit frame lands inside the ability's timing
		player.speed_scale = clampf(anim_len / seconds, 1.0, 2.5)
	else:
		player.speed_scale = 1.0


func _resolve(clip: StringName) -> StringName:
	var mx := StringName("mixamo/%s" % clip)
	if player.has_animation(mx):
		return mx
	var name: StringName = FALLBACK.get(clip, clip)
	for lib_name in LIBS:
		var full := StringName("%s/%s" % [lib_name, name])
		if player.has_animation(full):
			return full
	return &""


func _on_damaged(target: Node, _source: Node, amount: float, _ability: StringName) -> void:
	if target != champion or amount <= 0.0 or not champion.is_alive():
		return
	_flash_left = 0.08
	_set_flash(true)
	if _one_shot_left <= 0.0 and amount > 30.0:
		_play(&"hit", 0.05, 1.2, false)


func _set_flash(on: bool) -> void:
	for m in _meshes:
		var mat := m.material_overlay
		if on:
			if mat == null:
				var f := StandardMaterial3D.new()
				f.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
				f.albedo_color = Color(1, 1, 1, 0.55)
				f.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
				m.set_meta(&"flash", f)
			m.material_overlay = m.get_meta(&"flash")
		else:
			m.material_overlay = null


## A ring under each champion in the team colour, so friend and foe read at a glance.
func _tint_team() -> void:
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.48
	torus.outer_radius = 0.58
	torus.rings = 24
	torus.ring_segments = 6
	ring.mesh = torus
	ring.scale = Vector3(1.0, 0.05, 1.0)
	ring.position.y = 0.04
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.25, 0.75, 1.0) if champion.team == 0 else Color(1.0, 0.3, 0.25)
	ring.material_override = mat
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ring)


## Two unshaded billboard quads: cheap on phones (no viewport textures), readable at range.
func _build_overhead() -> void:
	var holder := Node3D.new()
	holder.position.y = 2.15
	add_child(holder)
	_bar_back = _quad(Color(0, 0, 0, 0.6), 1.0, 0)
	_bar_fill = _quad(Color(0.25, 0.75, 1.0) if champion.team == 0 else Color(1.0, 0.32, 0.27), 0.96, 1)
	_bar_shield = _quad(Color(0.85, 0.92, 1.0, 0.9), 0.96, 2)
	for q in [_bar_back, _bar_fill, _bar_shield]:
		holder.add_child(q)


func _quad(color: Color, width: float, layer: int) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(width, 0.1 if layer == 0 else 0.07)
	# grow from the left edge
	q.center_offset = Vector3(width * 0.5 - 0.5, 0, 0)
	m.mesh = q
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	mat.billboard_keep_scale = true
	mat.albedo_color = color
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.no_depth_test = layer > 0
	mat.render_priority = layer
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return m


func _on_health_changed(hp: float, max_hp: float, shield: float) -> void:
	var f := clampf(hp / max_hp, 0.0, 1.0) if max_hp > 0.0 else 0.0
	var sf := clampf((hp + shield) / max_hp, 0.0, 1.0) if max_hp > 0.0 else 0.0
	_bar_fill.scale.x = maxf(f, 0.001)
	_bar_shield.scale.x = maxf(sf, 0.001)
	_bar_shield.visible = shield > 0.5
	_bar_back.get_parent().visible = hp > 0.0
