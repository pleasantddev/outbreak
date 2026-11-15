class_name AbilityRunner
extends Node
## Runs a champion's six-slot kit on the authority: readiness checks, cast (wind-up), resolve, recovery, cooldowns,
## charges, basic-attack combos and ultimate charge. Clients mirror the cast events for animation and HUD.

signal cast_started(slot: int, ability: AbilityDefinition)
signal resolved(slot: int, ability: AbilityDefinition)
signal cooldown_started(slot: int, seconds: float)
signal ult_changed(value: float)

const SLOTS := 6
const BASIC := AbilityDefinition.Slot.BASIC
const ULTIMATE := AbilityDefinition.Slot.ULTIMATE

var abilities: Array[AbilityDefinition] = []
var cooldown_left: PackedFloat32Array
var cooldown_total: PackedFloat32Array
var charges_left: PackedInt32Array
## per-slot multipliers from charms (1.0 = unchanged)
var cooldown_scale: PackedFloat32Array
var ult_charge := 0.0

## the ability being wound up or recovering from; null when free
var current: AbilityDefinition
var current_slot := -1
var cast_left := 0.0
var recovery_left := 0.0
## basic-attack chain: the next link and how long it can still be started
var combo_next: AbilityDefinition
var combo_window_left := 0.0

var _champion: Node


func setup(champion: Node, def: ChampionDefinition) -> void:
	_champion = champion
	abilities.resize(SLOTS)
	for s in SLOTS:
		abilities[s] = def.ability_for(s) if def else null
	cooldown_left = PackedFloat32Array(); cooldown_left.resize(SLOTS)
	cooldown_total = PackedFloat32Array(); cooldown_total.resize(SLOTS)
	cooldown_scale = PackedFloat32Array(); cooldown_scale.resize(SLOTS); cooldown_scale.fill(1.0)
	charges_left = PackedInt32Array(); charges_left.resize(SLOTS)
	reset()
	if not EventBus.champion_damaged.is_connected(_on_damaged):
		EventBus.champion_damaged.connect(_on_damaged)
		EventBus.champion_healed.connect(_on_healed)


## Back to a fresh state (spawn and respawn). Ultimate charge is kept, as in most hero shooters.
func reset() -> void:
	for s in SLOTS:
		cooldown_left[s] = 0.0
		cooldown_total[s] = 0.0
		charges_left[s] = abilities[s].charges if abilities[s] else 0
	current = null
	current_slot = -1
	cast_left = 0.0
	recovery_left = 0.0
	combo_next = null
	combo_window_left = 0.0


func is_busy() -> bool:
	return current != null


func is_casting() -> bool:
	return current != null and cast_left > 0.0


## Why a slot cannot be used right now, or "" if it can.
func block_reason(slot: int) -> String:
	if slot < 0 or slot >= SLOTS or abilities[slot] == null:
		return "no ability"
	if not _champion.is_alive():
		return "dead"
	if _champion.statuses.is_stunned():
		return "stunned"
	if slot != BASIC and _champion.statuses.is_silenced():
		return "silenced"
	if is_busy():
		return "busy"
	if charges_left[slot] <= 0:
		return "cooldown"
	if slot == ULTIMATE and ult_charge + 0.0001 < abilities[slot].ult_cost:
		return "ultimate not ready"
	return ""


## Start an ability. Returns true if it started. Aim comes from the champion's current aim.
func request(slot: int) -> bool:
	if block_reason(slot) != "":
		return false
	var def := abilities[slot]
	if slot == BASIC and combo_next and combo_window_left > 0.0:
		def = combo_next
	current = def
	current_slot = slot
	cast_left = def.cast_time
	recovery_left = def.recovery
	if slot == ULTIMATE:
		_set_ult(ult_charge - def.ult_cost)
	if slot != BASIC or def == abilities[slot]:
		_spend(slot, def)
	cast_started.emit(slot, def)
	EventBus.ability_cast.emit(_champion, def.id, slot)
	if cast_left <= 0.0:
		_resolve()
	return true


func advance(dt: float) -> void:
	for s in SLOTS:
		if cooldown_left[s] > 0.0:
			cooldown_left[s] = maxf(0.0, cooldown_left[s] - dt)
			if cooldown_left[s] == 0.0 and abilities[s]:
				charges_left[s] = mini(charges_left[s] + 1, abilities[s].charges)
				if charges_left[s] < abilities[s].charges:
					_start_cooldown(s)
				EventBus.ability_ready.emit(_champion, s)
	if combo_window_left > 0.0 and current == null:
		combo_window_left -= dt
		if combo_window_left <= 0.0:
			combo_next = null
	if current == null:
		return
	if _champion.statuses.is_stunned():
		# a stun interrupts the wind-up; the cooldown already spent stays spent
		_finish()
		return
	if cast_left > 0.0:
		cast_left -= dt
		if cast_left <= 0.0:
			_resolve()
		return
	recovery_left -= dt
	if recovery_left <= 0.0:
		_finish()


func cooldown_fraction(slot: int) -> float:
	if cooldown_total[slot] <= 0.0:
		return 0.0
	return cooldown_left[slot] / cooldown_total[slot]


func add_ult_charge(amount: float) -> void:
	_set_ult(ult_charge + amount)


func _spend(slot: int, def: AbilityDefinition) -> void:
	charges_left[slot] -= 1
	if def.cooldown > 0.0 and cooldown_left[slot] <= 0.0:
		_start_cooldown(slot)
	elif def.cooldown <= 0.0:
		charges_left[slot] = maxi(charges_left[slot], 1)


func _start_cooldown(slot: int) -> void:
	var def := abilities[slot]
	var cdr: float = _champion.attrs.final(&"cooldown_reduction")
	var t := def.cooldown * (1.0 - cdr) * cooldown_scale[slot]
	cooldown_left[slot] = t
	cooldown_total[slot] = t
	cooldown_started.emit(slot, t)


func _resolve() -> void:
	var def := current
	cast_left = 0.0
	var ctx: AbilityContext = _champion.make_context(def)
	match def.targeting:
		AbilityDefinition.TargetMode.MELEE_ARC:
			ctx.targets = Targeting.melee(_champion, ctx.space, ctx.origin, ctx.direction, def.reach, def.arc)
		AbilityDefinition.TargetMode.SELF:
			ctx.targets = [_champion]
		AbilityDefinition.TargetMode.HITSCAN_AIM:
			var exclude: Array[RID] = [_champion.get_rid()]
			var hit := Targeting.ray(ctx.space, ctx.origin, ctx.direction, def.reach, exclude)
			if not hit.is_empty() and hit.collider is Node3D and hit.collider.has_method(&"is_alive"):
				ctx.targets = [hit.collider]
		AbilityDefinition.TargetMode.GROUND_AIM:
			var flat: Vector3 = ctx.aim_point - _champion.global_position
			if flat.length() > def.reach:
				ctx.aim_point = _champion.global_position + flat.normalized() * def.reach
	for e in def.effects:
		e.apply(ctx)
	if current_slot == BASIC:
		combo_next = def.combo_next
		combo_window_left = def.combo_window if combo_next else 0.0
	resolved.emit(current_slot, def)
	if recovery_left <= 0.0:
		_finish()


func _finish() -> void:
	current = null
	current_slot = -1
	cast_left = 0.0
	recovery_left = 0.0


func _set_ult(v: float) -> void:
	var nv := clampf(v, 0.0, 1.0)
	if nv == ult_charge:
		return
	ult_charge = nv
	ult_changed.emit(nv)
	EventBus.ultimate_charge_changed.emit(_champion, nv)


func _on_damaged(_target: Node, source: Node, amount: float, ability_id: StringName) -> void:
	if source == _champion and current_slot != ULTIMATE and not _is_ult_id(ability_id):
		add_ult_charge(amount * Damage.ULT_PER_DAMAGE)


func _on_healed(_target: Node, source: Node, amount: float) -> void:
	if source == _champion:
		add_ult_charge(amount * Damage.ULT_PER_HEAL)


func _is_ult_id(id: StringName) -> bool:
	return abilities[ULTIMATE] != null and abilities[ULTIMATE].id == id
