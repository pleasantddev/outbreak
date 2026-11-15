extends Control
## First scene. Reads the command line and routes:
##   --sandbox            offline combat sandbox (default while there is no lobby)
##   --server             headless dedicated match server (phase 3)
##   --connect=host:port  join a server (phase 3)
## Arguments after `--` on the Godot command line arrive in OS.get_cmdline_user_args().

const SANDBOX_SCENE := "res://scenes/arena/sandbox.tscn"

@onready var _status: Label = %Status


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var problems := Registry.errors
	if not problems.is_empty():
		_status.text = "Data problems:\n" + "\n".join(problems)
		push_error("Registry reported %d problems" % problems.size())
		return
	var wants_net := "--server" in args
	for a in args:
		wants_net = wants_net or a.begins_with("--connect=")
	if wants_net:
		_status.text = "Multiplayer starts in phase 3. Running the sandbox instead."
	_route.call_deferred(SANDBOX_SCENE)


func _route(path: String) -> void:
	if not ResourceLoader.exists(path):
		_status.text = "Bo Le Ka Ja\nThe combat sandbox is not built yet (%s)." % path
		return
	get_tree().change_scene_to_file(path)
