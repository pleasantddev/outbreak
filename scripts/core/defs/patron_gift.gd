class_name PatronGift
extends GameDefinition
## The always-on passive a playable patron grants. Stat changes plus triggered effects.

enum Trigger { ON_HIT, ON_KILL, ON_LOW_HEALTH, ON_ABILITY_CAST, ON_OBJECTIVE_TICK }

@export var modifiers: Array[StatModifier] = []
## trigger (Trigger enum value) -> Array[AbilityEffect]
@export var triggers: Dictionary = {}
## seconds between trigger activations, so procs stay readable
@export var trigger_cooldown: float = 4.0
