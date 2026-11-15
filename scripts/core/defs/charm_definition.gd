class_name CharmDefinition
extends GameDefinition
## A loadout modifier. Charms are sidegrades: every charm must carry at least one drawback.

enum Size { MINOR, MAJOR }
enum Category { MOBILITY, DEFENSIVE, ABILITY, UTILITY, PATRON }

@export var size: Size = Size.MINOR
@export var category: Category = Category.MOBILITY
@export var modifiers: Array[StatModifier] = []
## per-slot cooldown multipliers, e.g. {AbilityDefinition.Slot.MOBILITY: 0.8}
@export var slot_cooldown_scale: Dictionary = {}
## per-slot duration multipliers for shields, statuses and dashes
@export var slot_duration_scale: Dictionary = {}
## PATRON charms only: the patron whose loadout can hold it
@export var patron_id: StringName = &""


func has_drawback() -> bool:
	for m in modifiers:
		if m and m.is_drawback():
			return true
	for v in slot_cooldown_scale.values():
		if float(v) > 1.0:
			return true
	for v in slot_duration_scale.values():
		if float(v) < 1.0:
			return true
	return false


func has_benefit() -> bool:
	for m in modifiers:
		if m and not m.is_drawback() and (m.flat != 0.0 or m.percent != 0.0):
			return true
	for v in slot_cooldown_scale.values():
		if float(v) < 1.0:
			return true
	for v in slot_duration_scale.values():
		if float(v) > 1.0:
			return true
	return false


func validate() -> PackedStringArray:
	var errors := super()
	if not has_benefit():
		errors.append("%s has no benefit" % id)
	if not has_drawback():
		errors.append("%s has no drawback; charms must be sidegrades" % id)
	if category == Category.PATRON and patron_id == &"":
		errors.append("%s is a patron charm without a patron" % id)
	if category != Category.PATRON and patron_id != &"":
		errors.append("%s names a patron but is not a patron charm" % id)
	return errors
