class_name PatronBoon
extends PatronGift
## An optional enhancement; the player picks one boon from their patron for each match.
## A boon can also add effects to one ability slot (for example: the mobility ability leaves a slowing trail).

@export var ability_slot: AbilityDefinition.Slot = AbilityDefinition.Slot.MOBILITY
@export var extra_effects: Array[AbilityEffect] = []
## patron rank needed to pick it (0 = from the start)
@export var required_rank: int = 0
