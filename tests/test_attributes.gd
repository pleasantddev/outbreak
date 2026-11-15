extends GameTest
## The attribute formula: final = (base + flat) * (1 + percent), clamps, removal by source, change signal.


func _stats() -> StatBlock:
	var s := StatBlock.new()
	s.max_health = 300.0
	s.move_speed = 6.0
	s.defense = 20.0
	s.cooldown_reduction = 0.1
	return s


func test_base_values_without_modifiers() -> void:
	var a := Attributes.new(_stats())
	near(a.final(&"max_health"), 300.0)
	near(a.final(&"move_speed"), 6.0)
	near(a.final(&"utility_effectiveness"), 1.0)


func test_flat_then_percent() -> void:
	var a := Attributes.new(_stats())
	a.add(StatModifier.make(&"max_health", 50.0, 0.0, &"charm:a"))
	a.add(StatModifier.make(&"max_health", 0.0, 0.2, &"charm:b"))
	a.add(StatModifier.make(&"max_health", 0.0, -0.1, &"charm:b"))
	near(a.final(&"max_health"), (300.0 + 50.0) * 1.1, 0.001, "(base + flat) * (1 + sum percent)")


func test_remove_by_source() -> void:
	var a := Attributes.new(_stats())
	a.add(StatModifier.make(&"move_speed", 1.0, 0.0, &"status:haste"))
	a.add(StatModifier.make(&"move_speed", 0.0, 0.5, &"status:haste"))
	a.add(StatModifier.make(&"defense", 10.0, 0.0, &"gift"))
	near(a.final(&"move_speed"), 10.5)
	eq(a.remove_source(&"status:haste"), 2, "removed count")
	near(a.final(&"move_speed"), 6.0, 0.0001, "speed back to base")
	near(a.final(&"defense"), 30.0, 0.0001, "other sources untouched")
	check(not a.has_source(&"status:haste"), "source gone")


func test_clamps() -> void:
	var a := Attributes.new(_stats())
	a.add(StatModifier.make(&"cooldown_reduction", 0.9, 0.0, &"x"))
	near(a.final(&"cooldown_reduction"), 0.6, 0.0001, "cooldown reduction capped at 60 percent")
	a.add(StatModifier.make(&"move_speed", 0.0, -5.0, &"root"))
	near(a.final(&"move_speed"), 1.0, 0.0001, "move speed never below 1")
	a.add(StatModifier.make(&"defense", -500.0, 0.0, &"shred"))
	near(a.final(&"defense"), 0.0, 0.0001, "defense never negative")


func test_change_signal_fires_with_new_value() -> void:
	var a := Attributes.new(_stats())
	var seen: Array = []
	a.changed.connect(func(stat: StringName, v: float) -> void: seen.append([stat, v]))
	a.add(StatModifier.make(&"defense", 5.0, 0.0, &"x"))
	check(seen.size() == 1 and seen[0][0] == &"defense" and is_equal_approx(seen[0][1], 25.0), "changed(defense, 25) once, got %s" % str(seen))


func test_add_all_copies_and_tags_source() -> void:
	var a := Attributes.new(_stats())
	var shared := StatModifier.make(&"defense", 5.0, 0.0, &"original")
	a.add_all([shared], &"charm:iron")
	eq(shared.source, &"original", "the definition's modifier is not mutated")
	check(a.has_source(&"charm:iron"), "copy carries the new source")
	near(a.final(&"defense"), 25.0)
