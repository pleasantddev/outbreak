class_name Champion
extends CharacterBody3D
## A champion in the arena. Simulates movement, dashes, knockback, death and respawn from a `command` (what its
## controller wants: move, aim, jump). The same code runs offline, on a dedicated server and on a listen host; a
## player's input, a network peer or an AI only ever writes the command.

signal state_changed(state: State)
signal respawned

enum State { IDLE, MOVING, AIRBORNE, CASTING, DASHING, STUNNED, DEAD }

const GRAVITY := 22.0
const JUMP_SPEED := 8.0
const GROUND_ACCEL := 70.0
const AIR_ACCEL := 14.0
const TURN_SPEED := 14.0
## over-the-shoulder camera geometry (shared with CameraRig so the server can rebuild the aim ray)
const PIVOT_HEIGHT := 1.55
const SHOULDER_OFFSET := 0.55
const ARM_LENGTH := 3.2
const AIM_RANGE := 80.0
const MUZZLE_HEIGHT := 1.35
## out of the arena below this height
const KILL_Y := -20.0
## seconds facing the aim after attacking, before turning back to face movement
const COMBAT_FACING := 0.9

@export var definition: ChampionDefinition
@export var team := 0

## what the controller wants this physics step
var cmd_move := Vector2.ZERO
var cmd_aim_yaw := 0.0
var cmd_aim_pitch := 0.0
var cmd_jump := false
var cmd_sprint := false

var state: State = State.IDLE
var attrs: Attributes
var health: Health
var statuses: StatusHost
var abilities: AbilityRunner
var peer_id := 1

var _dash_dir := Vector3.ZERO
var _dash_speed := 0.0
var _dash_left := 0.0
var _dash_stop_on_hit := false
var _dash_on_hit: Array = []
var _dash_ctx: AbilityContext
var _knockback := Vector3.ZERO
var _combat_facing_left := 0.0
var _projectiles: Node


func _ready() -> void:
	add_to_group(&"champions")
	collision_layer = Targeting.LAYER_CHAMPIONS
	collision_mask = Targeting.LAYER_WORLD
	floor_snap_length = 0.3
	floor_max_angle = deg_to_rad(50.0)
	if get_node_or_null("Collision") == null:
		var shape := CollisionShape3D.new()
		shape.name = "Collision"
		var capsule := CapsuleShape3D.new()
		capsule.height = definition.capsule_height if definition else 1.8
		capsule.radius = definition.capsule_radius if definition else 0.4
		shape.shape = capsule
		shape.position.y = capsule.height * 0.5
		add_child(shape)
	health = _child(&"Health", Health)
	statuses = _child(&"StatusHost", StatusHost)
	abilities = _child(&"AbilityRunner", AbilityRunner)
	setup(definition)


func setup(def: ChampionDefinition) -> void:
	definition = def
	attrs = Attributes.new(def.base_stats if def else StatBlock.new())
	attrs.changed.connect(_on_attr_changed)
	health.setup(self, attrs.final(&"max_health"))
	health.died.connect(_on_died)
	statuses.setup(self)
	abilities.setup(self, def)
	cmd_aim_yaw = rotation.y
	EventBus.champion_spawned.emit(self, peer_id, team)


func is_alive() -> bool:
	return not health.dead


func _physics_process(dt: float) -> void:
	if not is_multiplayer_authority():
		return
	simulate(dt)


## One authoritative step. Public so tests and the server can step it explicitly.
func simulate(dt: float) -> void:
	statuses.advance(dt)
	health.advance(dt)
	abilities.advance(dt)
	if health.dead:
		return
	if global_position.y < KILL_Y:
		health.take_damage(health.health + health.shield_total() + 1.0, null, &"out_of_bounds")
		return
	_combat_facing_left = maxf(0.0, _combat_facing_left - dt)
	if abilities.is_busy():
		_combat_facing_left = COMBAT_FACING

	if _dash_left > 0.0:
		_step_dash(dt)
	else:
		_step_move(dt)
	_update_state()


func _step_move(dt: float) -> void:
	var stunned := statuses.is_stunned()
	var rooted := statuses.is_rooted()
	var speed: float = attrs.final(&"move_speed")
	if abilities.is_busy() and abilities.current:
		speed *= abilities.current.move_speed_while_casting
	var wish := Vector3.ZERO
	if not rooted and cmd_move.length() > 0.05:
		var m := cmd_move.limit_length(1.0)
		wish = Basis(Vector3.UP, cmd_aim_yaw) * Vector3(m.x, 0.0, -m.y)
	var target := wish * speed
	var accel := GROUND_ACCEL if is_on_floor() else AIR_ACCEL
	var horiz := Vector3(velocity.x, 0.0, velocity.z).move_toward(target, accel * dt)
	velocity.x = horiz.x
	velocity.z = horiz.z
	if is_on_floor():
		if velocity.y < 0.0:
			velocity.y = -0.1
		if cmd_jump and not stunned and not rooted:
			velocity.y = JUMP_SPEED * sqrt(attrs.final(&"mobility"))
	else:
		velocity.y -= GRAVITY * dt
	cmd_jump = false
	if _knockback.length() > 0.01:
		velocity += _knockback
		_knockback = Vector3.ZERO
	move_and_slide()
	# face the aim while fighting, the movement otherwise
	var face := rotation.y
	if _combat_facing_left > 0.0:
		face = cmd_aim_yaw
	elif horiz.length() > 0.5:
		face = atan2(-horiz.x, -horiz.z)
	if not stunned:
		rotation.y = lerp_angle(rotation.y, face, clampf(TURN_SPEED * dt, 0.0, 1.0))


func _step_dash(dt: float) -> void:
	var step := minf(dt, _dash_left)
	_dash_left -= step
	velocity = _dash_dir * _dash_speed
	rotation.y = atan2(-_dash_dir.x, -_dash_dir.z)
	if _dash_stop_on_hit:
		var space := get_world_3d().direct_space_state
		var ahead := global_position + Vector3.UP + _dash_dir * (_dash_speed * step + 0.6)
		for c in Targeting.champions_in_sphere(space, ahead, 0.7):
			if c != self and Damage.affects(self, c, AbilityDefinition.Affects.ENEMIES):
				var hit_ctx := _dash_ctx.with_targets([c])
				for e: AbilityEffect in _dash_on_hit:
					e.apply(hit_ctx)
				_end_dash()
				return
	move_and_slide()
	if _dash_left <= 0.0 or get_slide_collision_count() > 0 and get_last_slide_collision().get_normal().y < 0.5:
		_end_dash()


func _end_dash() -> void:
	_dash_left = 0.0
	velocity = _dash_dir * minf(_dash_speed, attrs.final(&"move_speed"))


func start_dash(dir: Vector3, distance: float, duration: float, stop_on_hit: bool, on_hit: Array, ctx: AbilityContext) -> void:
	if statuses.is_rooted() or duration <= 0.0:
		return
	_dash_dir = dir
	_dash_speed = distance / duration
	_dash_left = duration
	_dash_stop_on_hit = stop_on_hit
	_dash_on_hit = on_hit
	_dash_ctx = ctx


func is_dashing() -> bool:
	return _dash_left > 0.0


func apply_knockback(impulse: Vector3) -> void:
	if health.dead:
		return
	_knockback += impulse


# ------------------------------------------------------------------------------------------------ aim

## The camera position the aim ray starts from, rebuilt from yaw and pitch alone so the server agrees with the client.
func aim_camera_origin() -> Vector3:
	var pivot := global_position + Vector3.UP * PIVOT_HEIGHT
	var b := aim_basis()
	return pivot + b * Vector3(SHOULDER_OFFSET, 0.0, ARM_LENGTH)


func aim_basis() -> Basis:
	return Basis(Vector3.UP, cmd_aim_yaw) * Basis(Vector3.RIGHT, cmd_aim_pitch)


func muzzle() -> Vector3:
	var fwd := Basis(Vector3.UP, cmd_aim_yaw) * Vector3.FORWARD
	return global_position + Vector3.UP * MUZZLE_HEIGHT + fwd * 0.35


## Where the reticle points: the first world or champion hit along the camera's centre ray, else the far end.
func aim_point() -> Vector3:
	var from := aim_camera_origin()
	var dir := -aim_basis().z
	var exclude: Array[RID] = [get_rid()]
	var hit := Targeting.ray(get_world_3d().direct_space_state, from, dir, AIM_RANGE, exclude)
	return hit.position if not hit.is_empty() else from + dir * AIM_RANGE


func make_context(def: AbilityDefinition) -> AbilityContext:
	var ctx := AbilityContext.new()
	ctx.ability = def
	ctx.caster = self
	ctx.caster_attributes = attrs
	ctx.space = get_world_3d().direct_space_state
	ctx.origin = muzzle()
	ctx.aim_point = aim_point()
	var dir := ctx.aim_point - ctx.origin
	ctx.direction = dir.normalized() if dir.length() > 0.1 else -aim_basis().z
	# a wall between the muzzle and the aim point stops the shot there, even if the camera could see past it
	var exclude: Array[RID] = [get_rid()]
	var block := Targeting.ray(ctx.space, ctx.origin, ctx.direction, dir.length(), exclude, Targeting.LAYER_WORLD)
	if not block.is_empty():
		ctx.aim_point = block.position
	ctx.time = Time.get_ticks_msec() / 1000.0
	return ctx


func projectile_container() -> Node:
	if _projectiles == null or not is_instance_valid(_projectiles):
		var found := get_tree().get_first_node_in_group(&"projectiles")
		_projectiles = found if found else get_parent()
	return _projectiles


# ------------------------------------------------------------------------------------------------ life

func respawn_at(xf: Transform3D) -> void:
	global_transform = Transform3D(Basis(Vector3.UP, xf.basis.get_euler().y), xf.origin)
	cmd_aim_yaw = rotation.y
	cmd_aim_pitch = 0.0
	velocity = Vector3.ZERO
	_knockback = Vector3.ZERO
	_dash_left = 0.0
	statuses.clear()
	health.setup(self, attrs.final(&"max_health"))
	abilities.reset()
	collision_layer = Targeting.LAYER_CHAMPIONS
	_update_state()
	respawned.emit()
	EventBus.champion_respawned.emit(self)


func _on_died(_killer: Node, _ability_id: StringName) -> void:
	velocity = Vector3.ZERO
	_dash_left = 0.0
	statuses.clear()
	abilities.reset()
	# the body no longer blocks shots or other champions
	collision_layer = 0
	_update_state()


func _on_attr_changed(stat: StringName, value: float) -> void:
	if stat == &"max_health" and health:
		health.set_max_health(value)


func _update_state() -> void:
	var s := State.IDLE
	if health.dead:
		s = State.DEAD
	elif statuses.is_stunned():
		s = State.STUNNED
	elif _dash_left > 0.0:
		s = State.DASHING
	elif abilities.is_busy():
		s = State.CASTING
	elif not is_on_floor():
		s = State.AIRBORNE
	elif Vector2(velocity.x, velocity.z).length() > 0.5:
		s = State.MOVING
	if s != state:
		state = s
		state_changed.emit(s)


func _child(child_name: StringName, type: Variant) -> Node:
	var n := get_node_or_null(NodePath(child_name))
	if n == null:
		n = type.new()
		n.name = child_name
		add_child(n)
	return n
