class_name KnockbackEffect
extends AbilityEffect
## Pushes targets away from the caster (or along the aim), with some lift.

@export var force: float = 8.0
@export var lift: float = 3.0
## true: push along the caster's aim; false: push away from the caster's position
@export var along_aim: bool = false
@export var affects: AbilityDefinition.Affects = AbilityDefinition.Affects.ENEMIES


func apply(ctx: AbilityContext) -> void:
	for t in ctx.targets:
		if not Damage.affects(ctx.caster, t, affects):
			continue
		var d := ctx.direction if along_aim else (t.global_position - ctx.caster.global_position)
		d.y = 0.0
		d = d.normalized() if d.length() > 0.01 else -ctx.caster.global_basis.z
		t.apply_knockback(d * force + Vector3.UP * lift)
