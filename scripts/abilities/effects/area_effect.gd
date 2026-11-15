class_name AreaEffect
extends AbilityEffect
## Finds everyone in a sphere (around the caster or the aim point) and runs the inner effects on them.

enum Center { CASTER, AIM_POINT, TARGET }

@export var radius: float = 4.0
@export var center: Center = Center.CASTER
@export var effects: Array[AbilityEffect] = []
## only targets with clear line of sight from the centre are hit (no damage through walls)
@export var needs_line_of_sight: bool = true


func apply(ctx: AbilityContext) -> void:
	var c := ctx.caster.global_position + Vector3.UP * 0.5
	if center == Center.AIM_POINT:
		c = ctx.aim_point + Vector3.UP * 0.5
	elif center == Center.TARGET and not ctx.targets.is_empty():
		c = ctx.targets[0].global_position + Vector3.UP * 0.5
	var hits: Array[Node3D] = []
	for t in Targeting.champions_in_sphere(ctx.space, c, radius):
		if not needs_line_of_sight or Targeting.line_of_sight(ctx.space, c, t.global_position + Vector3.UP):
			hits.append(t)
	var inner := ctx.with_targets(hits)
	inner.origin = c
	for e in effects:
		e.apply(inner)


func describe() -> String:
	return "%.0fm area" % radius
