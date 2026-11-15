class_name DamageEffect
extends AbilityEffect
## Deals damage to each enemy target: (amount + scaling * caster stat), reduced by the target's defense.

@export var amount: float = 20.0
@export var scaling_stat: StringName = &"attack_power"
@export var scaling: float = 1.0
@export var affects: AbilityDefinition.Affects = AbilityDefinition.Affects.ENEMIES


func apply(ctx: AbilityContext) -> void:
	var raw := Damage.raw(amount, scaling, ctx.caster_attributes.final(scaling_stat))
	var id: StringName = ctx.ability.id if ctx.ability else &""
	for t in ctx.targets:
		if Damage.affects(ctx.caster, t, affects):
			t.health.take_damage(Damage.mitigate(raw, t.attrs.final(&"defense")), ctx.caster, id)


func describe() -> String:
	return "%d damage" % amount
