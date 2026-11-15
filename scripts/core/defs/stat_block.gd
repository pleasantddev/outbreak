class_name StatBlock
extends Resource
## Base attribute values for a champion. Every stat name here is a valid StatModifier.stat.

const STATS: Array[StringName] = [
	&"max_health", &"move_speed", &"attack_power", &"defense", &"ability_power",
	&"cooldown_reduction", &"utility_effectiveness", &"mobility",
]

@export var max_health: float = 250.0
## metres per second
@export var move_speed: float = 6.0
@export var attack_power: float = 0.0
## mitigation: damage taken = raw * 100 / (100 + defense)
@export var defense: float = 0.0
@export var ability_power: float = 0.0
## 0..0.6, applied to cooldowns as (1 - cdr)
@export var cooldown_reduction: float = 0.0
## multiplier on heals, shields and utility durations (1.0 = normal)
@export var utility_effectiveness: float = 1.0
## multiplier on dash distances and jump height (1.0 = normal)
@export var mobility: float = 1.0


func get_base(stat: StringName) -> float:
	assert(stat in STATS, "unknown stat %s" % stat)
	return float(get(stat))
