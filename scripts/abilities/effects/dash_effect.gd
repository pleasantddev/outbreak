class_name DashEffect
extends AbilityEffect
## Moves the caster quickly along the aim (flattened). If `stop_on_hit`, the dash ends on the first enemy it meets and
## runs `on_hit` against that enemy (a shoulder charge); otherwise it passes through.

@export var distance: float = 7.0
@export var duration: float = 0.25
@export var stop_on_hit: bool = true
@export var on_hit: Array[AbilityEffect] = []


func apply(ctx: AbilityContext) -> void:
	var d := Vector3(ctx.direction.x, 0.0, ctx.direction.z)
	if d.length() < 0.01:
		d = -ctx.caster.global_basis.z
	ctx.caster.start_dash(d.normalized(), distance * ctx.caster_attributes.final(&"mobility"), duration, stop_on_hit, on_hit, ctx)


func describe() -> String:
	return "dash %dm" % distance
