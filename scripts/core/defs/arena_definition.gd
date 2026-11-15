class_name ArenaDefinition
extends GameDefinition
## An arena: its scene and where teams spawn and objectives sit (node paths inside the scene).

@export var scene: PackedScene
@export var spawn_group_team_a: StringName = &"spawn_a"
@export var spawn_group_team_b: StringName = &"spawn_b"
@export var objective_group: StringName = &"objective_point"
## anything outside these bounds is out of the arena and kills
@export var bounds: AABB = AABB(Vector3(-60, -20, -60), Vector3(120, 60, 120))
## credit line if map data was used, e.g. OpenStreetMap ODbL
@export var map_data_attribution: String = ""
@export var preview: Texture2D


func validate() -> PackedStringArray:
	var errors := super()
	if scene == null:
		errors.append("%s has no scene" % id)
	return errors
