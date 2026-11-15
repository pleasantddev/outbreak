class_name RespawnService
extends Node
## Brings dead champions back after the mode's delay, at a free spawn point of their team. Authority only.

signal scheduled(champion: Node, seconds: float)

@export var mode: MatchModeDefinition
## seconds since the match started (the delay grows with match time)
var match_time := 0.0
## champion -> seconds left
var pending: Dictionary = {}
## team -> Array[Node3D] spawn markers
var spawns: Dictionary = {}


func _ready() -> void:
	EventBus.champion_died.connect(_on_died)


func set_spawns(team: int, markers: Array) -> void:
	spawns[team] = markers


func time_left(c: Node) -> float:
	return pending.get(c, 0.0)


func _on_died(victim: Node, _killer: Node, _ability: StringName) -> void:
	if not is_multiplayer_authority():
		return
	var delay := mode.respawn_delay(match_time) if mode else 5.0
	pending[victim] = delay
	scheduled.emit(victim, delay)


func _physics_process(dt: float) -> void:
	match_time += dt
	advance(dt)


func advance(dt: float) -> void:
	for c in pending.keys():
		if not is_instance_valid(c):
			pending.erase(c)
			continue
		pending[c] -= dt
		if pending[c] <= 0.0:
			pending.erase(c)
			c.respawn_at(pick_spawn(c.team))


## The team's spawn point farthest from any living enemy.
func pick_spawn(team: int) -> Transform3D:
	var markers: Array = spawns.get(team, [])
	if markers.is_empty():
		return Transform3D(Basis(), Vector3(0, 1, 0))
	var best: Node3D = markers[0]
	var best_d := -1.0
	for m: Node3D in markers:
		var nearest := INF
		for c in get_tree().get_nodes_in_group(&"champions"):
			if c.team != team and c.is_alive():
				nearest = minf(nearest, c.global_position.distance_to(m.global_position))
		if nearest > best_d:
			best_d = nearest
			best = m
	return best.global_transform
