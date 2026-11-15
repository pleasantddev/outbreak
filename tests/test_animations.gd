extends GameTest
## Every animation the game asks for exists in the imported CC0 libraries (the importer renames "*_Loop" clips).


func _clips() -> Dictionary:
	var out := {}
	for path in ChampionVisual.LIBS.values():
		var n: Node = load(path).instantiate()
		var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
		for a in ap.get_animation_list():
			out[a] = ap.get_animation(a).loop_mode != Animation.LOOP_NONE
		n.free()
	return out


func test_visual_clips_exist_and_locomotion_loops() -> void:
	var clips := _clips()
	for c in ChampionVisual.CLIPS:
		check(clips.has(c), "clip %s missing" % c)
	for c in [&"Idle", &"Jog_Fwd", &"Sprint", &"Jump"]:
		check(clips.get(c, false), "%s should loop" % c)


func test_every_ability_animation_exists() -> void:
	var clips := _clips()
	for def in tree.root.get_node("Registry").all(&"champions"):
		for a: AbilityDefinition in def.abilities:
			var link := a
			while link:
				check(link.animation == &"" or clips.has(link.animation), "%s uses missing clip %s" % [link.id, link.animation])
				link = link.combo_next


func test_character_and_animation_skeletons_match() -> void:
	var body: Node = load("res://assets/characters/male.glb").instantiate()
	var anims: Node = load(ChampionVisual.LIBS[&"core"]).instantiate()
	var a: Skeleton3D = body.find_child("Skeleton3D", true, false)
	var b: Skeleton3D = anims.find_child("Skeleton3D", true, false)
	eq(a.get_bone_count(), b.get_bone_count(), "bone count")
	for i in a.get_bone_count():
		if a.get_bone_name(i) != b.get_bone_name(i):
			check(false, "bone %d differs: %s vs %s" % [i, a.get_bone_name(i), b.get_bone_name(i)])
			break
	eq(body.get_path_to(a), anims.get_path_to(b), "same skeleton path, so tracks resolve")
	body.free()
	anims.free()
