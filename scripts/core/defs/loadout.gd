class_name Loadout
extends Resource
## What a player takes into a match. Stored per account; validated by Covenant before every match.

@export var champion_id: StringName = &""
@export var patron_id: StringName = &""
@export var boon_id: StringName = &""
@export var minor_charms: Array[StringName] = [&"", &""]
@export var major_charm: StringName = &""


func to_dict() -> Dictionary:
	return {
		"champion": String(champion_id), "patron": String(patron_id), "boon": String(boon_id),
		"minor": [String(minor_charms[0]), String(minor_charms[1])], "major": String(major_charm),
	}


static func from_dict(d: Dictionary) -> Loadout:
	var l := Loadout.new()
	l.champion_id = StringName(str(d.get("champion", "")))
	l.patron_id = StringName(str(d.get("patron", "")))
	l.boon_id = StringName(str(d.get("boon", "")))
	var minor: Array = d.get("minor", []) if d.get("minor") is Array else []
	l.minor_charms = [StringName(str(minor[0])) if minor.size() > 0 else &"", StringName(str(minor[1])) if minor.size() > 1 else &""]
	l.major_charm = StringName(str(d.get("major", "")))
	return l
