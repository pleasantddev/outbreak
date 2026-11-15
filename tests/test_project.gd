extends GameTest
## Project-level checks: input actions exist for keyboard/mouse and controller, data loads clean, cosmetics carry no stats.

const ACTIONS := ["move_forward", "move_back", "move_left", "move_right", "look_up", "look_down", "look_left", "look_right",
	"jump", "basic", "secondary", "mobility", "utility", "signature", "ultimate", "scoreboard", "pause"]
const LOOK_ONLY_PAD := ["look_up", "look_down", "look_left", "look_right"]


func test_every_action_has_keyboard_or_mouse_and_controller() -> void:
	for a in ACTIONS:
		if not check(InputMap.has_action(a), "missing action %s" % a):
			continue
		var kbm := false
		var pad := false
		for e in InputMap.action_get_events(a):
			kbm = kbm or e is InputEventKey or e is InputEventMouseButton
			pad = pad or e is InputEventJoypadButton or e is InputEventJoypadMotion
			check(e.device == -1, "%s has an event bound to device %d, not all devices" % [a, e.device])
		check(pad, "%s has no controller binding" % a)
		check(kbm or a in LOOK_ONLY_PAD, "%s has no keyboard or mouse binding" % a)


func test_ability_slots_have_actions() -> void:
	for action in AbilityDefinition.SLOT_ACTIONS:
		check(InputMap.has_action(action), "slot action %s missing" % action)


func test_registry_loads_without_problems() -> void:
	var reg: Node = tree.root.get_node("Registry")
	reg.reload()
	eq(reg.errors.size(), 0, "registry problems: %s" % str(reg.errors))


func test_cosmetics_have_no_stat_fields() -> void:
	var c := CosmeticDefinition.new()
	for p in c.get_property_list():
		var n: String = p.name
		check(not (n.contains("modifier") or n in StatBlock.STATS or n.contains("ability")), "cosmetics must not carry stats, found %s" % n)


func test_main_scene_is_set_and_loads() -> void:
	var path: String = ProjectSettings.get_setting("application/run/main_scene")
	check(ResourceLoader.exists(path), "main scene %s exists" % path)
	check(load(path) is PackedScene, "main scene loads")


func test_main_scene_instantiates() -> void:
	var scene: PackedScene = load(ProjectSettings.get_setting("application/run/main_scene"))
	var n := scene.instantiate()
	check(n != null and n.get_script() != null, "main scene root has its script")
	n.free()

