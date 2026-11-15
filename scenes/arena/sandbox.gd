class_name Sandbox
extends Node3D
## Offline combat sandbox (milestone 1): the test arena, the player's champion, three training dummies, respawn and
## the HUD. Everything runs through the same Champion, AbilityRunner and RespawnService the match server will use.

const CHAMPION_ID := &"champion_a"
const MODE_ID := &"sandbox"

var player: Champion
var arena: TestArena
var respawn: RespawnService
var champions: Node3D


func _ready() -> void:
	arena = TestArena.new()
	arena.name = "Arena"
	add_child(arena)
	champions = Node3D.new()
	champions.name = "Champions"
	add_child(champions)
	var projectiles := Node3D.new()
	projectiles.name = "Projectiles"
	projectiles.add_to_group(&"projectiles")
	add_child(projectiles)
	respawn = RespawnService.new()
	respawn.name = "Respawn"
	respawn.mode = Registry.mode(MODE_ID)
	add_child(respawn)
	respawn.set_spawns(0, get_tree().get_nodes_in_group(&"spawn_a"))
	respawn.set_spawns(1, get_tree().get_nodes_in_group(&"spawn_b"))

	var def := Registry.champion(CHAMPION_ID)
	player = spawn(def, 0, respawn.pick_spawn(0))
	var rig := CameraRig.new()
	rig.name = "CameraRig"
	add_child(rig)
	rig.attach(player)
	var input := PlayerInput.new()
	input.name = "PlayerInput"
	add_child(input)
	input.attach(player)

	# dummies on the plaza: one still, one strafing, one that hits back
	var spots := [Vector3(-4, 0.3, 4), Vector3(4, 0.3, 6), Vector3(0, 0.3, 10)]
	var bodies := ["male_adult_12/Male_Adult_12.fbx", "female_party_02/Female_Party_02.fbx", "military_male_06/Military_Male_06.fbx"]
	for i in spots.size():
		var d := spawn(def, 1, Transform3D(Basis(Vector3.UP, 0.0), spots[i]), load("res://assets/characters/rocketbox/%s" % bodies[i]))
		if i > 0:
			var brain := DummyBrain.new()
			brain.fights_back = i == 2
			d.add_child(brain)
			brain.attach(d)
	respawn.set_spawns(1, [_marker(Vector3(0, 0.3, 8)), _marker(Vector3(-5, 0.3, 5)), _marker(Vector3(5, 0.3, 5))])

	if DisplayServer.get_name() != "headless":
		var hud := CombatHud.new()
		hud.name = "HUD"
		add_child(hud)
		hud.attach(player, respawn)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--lineup="):
			var lineup: Node = load("res://tools/lineup.gd").new()
			add_child(lineup)
			lineup.start(self, a.trim_prefix("--lineup="))
		if a.begins_with("--shot="):
			var director: Node = load("res://tools/shot.gd").new()
			add_child(director)
			director.start(self, a.trim_prefix("--shot="))


func spawn(def: ChampionDefinition, team: int, at: Transform3D, body: PackedScene = null) -> Champion:
	var c := Champion.new()
	c.definition = def
	c.team = team
	c.name = "%s_t%d_%d" % [def.id, team, champions.get_child_count()]
	champions.add_child(c)
	c.respawn_at(at)
	if DisplayServer.get_name() != "headless":
		var v := ChampionVisual.new()
		v.name = "Visual"
		v.show_overhead = player != null
		v.model_override = body
		c.add_child(v)
		v.attach(c)
	return c


func _marker(p: Vector3) -> Marker3D:
	var m := Marker3D.new()
	m.position = p
	add_child(m)
	return m
