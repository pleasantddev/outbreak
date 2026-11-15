extends Node
## Loads every definition under data/ once at boot and indexes it by id. Read-only after boot.
## Exported builds rename .tres to .tres.remap, so both are accepted.

const FOLDERS := {
	&"champions": "res://data/champions",
	&"patrons": "res://data/patrons",
	&"abilities": "res://data/abilities",
	&"charms": "res://data/charms",
	&"arenas": "res://data/arenas",
	&"cosmetics": "res://data/cosmetics",
	&"progression": "res://data/progression",
	&"modes": "res://data/modes",
}

var _tables: Dictionary = {}
## problems found while loading (duplicate ids, failed validation); tests assert this is empty
var errors: PackedStringArray = []


func _ready() -> void:
	reload()


func reload() -> void:
	_tables.clear()
	errors.clear()
	for kind: StringName in FOLDERS:
		_tables[kind] = {}
		for path in _list(FOLDERS[kind]):
			var res := load(path)
			if not res is GameDefinition:
				errors.append("%s is not a GameDefinition" % path)
				continue
			var def: GameDefinition = res
			if _tables[kind].has(def.id):
				errors.append("duplicate %s id %s (%s)" % [kind, def.id, path])
				continue
			errors.append_array(def.validate())
			_tables[kind][def.id] = def
	for e in errors:
		push_warning("[Registry] " + e)


func get_def(kind: StringName, id: StringName) -> GameDefinition:
	return _tables.get(kind, {}).get(id)


func all(kind: StringName) -> Array:
	return _tables.get(kind, {}).values()


func champion(id: StringName) -> ChampionDefinition:
	return get_def(&"champions", id) as ChampionDefinition


func patron(id: StringName) -> PatronDefinition:
	return get_def(&"patrons", id) as PatronDefinition


func charm(id: StringName) -> CharmDefinition:
	return get_def(&"charms", id) as CharmDefinition


func mode(id: StringName) -> MatchModeDefinition:
	return get_def(&"modes", id) as MatchModeDefinition


func arena(id: StringName) -> ArenaDefinition:
	return get_def(&"arenas", id) as ArenaDefinition


## Patrons that may be equipped (playable candidates with a gift and boons). Never includes supreme creators.
func equippable_patrons() -> Array:
	return all(&"patrons").filter(func(p: PatronDefinition) -> bool: return p.is_equippable())


static func _list(dir_path: String) -> PackedStringArray:
	var out := PackedStringArray()
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	for f in dir.get_files():
		var name := f.trim_suffix(".remap")
		if name.ends_with(".tres") or name.ends_with(".res"):
			out.append(dir_path.path_join(name))
	for sub in dir.get_directories():
		out.append_array(_list(dir_path.path_join(sub)))
	return out
