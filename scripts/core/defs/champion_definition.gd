class_name ChampionDefinition
extends GameDefinition
## A playable champion: role, story, base stats and exactly six abilities (one per slot).

enum Role { VANGUARD, DUELIST, CONTROLLER, SUPPORT, SPECIALIST }

@export var role: Role = Role.VANGUARD
@export_multiline var biography: String = ""
@export var origin: String = ""
@export var base_stats: StatBlock
@export var abilities: Array[AbilityDefinition] = []
## the rigged model scene (client only on dedicated servers)
@export var model: PackedScene
@export var skin: Texture2D
@export var accent_color: Color = Color(0.95, 0.75, 0.2)
@export var capsule_height: float = 1.8
@export var capsule_radius: float = 0.4


func ability_for(slot: AbilityDefinition.Slot) -> AbilityDefinition:
	for a in abilities:
		if a and a.slot == slot:
			return a
	return null


func validate() -> PackedStringArray:
	var errors := super()
	if base_stats == null:
		errors.append("%s has no base stats" % id)
	if abilities.size() != 6:
		errors.append("%s has %d abilities, needs 6" % [id, abilities.size()])
	for s in AbilityDefinition.Slot.values():
		var found := 0
		for a in abilities:
			if a and a.slot == s:
				found += 1
		if found != 1:
			errors.append("%s has %d abilities in slot %s" % [id, found, AbilityDefinition.Slot.keys()[s]])
	for a in abilities:
		if a:
			errors.append_array(a.validate())
	return errors
