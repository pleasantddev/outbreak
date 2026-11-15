extends SceneTree
## Headless test runner. Loads every res://tests/test_*.gd, runs each method named test_*, prints results and exits
## with code 1 if anything failed. Tests extend GameTest. Async tests may `await` (for frames or timers).
## Run: godot --headless --path . --script res://tests/run_tests.gd [-- --only=name_fragment]

var _failed := 0
var _passed := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	# autoloads are not added for --script runs, so add the ones tests rely on
	for pair in [["EventBus", "res://scripts/core/event_bus.gd"], ["Registry", "res://scripts/core/registry.gd"], ["GameSettings", "res://scripts/core/game_settings.gd"]]:
		if root.get_node_or_null(pair[0]) == null:
			var n: Node = load(pair[1]).new()
			n.name = pair[0]
			root.add_child(n)
	await process_frame
	var only := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.trim_prefix("--only=")
	var files := DirAccess.get_files_at("res://tests")
	files.sort()
	for f in files:
		if not (f.begins_with("test_") and f.ends_with(".gd")):
			continue
		var script: GDScript = load("res://tests/" + f)
		var suite: GameTest = script.new()
		suite.tree = self
		root.add_child(suite)
		for m in suite.get_method_list():
			var name: String = m.name
			if not name.begins_with("test_") or (only != "" and not (f + ":" + name).contains(only)):
				continue
			suite.failures.clear()
			await suite.before_each()
			await suite.call(name)
			await suite.after_each()
			if suite.failures.is_empty():
				_passed += 1
				print("  ok    %s: %s" % [f.trim_suffix(".gd"), name])
			else:
				_failed += 1
				print("  FAIL  %s: %s" % [f.trim_suffix(".gd"), name])
				for msg in suite.failures:
					print("        " + msg)
		suite.queue_free()
		await process_frame
	print("\n%d passed, %d failed" % [_passed, _failed])
	quit(1 if _failed > 0 or _passed == 0 else 0)
