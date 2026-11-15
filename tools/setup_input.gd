extends SceneTree
## Writes the game's InputMap into project.godot so the editor shows it and every platform shares it.
## Run: godot --headless --path . --script res://tools/setup_input.gd
## Keyboard and mouse follow CLAUDE.md (LMB basic, RMB secondary, Shift mobility, E utility, Q signature, F ultimate).
## Controller: left stick move, right stick look, south button jump, triggers attack, shoulders and face buttons abilities.

const DEADZONE := 0.2

func _key(code: Key) -> InputEventKey:
	var e := InputEventKey.new()
	e.physical_keycode = code
	return e

func _mouse(button: MouseButton) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = button
	return e

func _pad(button: JoyButton) -> InputEventJoypadButton:
	var e := InputEventJoypadButton.new()
	e.button_index = button
	return e

func _axis(axis: JoyAxis, value: float) -> InputEventJoypadMotion:
	var e := InputEventJoypadMotion.new()
	e.axis = axis
	e.axis_value = value
	return e


func actions() -> Dictionary:
	return {
		"move_forward": [_key(KEY_W), _key(KEY_UP), _axis(JOY_AXIS_LEFT_Y, -1.0)],
		"move_back": [_key(KEY_S), _key(KEY_DOWN), _axis(JOY_AXIS_LEFT_Y, 1.0)],
		"move_left": [_key(KEY_A), _key(KEY_LEFT), _axis(JOY_AXIS_LEFT_X, -1.0)],
		"move_right": [_key(KEY_D), _key(KEY_RIGHT), _axis(JOY_AXIS_LEFT_X, 1.0)],
		"look_up": [_axis(JOY_AXIS_RIGHT_Y, -1.0)],
		"look_down": [_axis(JOY_AXIS_RIGHT_Y, 1.0)],
		"look_left": [_axis(JOY_AXIS_RIGHT_X, -1.0)],
		"look_right": [_axis(JOY_AXIS_RIGHT_X, 1.0)],
		"jump": [_key(KEY_SPACE), _pad(JOY_BUTTON_A)],
		"basic": [_mouse(MOUSE_BUTTON_LEFT), _axis(JOY_AXIS_TRIGGER_RIGHT, 1.0)],
		"secondary": [_mouse(MOUSE_BUTTON_RIGHT), _axis(JOY_AXIS_TRIGGER_LEFT, 1.0)],
		"mobility": [_key(KEY_SHIFT), _pad(JOY_BUTTON_LEFT_SHOULDER)],
		"utility": [_key(KEY_E), _pad(JOY_BUTTON_RIGHT_SHOULDER)],
		"signature": [_key(KEY_Q), _pad(JOY_BUTTON_X)],
		"ultimate": [_key(KEY_F), _pad(JOY_BUTTON_Y)],
		"scoreboard": [_key(KEY_TAB), _pad(JOY_BUTTON_BACK)],
		"pause": [_key(KEY_ESCAPE), _pad(JOY_BUTTON_START)],
		"debug_overlay": [_key(KEY_F3)],
	}


func _init() -> void:
	for name: String in actions():
		var events: Array = actions()[name]
		for e: InputEvent in events:
			e.device = -1  # every keyboard, mouse and controller
		ProjectSettings.set_setting("input/" + name, {"deadzone": DEADZONE, "events": events})
	var err := ProjectSettings.save()
	print("input actions written: %d (%s)" % [actions().size(), error_string(err)])
	quit(0 if err == OK else 1)
