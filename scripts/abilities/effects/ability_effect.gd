@abstract
class_name AbilityEffect
extends Resource
## One reusable piece of an ability (damage, heal, shield, dash, area, projectile, status, knockback).
## Effects run on the authority only. They read the caster's Attributes from the context and never touch visuals.


## Apply this effect. `ctx.targets` holds whoever the ability hit; self-targeted effects use `ctx.caster`.
@abstract func apply(ctx: AbilityContext) -> void


## Short human description for tooltips and the champion select screen.
func describe() -> String:
	return get_script().get_global_name()
