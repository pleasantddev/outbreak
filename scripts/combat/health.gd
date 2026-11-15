class_name Health
extends Node
## Health and shields for one champion. Runs its rules on the authority; clients receive the values.
## Shields absorb damage before health, oldest first, and expire after their duration.

signal changed(health: float, max_health: float, shield: float)
signal died(killer: Node, ability_id: StringName)

var health: float = 1.0
var max_health: float = 1.0
## each entry: {amount: float, time_left: float}
var shields: Array[Dictionary] = []
var dead := false
var _owner_champion: Node


func setup(champion: Node, max_hp: float) -> void:
	_owner_champion = champion
	max_health = max_hp
	health = max_hp
	shields.clear()
	dead = false
	_emit()


func shield_total() -> float:
	var t := 0.0
	for s in shields:
		t += s.amount
	return t


## Applies already-mitigated damage. Returns how much was actually removed (shield plus health).
func take_damage(amount: float, source: Node, ability_id: StringName) -> float:
	if dead or amount <= 0.0:
		return 0.0
	var left := amount
	var i := 0
	while i < shields.size() and left > 0.0:
		var take := minf(shields[i].amount, left)
		shields[i].amount -= take
		left -= take
		if shields[i].amount <= 0.001:
			shields.remove_at(i)
		else:
			i += 1
	var to_health := minf(health, left)
	health -= to_health
	var dealt := amount - left + to_health
	EventBus.champion_damaged.emit(_owner_champion, source, dealt, ability_id)
	_emit()
	if health <= 0.0:
		dead = true
		died.emit(source, ability_id)
		EventBus.champion_died.emit(_owner_champion, source, ability_id)
	return dealt


## Returns the amount actually restored.
func heal(amount: float, source: Node) -> float:
	if dead or amount <= 0.0:
		return 0.0
	var restored := minf(amount, max_health - health)
	health += restored
	if restored > 0.0:
		EventBus.champion_healed.emit(_owner_champion, source, restored)
		_emit()
	return restored


func add_shield(amount: float, duration: float) -> void:
	if dead or amount <= 0.0 or duration <= 0.0:
		return
	shields.append({"amount": amount, "time_left": duration})
	EventBus.champion_shielded.emit(_owner_champion, amount, duration)
	_emit()


## Max health can change mid-match (charms, statuses); keep the same fraction of health.
func set_max_health(new_max: float) -> void:
	var frac := health / max_health if max_health > 0.0 else 1.0
	max_health = new_max
	health = clampf(frac * new_max, 0.0, new_max)
	_emit()


func advance(dt: float) -> void:
	var expired := false
	for s in shields:
		s.time_left -= dt
		expired = expired or s.time_left <= 0.0
	if expired:
		shields = shields.filter(func(s: Dictionary) -> bool: return s.time_left > 0.0)
		_emit()


func _emit() -> void:
	changed.emit(health, max_health, shield_total())
