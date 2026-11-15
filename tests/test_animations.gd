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


func test_every_body_has_every_animated_bone() -> void:
	# all skeletons are retargeted on import to Godot's humanoid profile (tools/retarget.gd); tracks address
	# %GeneralSkeleton:<Bone>, so every body must carry every bone the clips move
	var animated := {}
	for path in ChampionVisual.LIBS.values():
		var n: Node = load(path).instantiate()
		var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
		for clip in ap.get_animation_list():
			var a := ap.get_animation(clip)
			for t in a.get_track_count():
				var tp := String(a.track_get_path(t))
				check(tp.begins_with("%GeneralSkeleton:"), "%s track %s does not target the shared skeleton" % [clip, tp])
				animated[tp.get_slice(":", 1)] = true
		n.free()
	for path in ["res://assets/characters/realistic/survivor.glb", "res://assets/characters/rocketbox/male_adult_18/Male_Adult_18.fbx",
			"res://assets/characters/rocketbox/male_adult_12/Male_Adult_12.fbx", "res://assets/characters/rocketbox/male_adult_04/Male_Adult_04.fbx",
			"res://assets/characters/rocketbox/female_party_02/Female_Party_02.fbx", "res://assets/characters/rocketbox/military_male_06/Military_Male_06.fbx"]:
		var body: Node = load(path).instantiate()
		var sks := body.find_children("*", "Skeleton3D", true, false)
		if not check(not sks.is_empty() and sks[0].name == &"GeneralSkeleton", "%s has no retargeted GeneralSkeleton" % path.get_file()):
			body.free()
			continue
		var sk: Skeleton3D = sks[0]
		var missing: Array = []
		for bone in animated:
			if sk.find_bone(bone) < 0 and not bone.ends_with("leaf_l") and not bone.ends_with("leaf_r"):
				missing.append(bone)
		check(missing.is_empty(), "%s lacks animated bones %s" % [path.get_file(), str(missing)])
		body.free()
