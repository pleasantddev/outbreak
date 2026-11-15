class_name GameDefinition
extends Resource
## Base for every static definition under data/. Ids are unique per definition type.

@export var id: StringName
@export var display_name: String = ""
@export_multiline var description: String = ""


## Returns a list of problems; empty means valid. Subclasses extend this and call super().
func validate() -> PackedStringArray:
	var errors := PackedStringArray()
	if id == &"":
		errors.append("%s has no id" % resource_path)
	if display_name.strip_edges() == "":
		errors.append("%s has no display name" % id)
	return errors
