class_name StatusApplyEffect
extends AbilityEffect
## Puts a status (slow, stun, burn...) on each target.

@export var status: StatusDefinition
@export var affects: AbilityDefinition.Affects = AbilityDefinition.Affects.ENEMIES


func apply(ctx: AbilityContext) -> void:
	for t in ctx.targets:
		if Damage.affects(ctx.caster, t, affects):
			t.statuses.apply(status, ctx.caster)


func describe() -> String:
	return "applies %s" % (status.display_name if status else "?")
