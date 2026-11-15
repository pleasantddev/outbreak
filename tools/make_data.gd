extends SceneTree
## Writes the starting data files. After this, the .tres files are the source of truth: tune them in the editor.
## Re-running overwrites them, so only re-run when deliberately resetting the prototype kit.
## Run: godot --headless --path . --script res://tools/make_data.gd


func _init() -> void:
	var ok := true
	ok = _save(_champion_a(), "res://data/champions/champion_a.tres") and ok
	ok = _save(_sandbox_mode(), "res://data/modes/sandbox.tres") and ok
	quit(0 if ok else 1)


func _save(r: Resource, path: String) -> bool:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := ResourceSaver.save(r, path)
	print("%s %s" % [path, error_string(err)])
	return err == OK


func _ability(id: String, name: String, slot: AbilityDefinition.Slot, targeting: AbilityDefinition.TargetMode, effects: Array) -> AbilityDefinition:
	var a := AbilityDefinition.new()
	a.id = StringName(id)
	a.display_name = name
	a.slot = slot
	a.targeting = targeting
	for e in effects:
		a.effects.append(e)
	return a


func _damage(amount: float, scaling := 1.0) -> DamageEffect:
	var d := DamageEffect.new()
	d.amount = amount
	d.scaling = scaling
	return d


func _knock(force: float, lift: float) -> KnockbackEffect:
	var k := KnockbackEffect.new()
	k.force = force
	k.lift = lift
	return k


func _status(id: String, name: String, duration: float, mods: Array, stun := false) -> StatusDefinition:
	var s := StatusDefinition.new()
	s.id = StringName(id)
	s.display_name = name
	s.duration = duration
	s.stun = stun
	for m in mods:
		s.modifiers.append(m)
	return s


func _apply(status: StatusDefinition) -> StatusApplyEffect:
	var e := StatusApplyEffect.new()
	e.status = status
	return e


func _area(radius: float, effects: Array, center := AreaEffect.Center.CASTER) -> AreaEffect:
	var a := AreaEffect.new()
	a.radius = radius
	a.center = center
	for e in effects:
		a.effects.append(e)
	return a


## Champion A, Vanguard: a frontline brawler who closes distance, holds space and breaks groups.
func _champion_a() -> ChampionDefinition:
	var c := ChampionDefinition.new()
	c.id = &"champion_a"
	c.display_name = "Vanguard"
	c.description = "Prototype frontline champion. Final name and design are still to be developed."
	c.role = ChampionDefinition.Role.VANGUARD
	c.biography = "Placeholder. A street-hardened fighter from the junctions of Lagos who stands in front so others can move."
	c.origin = "Lagos (placeholder)"
	var st := StatBlock.new()
	st.max_health = 400.0
	st.move_speed = 5.6
	st.attack_power = 10.0
	st.defense = 20.0
	st.ability_power = 0.0
	c.base_stats = st
	c.capsule_height = 1.8
	c.capsule_radius = 0.42
	# realistic human: Microsoft Rocketbox Male_Adult_18 (MIT), retargeted to the shared humanoid skeleton on import
	c.model = load("res://assets/characters/rocketbox/male_adult_18/Male_Adult_18.fbx")
	c.accent_color = Color(0.95, 0.65, 0.2)

	# basic: three-hit combo
	var hook := _ability("vanguard_hook", "Hook", AbilityDefinition.Slot.BASIC, AbilityDefinition.TargetMode.MELEE_ARC, [_damage(30.0), _knock(5.0, 2.0)])
	hook.cast_time = 0.12; hook.recovery = 0.45; hook.reach = 2.6; hook.arc = 110.0; hook.animation = &"hook"
	var cross := _ability("vanguard_cross", "Cross", AbilityDefinition.Slot.BASIC, AbilityDefinition.TargetMode.MELEE_ARC, [_damage(22.0)])
	cross.cast_time = 0.08; cross.recovery = 0.25; cross.reach = 2.5; cross.arc = 80.0; cross.animation = &"cross"; cross.combo_next = hook
	var jab := _ability("vanguard_jab", "Jab", AbilityDefinition.Slot.BASIC, AbilityDefinition.TargetMode.MELEE_ARC, [_damage(18.0)])
	jab.cast_time = 0.06; jab.recovery = 0.22; jab.reach = 2.5; jab.arc = 80.0; jab.animation = &"jab"; jab.combo_next = cross
	jab.move_speed_while_casting = 0.7; cross.move_speed_while_casting = 0.6; hook.move_speed_while_casting = 0.4

	# secondary: aimed spirit bolt
	var bolt_fx := ProjectileEffect.new()
	bolt_fx.speed = 34.0; bolt_fx.radius = 0.3; bolt_fx.max_distance = 45.0; bolt_fx.color = Color(1.0, 0.7, 0.25)
	bolt_fx.on_hit = [_damage(45.0, 1.0)]
	var bolt := _ability("vanguard_spirit_bolt", "Spirit Bolt", AbilityDefinition.Slot.SECONDARY, AbilityDefinition.TargetMode.PROJECTILE, [bolt_fx])
	bolt.cooldown = 3.0; bolt.cast_time = 0.15; bolt.recovery = 0.25; bolt.reach = 45.0; bolt.animation = &"cast_forward"

	# mobility: shoulder charge that stops on the first enemy and knocks them back
	var dash := DashEffect.new()
	dash.distance = 8.0; dash.duration = 0.28; dash.stop_on_hit = true
	dash.on_hit = [_damage(35.0), _knock(9.0, 3.0)]
	var charge := _ability("vanguard_shoulder_charge", "Shoulder Charge", AbilityDefinition.Slot.MOBILITY, AbilityDefinition.TargetMode.SELF, [dash])
	charge.cooldown = 6.0; charge.recovery = 0.1; charge.animation = &"Shield_Dash"; charge.move_speed_while_casting = 1.0

	# utility: a shield on yourself
	var guard_shield := ShieldEffect.new()
	guard_shield.amount = 150.0; guard_shield.duration = 3.0
	var guard := _ability("vanguard_iron_guard", "Iron Guard", AbilityDefinition.Slot.UTILITY, AbilityDefinition.TargetMode.SELF, [guard_shield])
	guard.cooldown = 10.0; guard.recovery = 0.2; guard.animation = &"block"

	# signature: ground slam around you that slows
	var slow := _status("slowed", "Slowed", 1.8, [StatModifier.make(&"move_speed", 0.0, -0.4)])
	var slam := _ability("vanguard_ground_breaker", "Ground Breaker", AbilityDefinition.Slot.SIGNATURE, AbilityDefinition.TargetMode.SELF,
		[_area(4.5, [_damage(60.0), _apply(slow)])])
	slam.cooldown = 9.0; slam.cast_time = 0.4; slam.recovery = 0.35; slam.animation = &"cast_ground"; slam.move_speed_while_casting = 0.0

	# ultimate: a quake that stuns everyone close and hurts everyone in a wider ring
	var stun := _status("stunned", "Stunned", 1.2, [], true)
	var quake := _ability("vanguard_crossing_quake", "Crossing Quake", AbilityDefinition.Slot.ULTIMATE, AbilityDefinition.TargetMode.SELF,
		[_area(4.0, [_apply(stun)]), _area(8.0, [_damage(110.0), _knock(6.0, 4.0)])])
	quake.ult_cost = 1.0; quake.cast_time = 0.6; quake.recovery = 0.4; quake.animation = &"kick_round"; quake.move_speed_while_casting = 0.0

	c.abilities = [jab, bolt, charge, guard, slam, quake]
	return c


func _sandbox_mode() -> MatchModeDefinition:
	var m := MatchModeDefinition.new()
	m.id = &"sandbox"
	m.display_name = "Sandbox"
	m.description = "Practice: no score, quick respawns."
	m.team_size = 4
	m.score_to_win = 1000000
	m.respawn_base = 3.0
	m.respawn_per_minute = 0.0
	m.respawn_max = 3.0
	m.time_limit = 0.0
	m.objective_move_interval = 0.0
	return m
