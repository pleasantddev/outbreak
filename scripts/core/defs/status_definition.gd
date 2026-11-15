class_name StatusDefinition
extends GameDefinition
## A timed condition on a champion: stat changes, periodic effects and control flags.

@export var duration: float = 2.0
@export var modifiers: Array[StatModifier] = []
@export var tick_effects: Array[AbilityEffect] = []
@export var tick_interval: float = 1.0
@export var stun: bool = false
@export var root: bool = false
@export var silence: bool = false
## true: reapplying refreshes the duration; false: reapplying is ignored while active
@export var refreshes: bool = true
## shown on the target for readability; client only
@export var tint: Color = Color.WHITE


func validate() -> PackedStringArray:
	var errors := super()
	if duration <= 0.0:
		errors.append("%s needs a positive duration" % id)
	if not tick_effects.is_empty() and tick_interval <= 0.0:
		errors.append("%s ticks but has no tick interval" % id)
	return errors
