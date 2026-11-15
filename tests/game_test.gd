class_name GameTest
extends Node
## Base for test suites run by tests/run_tests.gd. Assertions record failures instead of stopping the run.

var tree: SceneTree
var failures: PackedStringArray = []


func before_each() -> void:
	pass


func after_each() -> void:
	pass


func check(cond: bool, msg: String) -> bool:
	if not cond:
		failures.append(msg)
	return cond


func eq(actual: Variant, expected: Variant, msg: String = "") -> bool:
	return check(actual == expected, "%s expected %s, got %s" % [msg, str(expected), str(actual)])


func near(actual: float, expected: float, tol: float = 0.0001, msg: String = "") -> bool:
	return check(absf(actual - expected) <= tol, "%s expected %.4f, got %.4f" % [msg, expected, actual])


func frames(n: int) -> void:
	for i in n:
		await tree.physics_frame
