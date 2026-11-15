extends GameTest
## Milestone 1 combat checks, run headless in a small physics world with the real Champion A data.

var world: Node3D
var def: ChampionDefinition


func before_each() -> void:
	def = tree.root.get_node("Registry").champion(&"champion_a")
	world = Node3D.new()
	world.name = "TestWorld"
	tree.root.add_child(world)
	_block(Vector3(0, -0.5, 0), Vector3(200, 1, 200))
	var p := Node3D.new()
	p.add_to_group(&"projectiles")
	world.add_child(p)
	await frames(1)


func after_each() -> void:
	world.queue_free()
	await frames(2)


func _block(center: Vector3, size: Vector3) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = Targeting.LAYER_WORLD
	var s := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	s.shape = box
	b.add_child(s)
	b.position = center
	world.add_child(b)
	return b


func _spawn(pos: Vector3, team: int, yaw := 0.0) -> Champion:
	var c := Champion.new()
	c.definition = def
	c.team = team
	world.add_child(c)
	c.respawn_at(Transform3D(Basis(Vector3.UP, yaw), pos))
	return c


func _settle(c: Champion) -> void:
	# land on the floor before a test measures anything
	for i in 30:
		await frames(1)
		if c.is_on_floor():
			break


func test_data_is_valid() -> void:
	check(def != null, "champion_a loads from the registry")
	if def:
		eq(def.validate().size(), 0, "champion_a validates: %s" % str(def.validate()))


func test_moves_forward_relative_to_aim() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	var start := c.global_position
	c.cmd_aim_yaw = 0.0
	c.cmd_move = Vector2(0, 1)
	await frames(40)
	var moved := c.global_position - start
	check(moved.z < -2.0, "moved toward -z (forward at yaw 0): %s" % str(moved))
	check(absf(moved.x) < 0.3, "no sideways drift: %s" % str(moved))
	c.cmd_aim_yaw = PI / 2.0
	var mid := c.global_position
	await frames(40)
	var moved2 := c.global_position - mid
	check(moved2.x < -2.0, "after turning the aim left, forward is -x: %s" % str(moved2))


func test_jump_leaves_and_returns_to_ground() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	c.cmd_jump = true
	await frames(10)
	check(c.global_position.y > 0.5, "airborne after a jump: y=%.2f" % c.global_position.y)
	await frames(60)
	check(c.is_on_floor(), "lands again")


func test_cooldown_uses_cooldown_reduction() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	c.attrs.add(StatModifier.make(&"cooldown_reduction", 0.2, 0.0, &"test"))
	check(c.abilities.request(AbilityDefinition.Slot.UTILITY), "iron guard starts")
	near(c.abilities.cooldown_left[AbilityDefinition.Slot.UTILITY], 10.0 * 0.8, 0.02, "10 s cooldown with 20% reduction")
	eq(c.abilities.block_reason(AbilityDefinition.Slot.UTILITY), "busy", "busy while recovering")
	await frames(20)
	eq(c.abilities.block_reason(AbilityDefinition.Slot.UTILITY), "cooldown", "then on cooldown")


func test_basic_attack_combo_chains_and_resets() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	var seen: Array[StringName] = []
	c.abilities.cast_started.connect(func(_s: int, a: AbilityDefinition) -> void: seen.append(a.id))
	for i in 3:
		while not c.abilities.request(AbilityDefinition.Slot.BASIC):
			await frames(1)
	eq(seen, [&"vanguard_jab", &"vanguard_cross", &"vanguard_hook"] as Array[StringName], "jab, cross, hook")
	# after the hook the chain ends and the next press starts again from the jab
	while not c.abilities.request(AbilityDefinition.Slot.BASIC):
		await frames(1)
	eq(seen[-1], &"vanguard_jab", "chain restarts")


func test_combo_window_expires() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	c.abilities.request(AbilityDefinition.Slot.BASIC)
	await frames(90)
	var seen: Array[StringName] = []
	c.abilities.cast_started.connect(func(_s: int, a: AbilityDefinition) -> void: seen.append(a.id))
	c.abilities.request(AbilityDefinition.Slot.BASIC)
	eq(seen, [&"vanguard_jab"] as Array[StringName], "a late press starts a new chain")


func test_shield_absorbs_before_health_and_expires() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var h := c.health
	h.add_shield(50.0, 0.5)
	var dealt := h.take_damage(80.0, null, &"test")
	near(dealt, 80.0, 0.001, "all 80 counted")
	near(h.shield_total(), 0.0, 0.001, "shield used up")
	near(h.health, h.max_health - 30.0, 0.001, "30 reached health")
	h.add_shield(40.0, 0.2)
	h.advance(0.3)
	near(h.shield_total(), 0.0, 0.001, "shield expires")


func test_shoulder_charge_travels_its_distance() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	var start := c.global_position
	c.cmd_aim_yaw = 0.0
	check(c.abilities.request(AbilityDefinition.Slot.MOBILITY), "charge starts")
	check(c.is_dashing(), "dashing")
	await frames(40)
	var d := Vector2(c.global_position.x - start.x, c.global_position.z - start.z).length()
	check(d > 7.0 and d < 9.5, "about 8 m: %.2f" % d)


func test_shoulder_charge_stops_on_an_enemy_and_hits_it() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var e := _spawn(Vector3(0, 0.1, -4), 1)
	await _settle(c)
	c.cmd_aim_yaw = 0.0
	c.abilities.request(AbilityDefinition.Slot.MOBILITY)
	await frames(40)
	check(e.health.health < e.health.max_health, "enemy took the charge")
	check(c.global_position.z > -4.0, "stopped at the enemy instead of passing through: z=%.2f" % c.global_position.z)


func test_melee_hits_enemies_in_front_only() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var front := _spawn(Vector3(0, 0.1, -1.8), 1)
	var behind := _spawn(Vector3(0, 0.1, 1.8), 1)
	var ally := _spawn(Vector3(0.4, 0.1, -1.6), 0)
	await _settle(c)
	c.cmd_aim_yaw = 0.0
	c.abilities.request(AbilityDefinition.Slot.BASIC)
	await frames(10)
	check(front.health.health < front.health.max_health, "enemy in front was hit")
	near(behind.health.health, behind.health.max_health, 0.001, "enemy behind untouched")
	near(ally.health.health, ally.health.max_health, 0.001, "ally untouched")
	# jab: (18 + 1.0 * attack 10) mitigated by 20 defense = 28 * 100 / 120
	near(front.health.max_health - front.health.health, 28.0 * 100.0 / 120.0, 0.01, "damage formula")


func test_melee_does_not_hit_through_walls() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var e := _spawn(Vector3(0, 0.1, -2.2), 1)
	_block(Vector3(0, 1.5, -1.1), Vector3(4, 3, 0.2))
	await _settle(c)
	c.abilities.request(AbilityDefinition.Slot.BASIC)
	await frames(10)
	near(e.health.health, e.health.max_health, 0.001, "wall blocks the punch")


func test_spirit_bolt_flies_to_the_reticle() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var e := _spawn(Vector3(0.6, 0.1, -15), 1)
	await _settle(c)
	await _settle(e)
	c.cmd_aim_yaw = 0.0
	c.cmd_aim_pitch = -0.02
	var aim := c.aim_point()
	check(aim.z < -13.0 and aim.z > -16.0, "the reticle ray lands on the enemy: %s" % str(aim))
	check(c.abilities.request(AbilityDefinition.Slot.SECONDARY), "bolt fires")
	await frames(45)
	near(e.health.max_health - e.health.health, (45.0 + 10.0) * 100.0 / 120.0, 0.05, "bolt damage")


func test_death_and_respawn() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var e := _spawn(Vector3(5, 0.1, 0), 1)
	var rs := RespawnService.new()
	rs.mode = tree.root.get_node("Registry").mode(&"sandbox")
	world.add_child(rs)
	var spot := Marker3D.new()
	spot.position = Vector3(20, 0.2, 20)
	world.add_child(spot)
	rs.set_spawns(1, [spot])
	e.abilities.cooldown_left[2] = 5.0
	e.health.take_damage(10000.0, c, &"test")
	check(not e.is_alive(), "dead")
	await frames(2)
	eq(e.state, Champion.State.DEAD, "dead state")
	eq(e.collision_layer, 0, "a dead body does not block")
	near(rs.time_left(e), 3.0, 0.1, "sandbox respawn delay")
	rs.advance(3.1)
	check(e.is_alive(), "back alive")
	near(e.health.health, e.health.max_health, 0.001, "full health")
	near(e.abilities.cooldown_left[2], 0.0, 0.001, "cooldowns reset")
	check(e.global_position.distance_to(spot.position) < 0.5, "at the spawn point")


func test_falling_out_of_the_arena_kills() -> void:
	var c := _spawn(Vector3(500, 0, 500), 0)
	await frames(150)
	check(not c.is_alive(), "out of bounds below the kill plane")


func test_ultimate_charges_from_damage_and_spends() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var e := _spawn(Vector3(0, 0.1, -1.8), 1)
	await _settle(c)
	eq(c.abilities.block_reason(AbilityDefinition.Slot.ULTIMATE), "ultimate not ready", "starts empty")
	e.health.take_damage(200.0, c, &"test")
	near(c.abilities.ult_charge, 200.0 * Damage.ULT_PER_DAMAGE, 0.0001, "charge from damage dealt")
	c.abilities.add_ult_charge(1.0)
	check(c.abilities.request(AbilityDefinition.Slot.ULTIMATE), "ultimate fires when full")
	near(c.abilities.ult_charge, 0.0, 0.0001, "spent")
	await frames(70)
	check(e.health.health < e.health.max_health - 200.0, "quake hurt the enemy")


func test_stun_stops_moving_and_casting() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	await _settle(c)
	var stun := StatusDefinition.new()
	stun.id = &"test_stun"
	stun.display_name = "Stun"
	stun.duration = 0.5
	stun.stun = true
	c.statuses.apply(stun, c)
	eq(c.abilities.block_reason(AbilityDefinition.Slot.BASIC), "stunned", "cannot attack")
	var start := c.global_position
	c.cmd_move = Vector2(0, 1)
	await frames(20)
	check(c.global_position.distance_to(start) < 0.1, "cannot move")
	await frames(30)
	eq(c.abilities.block_reason(AbilityDefinition.Slot.BASIC), "", "free again after it wears off")


func test_slow_status_reduces_speed_then_restores() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	var slow: StatusDefinition = null
	for a in def.abilities:
		if a.slot == AbilityDefinition.Slot.SIGNATURE:
			slow = (a.effects[0] as AreaEffect).effects[1].status
	c.statuses.apply(slow, c)
	near(c.attrs.final(&"move_speed"), def.base_stats.move_speed * 0.6, 0.001, "40% slower")
	c.statuses.advance(slow.duration + 0.1)
	near(c.attrs.final(&"move_speed"), def.base_stats.move_speed, 0.001, "restored")


func test_camera_never_ends_inside_a_wall() -> void:
	var c := _spawn(Vector3(0, 0.1, 0), 0)
	_block(Vector3(0, 2, 1.6), Vector3(6, 4, 0.4))
	var rig := CameraRig.new()
	world.add_child(rig)
	rig.attach(c)
	await _settle(c)
	for yaw in [0.0, 0.8, -0.8, PI]:
		c.cmd_aim_yaw = yaw
		await frames(8)
		var cam := rig.camera.global_position
		var q := PhysicsPointQueryParameters3D.new()
		q.position = cam
		q.collision_mask = Targeting.LAYER_WORLD
		var inside := c.get_world_3d().direct_space_state.intersect_point(q)
		check(inside.is_empty(), "camera inside a wall at yaw %.1f: %s" % [yaw, str(cam)])
	c.cmd_aim_yaw = 0.0
	await frames(8)
	check(rig.camera.global_position.z < 1.4, "the arm pulled in in front of the wall: z=%.2f" % rig.camera.global_position.z)
