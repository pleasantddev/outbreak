class_name Projectile
extends Node3D
## A moving spiritual projectile. Sweeps a sphere along its path every physics step so fast shots cannot pass through
## thin targets. Hit rules run on the authority; the glowing mesh is created only where something renders.

var spec: ProjectileEffect
var ctx: AbilityContext
var velocity := Vector3.ZERO
var travelled := 0.0
var _done := false


func setup(p_spec: ProjectileEffect, p_ctx: AbilityContext) -> void:
	spec = p_spec
	ctx = p_ctx
	velocity = p_ctx.direction.normalized() * p_spec.speed


func _ready() -> void:
	top_level = true
	if DisplayServer.get_name() != "headless":
		_build_visual()


func _physics_process(dt: float) -> void:
	if _done:
		return
	velocity.y -= spec.gravity * dt
	var step := velocity * dt
	var space := get_world_3d().direct_space_state
	var hit := _sweep(space, global_position, step)
	if hit.is_empty():
		global_position += step
		travelled += step.length()
		if travelled >= spec.max_distance:
			_finish()
		return
	global_position = hit.position
	var c: Object = hit.collider
	if c is Node3D and c.has_method(&"is_alive"):
		var t: Node3D = c
		if Damage.affects(ctx.caster, t, AbilityDefinition.Affects.ENEMIES):
			var hit_ctx := ctx.with_targets([t])
			for e in spec.on_hit:
				e.apply(hit_ctx)
	_impact(hit.position)


func _sweep(space: PhysicsDirectSpaceState3D, from: Vector3, step: Vector3) -> Dictionary:
	var exclude: Array[RID] = []
	if is_instance_valid(ctx.caster):
		exclude.append(ctx.caster.get_rid())
	var q := PhysicsShapeQueryParameters3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = spec.radius
	q.shape = sphere
	q.transform = Transform3D(Basis(), from)
	q.motion = step
	q.exclude = exclude
	q.collision_mask = Targeting.LAYER_WORLD | Targeting.LAYER_CHAMPIONS
	var r := space.cast_motion(q)
	if r[0] >= 1.0:
		return {}
	q.transform = Transform3D(Basis(), from + step * r[1])
	var info := space.get_rest_info(q)
	if info.is_empty():
		return {}
	var collider := instance_from_id(info.collider_id)
	return {"position": from + step * r[0], "collider": collider}


func _impact(at: Vector3) -> void:
	if not spec.on_impact.is_empty():
		var impact_ctx := ctx.with_targets([])
		impact_ctx.aim_point = at
		impact_ctx.space = get_world_3d().direct_space_state
		for e in spec.on_impact:
			e.apply(impact_ctx)
	_finish()


func _finish() -> void:
	_done = true
	queue_free()


func _build_visual() -> void:
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = spec.radius
	s.height = spec.radius * 2.0
	s.radial_segments = 12
	s.rings = 6
	m.mesh = s
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = spec.color
	mat.emission_enabled = true
	mat.emission = spec.color
	mat.emission_energy_multiplier = 4.0
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)
