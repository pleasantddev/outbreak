class_name PlayerInput
extends Node
## Reads the InputMap (keyboard, mouse, controller) for the local player and writes the champion's command.
## Ability buttons call the runner; holding the basic attack keeps the combo going.

const PITCH_MIN := deg_to_rad(-70.0)
const PITCH_MAX := deg_to_rad(60.0)
const ABILITY_ACTIONS := [&"basic", &"secondary", &"mobility", &"utility", &"signature", &"ultimate"]

var champion: Champion
var enabled := true


func attach(c: Champion) -> void:
	champion = c


func _ready() -> void:
	if DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if champion == null:
		return
	if event.is_action_pressed(&"pause"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s: float = GameSettings.mouse_sensitivity
		var inv := -1.0 if GameSettings.invert_y else 1.0
		champion.cmd_aim_yaw = wrapf(champion.cmd_aim_yaw - event.relative.x * s, -PI, PI)
		champion.cmd_aim_pitch = clampf(champion.cmd_aim_pitch - event.relative.y * s * inv, PITCH_MIN, PITCH_MAX)


func _physics_process(dt: float) -> void:
	if champion == null or not enabled:
		return
	champion.cmd_move = Input.get_vector(&"move_left", &"move_right", &"move_back", &"move_forward")
	var look := Input.get_vector(&"look_left", &"look_right", &"look_down", &"look_up")
	if look != Vector2.ZERO:
		var s: float = GameSettings.pad_sensitivity * dt
		champion.cmd_aim_yaw = wrapf(champion.cmd_aim_yaw - look.x * s, -PI, PI)
		champion.cmd_aim_pitch = clampf(champion.cmd_aim_pitch + look.y * s * 0.7, PITCH_MIN, PITCH_MAX)
	if Input.is_action_just_pressed(&"jump"):
		champion.cmd_jump = true
	if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and DisplayServer.get_name() != "headless":
		return
	for slot in ABILITY_ACTIONS.size():
		var action: StringName = ABILITY_ACTIONS[slot]
		var held := slot == 0 and Input.is_action_pressed(action)
		if held or Input.is_action_just_pressed(action):
			champion.abilities.request(slot)
