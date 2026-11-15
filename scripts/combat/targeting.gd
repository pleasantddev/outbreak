class_name Targeting
extends RefCounted
## Physics queries shared by abilities: who is in a sphere, in a melee arc, under the aim ray, in line of sight.

const LAYER_WORLD := 1
const LAYER_CHAMPIONS := 2
const LAYER_PROJECTILES := 8


static func champions_in_sphere(space: PhysicsDirectSpaceState3D, center: Vector3, radius: float) -> Array[Node3D]:
	var q := PhysicsShapeQueryParameters3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	q.shape = sphere
	q.transform = Transform3D(Basis(), center)
	q.collision_mask = LAYER_CHAMPIONS
	var out: Array[Node3D] = []
	for hit in space.intersect_shape(q, 32):
		var c: Object = hit.collider
		if c is Node3D and c.has_method(&"is_alive") and not out.has(c):
			out.append(c)
	return out


## Nothing solid (world geometry) between two points.
static func line_of_sight(space: PhysicsDirectSpaceState3D, from: Vector3, to: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(from, to, LAYER_WORLD)
	return space.intersect_ray(q).is_empty()


## Champions within `reach` of the caster whose direction lies inside the arc around `dir`, with line of sight.
static func melee(caster: Node3D, space: PhysicsDirectSpaceState3D, origin: Vector3, dir: Vector3, reach: float, arc_degrees: float) -> Array[Node3D]:
	var flat_dir := Vector3(dir.x, 0.0, dir.z).normalized()
	var half := deg_to_rad(arc_degrees) * 0.5
	var out: Array[Node3D] = []
	# reach is measured to the target's surface, so search a little wider
	for c in champions_in_sphere(space, origin, reach + 0.6):
		if c == caster:
			continue
		var to := c.global_position + Vector3.UP * 1.0 - origin
		var flat := Vector3(to.x, 0.0, to.z)
		if flat.length() > 0.05 and flat_dir.angle_to(flat.normalized()) > half:
			continue
		if line_of_sight(space, origin, c.global_position + Vector3.UP * 1.0):
			out.append(c)
	return out


## The first thing on a ray (champion or world). Returns {} if nothing within `length`.
static func ray(space: PhysicsDirectSpaceState3D, from: Vector3, dir: Vector3, length: float, exclude: Array[RID], mask: int = LAYER_WORLD | LAYER_CHAMPIONS) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * length, mask, exclude)
	return space.intersect_ray(q)
