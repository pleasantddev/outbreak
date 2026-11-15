class_name HealEffect
extends AbilityEffect
## Restores health to allied targets: (amount + scaling * ability power) * utility effectiveness.

@export var amount: float = 40.0
@export var scaling: float = 0.5
@export var affects: AbilityDefinition.Affects = AbilityDefinition.Affects.SELF_AND_ALLIES


func apply(ctx: AbilityContext) -> void:
	var a := ctx.caster_attributes
	var value := Damage.raw(amount, scaling, a.final(&"ability_power")) * a.final(&"utility_effectiveness")
	for t in ctx.targets:
		if Damage.affects(ctx.caster, t, affects):
			t.health.heal(value, ctx.caster)


func describe() -> String:
	return "heals %d" % amount
