class_name StatusHost
extends Node
## Active statuses on one champion: their stat modifiers, periodic effects and control flags (stun, root, silence).

signal statuses_changed

## status id -> {def: StatusDefinition, time_left: float, tick_left: float, source: Node}
var active: Dictionary = {}
var _champion: Node


func setup(champion: Node) -> void:
	_champion = champion
	clear()


func apply(def: StatusDefinition, source: Node) -> void:
	if def == null or not _champion.is_alive():
		return
	var duration: float = def.duration
	if active.has(def.id):
		if def.refreshes:
			active[def.id].time_left = maxf(active[def.id].time_left, duration)
		return
	active[def.id] = {"def": def, "time_left": duration, "tick_left": def.tick_interval, "source": source}
	_champion.attrs.add_all(def.modifiers, _source_key(def))
	EventBus.status_applied.emit(_champion, def.id, duration)
	statuses_changed.emit()


func remove(id: StringName) -> void:
	if not active.has(id):
		return
	var def: StatusDefinition = active[id].def
	active.erase(id)
	_champion.attrs.remove_source(_source_key(def))
	EventBus.status_removed.emit(_champion, id)
	statuses_changed.emit()


func clear() -> void:
	for id in active.keys():
		remove(id)


func is_stunned() -> bool:
	return _any(&"stun")


func is_rooted() -> bool:
	return _any(&"stun") or _any(&"root")


func is_silenced() -> bool:
	return _any(&"stun") or _any(&"silence")


func advance(dt: float) -> void:
	for id in active.keys():
		var a: Dictionary = active[id]
		a.time_left -= dt
		var def: StatusDefinition = a.def
		if not def.tick_effects.is_empty():
			a.tick_left -= dt
			while a.tick_left <= 0.0 and a.time_left > -def.tick_interval:
				a.tick_left += def.tick_interval
				_tick(def, a.source)
		if a.time_left <= 0.0:
			remove(id)


func _tick(def: StatusDefinition, source: Node) -> void:
	if not is_instance_valid(source) or not _champion.is_alive():
		return
	var ctx := AbilityContext.new()
	ctx.caster = source
	ctx.caster_attributes = source.attrs
	ctx.origin = _champion.global_position
	ctx.targets = [_champion]
	for e in def.tick_effects:
		e.apply(ctx)


func _any(flag: StringName) -> bool:
	for a in active.values():
		if a.def.get(flag):
			return true
	return false


static func _source_key(def: StatusDefinition) -> StringName:
	return StringName("status:" + String(def.id))
