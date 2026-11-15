class_name AbilityDefinition
extends GameDefinition
## One ability in a champion's six-slot kit. Behaviour comes from the ordered `effects` list.

enum Slot { BASIC, SECONDARY, MOBILITY, UTILITY, SIGNATURE, ULTIMATE }
enum Targeting { MELEE_ARC, PROJECTILE, HITSCAN_AIM, SELF, GROUND_AIM }

const SLOT_ACTIONS: Array[StringName] = [&"basic", &"secondary", &"mobility", &"utility", &"signature", &"ultimate"]

@export var slot: Slot = Slot.BASIC
@export var targeting: Targeting = Targeting.MELEE_ARC
## seconds, before cooldown reduction
@export var cooldown: float = 0.0
@export var charges: int = 1
## wind-up before the effects resolve (seconds); readable telegraph for opponents
@export var cast_time: float = 0.0
## lockout after resolving (seconds)
@export var recovery: float = 0.0
## metres: melee reach, projectile max distance, ground-aim max distance
@export var reach: float = 2.5
## degrees, MELEE_ARC only
@export var arc: float = 90.0
## 0..1 of the ultimate meter spent (ULTIMATE slot only)
@export var ult_cost: float = 0.0
## 0 = stand still while casting, 1 = full speed
@export var move_speed_while_casting: float = 0.5
@export var effects: Array[AbilityEffect] = []
## next ability in a basic-attack chain, and how long the window to continue it stays open
@export var combo_next: StringName = &""
@export var combo_window: float = 0.6
@export var animation: StringName = &""
## client-only presentation; may be null on a dedicated server
@export var vfx: PackedScene
@export var icon: Texture2D


func validate() -> PackedStringArray:
	var errors := super()
	if cooldown < 0.0 or cast_time < 0.0 or recovery < 0.0:
		errors.append("%s has a negative timing" % id)
	if charges < 1:
		errors.append("%s needs at least one charge" % id)
	if slot == Slot.ULTIMATE and (ult_cost <= 0.0 or ult_cost > 1.0):
		errors.append("%s is an ultimate but ult_cost is not in (0, 1]" % id)
	if slot != Slot.ULTIMATE and ult_cost != 0.0:
		errors.append("%s spends ultimate charge but is not in the ultimate slot" % id)
	if effects.is_empty():
		errors.append("%s has no effects" % id)
	for e in effects:
		if e == null:
			errors.append("%s has an empty effect entry" % id)
	return errors
