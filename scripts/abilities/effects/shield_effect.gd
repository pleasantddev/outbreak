class_name ShieldEffect
extends AbilityEffect
## Gives targets a temporary shield that absorbs damage before health.

@export var amount: float = 100.0
@export var duration: float = 3.0
@export var affects: AbilityDefinition.Affects = AbilityDefinition.Affects.SELF_AND_ALLIES


func apply(ctx: AbilityContext) -> void:
	var util := ctx.caster_attributes.final(&"utility_effectiveness")
	for t in ctx.targets:
		if Damage.affects(ctx.caster, t, affects):
			t.health.add_shield(amount * util, duration * util)


func describe() -> String:
	return "%d shield for %.1fs" % [amount, duration]
