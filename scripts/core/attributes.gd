class_name Attributes
extends RefCounted
## Runtime stats for one champion: a base StatBlock plus modifiers from patron gift, boon, charms and statuses.
## final(stat) = (base + sum(flat)) * (1 + sum(percent)), then clamped. Cached until a modifier changes.

signal changed(stat: StringName, value: float)

const CLAMPS := {
	&"max_health": Vector2(1.0, 100000.0),
	&"move_speed": Vector2(1.0, 30.0),
	&"attack_power": Vector2(0.0, 100000.0),
	&"defense": Vector2(0.0, 1000.0),
	&"ability_power": Vector2(0.0, 100000.0),
	&"cooldown_reduction": Vector2(0.0, 0.6),
	&"utility_effectiveness": Vector2(0.1, 5.0),
	&"mobility": Vector2(0.25, 3.0),
}

var base: StatBlock
var _mods: Array[StatModifier] = []
var _cache: Dictionary = {}


func _init(p_base: StatBlock = null) -> void:
	base = p_base if p_base else StatBlock.new()


func final(stat: StringName) -> float:
	if _cache.has(stat):
		return _cache[stat]
	var flat := 0.0
	var pct := 0.0
	for m in _mods:
		if m.stat == stat:
			flat += m.flat
			pct += m.percent
	var v := (base.get_base(stat) + flat) * (1.0 + pct)
	var c: Vector2 = CLAMPS.get(stat, Vector2(-INF, INF))
	v = clampf(v, c.x, c.y)
	_cache[stat] = v
	return v


func add(mod: StatModifier) -> void:
	assert(mod.stat in StatBlock.STATS, "unknown stat %s" % mod.stat)
	_mods.append(mod)
	_invalidate(mod.stat)


func add_all(mods: Array, source: StringName) -> void:
	for m: StatModifier in mods:
		var copy: StatModifier = m.duplicate()
		copy.source = source
		add(copy)


## Removes every modifier added under `source`. Returns how many were removed.
func remove_source(source: StringName) -> int:
	var touched := {}
	var kept: Array[StatModifier] = []
	for m in _mods:
		if m.source == source:
			touched[m.stat] = true
		else:
			kept.append(m)
	var removed := _mods.size() - kept.size()
	_mods = kept
	for s in touched:
		_invalidate(s)
	return removed


func has_source(source: StringName) -> bool:
	for m in _mods:
		if m.source == source:
			return true
	return false


func modifier_count() -> int:
	return _mods.size()


func _invalidate(stat: StringName) -> void:
	var before: float = _cache.get(stat, NAN)
	_cache.erase(stat)
	var after := final(stat)
	if before != after:
		changed.emit(stat, after)
