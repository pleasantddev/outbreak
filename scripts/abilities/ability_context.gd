class_name AbilityContext
extends RefCounted
## Everything an AbilityEffect needs to resolve: who cast it, where they aimed, what was hit, and when.

var ability: AbilityDefinition
var caster: Node3D
var caster_attributes: Attributes
## where the shot leaves from (the champion's muzzle, chest height), in world space
var origin: Vector3
## normalised aim direction from origin toward the reticle's aim point
var direction: Vector3 = Vector3.FORWARD
## the point under the reticle (or the far end of the aim ray)
var aim_point: Vector3
var targets: Array[Node3D] = []
## server time in seconds when the ability resolved
var time: float = 0.0
## the physics world, for effects that need queries (areas, dashes)
var space: PhysicsDirectSpaceState3D


func with_targets(new_targets: Array[Node3D]) -> AbilityContext:
	var c := AbilityContext.new()
	c.ability = ability
	c.caster = caster
	c.caster_attributes = caster_attributes
	c.origin = origin
	c.direction = direction
	c.aim_point = aim_point
	c.targets = new_targets
	c.time = time
	c.space = space
	return c
