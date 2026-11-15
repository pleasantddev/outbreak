class_name DummyBrain
extends Node
## Training dummy controller: strafes back and forth so aim and melee can be practised on a moving target.
## Optionally throws a basic attack at anyone who gets close, to test getting hit.

@export var strafe_period := 3.0
@export var fights_back := false

var champion: Champion
var _t := 0.0


func attach(c: Champion) -> void:
	champion = c
	_t = randf() * strafe_period


func _physics_process(dt: float) -> void:
	if champion == null or not champion.is_alive():
		return
	_t += dt
	var phase := fmod(_t, strafe_period * 2.0)
	champion.cmd_move = Vector2(1.0 if phase < strafe_period else -1.0, 0.0) * 0.6
	if fights_back:
		for c in champion.get_tree().get_nodes_in_group(&"champions"):
			if c != champion and c.team != champion.team and c.is_alive() and c.global_position.distance_to(champion.global_position) < 2.5:
				var to: Vector3 = c.global_position - champion.global_position
				champion.cmd_aim_yaw = atan2(-to.x, -to.z)
				champion.abilities.request(AbilityDefinition.Slot.BASIC)
				break
