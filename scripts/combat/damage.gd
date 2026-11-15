class_name Damage
extends RefCounted
## Combat maths in one place, so balance changes touch one file.

## ultimate charge (0..1) gained per point of damage dealt, healing done and second on the objective
const ULT_PER_DAMAGE := 0.01 / 40.0
const ULT_PER_HEAL := 0.01 / 30.0
const ULT_PER_OBJECTIVE_SECOND := 0.02


## raw damage from an effect: its flat amount plus a share of one of the caster's stats
static func raw(amount: float, scaling: float, scaling_value: float) -> float:
	return maxf(0.0, amount + scaling * scaling_value)


## damage taken after defense: raw * 100 / (100 + defense)
static func mitigate(raw_amount: float, defense: float) -> float:
	return raw_amount * 100.0 / (100.0 + maxf(0.0, defense))


## who counts as a valid target for an ability cast by `caster`
static func affects(caster: Node, target: Node, rule: AbilityDefinition.Affects) -> bool:
	if target == null or not target.has_method(&"is_alive") or not target.is_alive():
		return false
	var same: bool = target.team == caster.team
	match rule:
		AbilityDefinition.Affects.ENEMIES:
			return not same
		AbilityDefinition.Affects.ALLIES:
			return same and target != caster
		AbilityDefinition.Affects.SELF_AND_ALLIES:
			return same
		_:
			return true
