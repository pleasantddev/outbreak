class_name CombatHud
extends CanvasLayer
## In-match HUD for the local champion. Built in code so it scales with the window and stays readable:
## health and shield (bottom left), six ability slots with cooldown sweeps and keys (bottom centre), ultimate meter,
## centre reticle with a hit marker, floating damage numbers, kill feed (top right), respawn countdown.

const KEYS := ["LMB", "RMB", "Shift", "E", "Q", "F"]
const GOLD := Color(0.97, 0.76, 0.22)
const INK := Color(0.07, 0.06, 0.05, 0.82)

var champion: Champion
var respawn: RespawnService

var _hp_bar: ProgressBar
var _shield_bar: ProgressBar
var _hp_label: Label
var _slots: Array[Dictionary] = []
var _ult_bar: ProgressBar
var _ult_label: Label
var _reticle: Control
var _hitmark: Control
var _hitmark_left := 0.0
var _feed: VBoxContainer
var _respawn_label: Label
var _state_label: Label


func attach(c: Champion, r: RespawnService) -> void:
	champion = c
	respawn = r
	_build()
	c.health.changed.connect(_on_health)
	_on_health(c.health.health, c.health.max_health, c.health.shield_total())
	EventBus.champion_damaged.connect(_on_damaged)
	EventBus.champion_died.connect(_on_died)


func _build() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# health (bottom left)
	var hp_box := _panel(root, Control.PRESET_BOTTOM_LEFT, Vector2(24, -96), Vector2(360, 64))
	_hp_label = _label(hp_box, "", 20, Vector2(12, 4))
	_hp_bar = _bar(hp_box, Vector2(12, 34), Vector2(336, 18), Color(0.35, 0.85, 0.45))
	# shield sits as a thin strip just above the health bar, so it never looks like missing health
	_shield_bar = _bar(hp_box, Vector2(12, 27), Vector2(336, 5), Color(0.7, 0.88, 1.0))
	(_shield_bar.get_theme_stylebox("background") as StyleBoxFlat).bg_color = Color(0, 0, 0, 0)

	# abilities (bottom centre)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	row.position = Vector2(-((72 + 10) * 6 - 10) / 2.0, -108)
	root.add_child(row)
	for i in 6:
		var slot := Panel.new()
		slot.custom_minimum_size = Vector2(72, 64)
		slot.add_theme_stylebox_override("panel", _style(INK, GOLD if i == 5 else Color(1, 1, 1, 0.25), 2, 10))
		row.add_child(slot)
		var name_l := _label(slot, "", 10, Vector2(3, 46))
		name_l.size = Vector2(66, 16)
		name_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		var key_l := _label(slot, KEYS[i], 12, Vector2(4, 2))
		key_l.modulate = Color(1, 1, 1, 0.7)
		var sweep := ColorRect.new()
		sweep.color = Color(0, 0, 0, 0.6)
		sweep.position = Vector2(2, 2)
		sweep.size = Vector2(68, 0)
		slot.add_child(sweep)
		var cd := _label(slot, "", 20, Vector2(0, 16))
		cd.size = Vector2(72, 24)
		cd.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var def: AbilityDefinition = champion.abilities.abilities[i]
		name_l.text = def.display_name if def else ""
		_slots.append({"panel": slot, "sweep": sweep, "cd": cd})

	# ultimate meter above the slots
	_ult_bar = _bar(root, Vector2(0, 0), Vector2(482, 8), GOLD)
	_ult_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_ult_bar.position = Vector2(-241, -124)
	_ult_label = _label(root, "", 14, Vector2.ZERO)
	_ult_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_ult_label.position = Vector2(250, -132)

	# reticle and hit marker
	_reticle = _cross(root, 7.0, 2.0, Color(1, 1, 1, 0.9), 4.0)
	_hitmark = _cross(root, 9.0, 2.5, Color(1.0, 0.35, 0.3), 10.0)
	_hitmark.rotation = PI / 4.0
	_hitmark.visible = false

	# kill feed
	_feed = VBoxContainer.new()
	_feed.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_feed.position = Vector2(-380, 20)
	_feed.custom_minimum_size = Vector2(360, 0)
	root.add_child(_feed)

	_respawn_label = _label(root, "", 34, Vector2.ZERO)
	_respawn_label.set_anchors_preset(Control.PRESET_CENTER)
	_respawn_label.position = Vector2(-300, 60)
	_respawn_label.size = Vector2(600, 50)
	_respawn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

	_state_label = _label(root, "", 14, Vector2(24, 20))
	_state_label.modulate = Color(1, 1, 1, 0.65)


func _process(dt: float) -> void:
	if champion == null:
		return
	var ab := champion.abilities
	for i in 6:
		var s: Dictionary = _slots[i]
		var frac := ab.cooldown_fraction(i)
		var reason := ab.block_reason(i)
		(s.sweep as ColorRect).size.y = 60.0 * frac
		(s.sweep as ColorRect).position.y = 2.0 + 60.0 * (1.0 - frac)
		(s.cd as Label).text = "%.1f" % ab.cooldown_left[i] if ab.cooldown_left[i] > 0.0 and ab.charges_left[i] <= 0 else ""
		(s.panel as Panel).modulate = Color(1, 1, 1, 1.0 if reason == "" or reason == "busy" else 0.55)
	_ult_bar.value = ab.ult_charge * 100.0
	_ult_label.text = "ULT READY" if ab.ult_charge >= 1.0 else "%d%%" % int(ab.ult_charge * 100.0)
	_ult_label.modulate = GOLD if ab.ult_charge >= 1.0 else Color(1, 1, 1, 0.7)
	if _hitmark_left > 0.0:
		_hitmark_left -= dt
		_hitmark.visible = _hitmark_left > 0.0
	var left := respawn.time_left(champion) if respawn else 0.0
	_respawn_label.text = "Back in %d" % ceili(left) if not champion.is_alive() and left > 0.0 else ""
	_reticle.visible = champion.is_alive()
	_state_label.text = "%s  %d fps" % [Champion.State.keys()[champion.state].capitalize(), Engine.get_frames_per_second()]


func _on_health(hp: float, max_hp: float, shield: float) -> void:
	_hp_bar.max_value = max_hp
	_hp_bar.value = hp
	_shield_bar.max_value = max_hp
	_shield_bar.value = minf(shield, max_hp)
	_hp_label.text = "%d / %d%s" % [ceili(hp), int(max_hp), ("  +%d" % int(shield)) if shield > 0.5 else ""]


func _on_damaged(target: Node, source: Node, amount: float, _ability: StringName) -> void:
	if source == champion and target != champion and amount > 0.0:
		_hitmark_left = 0.15
		_hitmark.visible = true
		_damage_number(target, amount)


func _on_died(victim: Node, killer: Node, _ability: StringName) -> void:
	var who: String = killer.definition.display_name if killer and killer is Champion else "The city"
	var line := _label(_feed, "%s  defeated  %s" % [_name_of(killer, who), _name_of(victim, "?")], 15, Vector2.ZERO)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	line.modulate = GOLD if killer == champion else (Color(1, 0.5, 0.45) if victim == champion else Color.WHITE)
	get_tree().create_timer(5.0).timeout.connect(line.queue_free)


func _name_of(c: Node, fallback: String) -> String:
	if c == null or not c is Champion:
		return fallback
	return "You" if c == champion else "%s (%s)" % [c.definition.display_name, "ally" if c.team == champion.team else "enemy"]


func _damage_number(target: Node, amount: float) -> void:
	if not target is Node3D:
		return
	var l := Label3D.new()
	l.text = str(roundi(amount))
	l.font_size = 64
	l.outline_size = 12
	l.modulate = Color(1.0, 0.92, 0.6)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.no_depth_test = true
	l.pixel_size = 0.004
	(target as Node3D).get_parent().add_child(l)
	l.global_position = (target as Node3D).global_position + Vector3(randf_range(-0.3, 0.3), 2.1, 0)
	var tw := l.create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y + 0.9, 0.7).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, 0.7).set_delay(0.25)
	tw.chain().tween_callback(l.queue_free)


# ------------------------------------------------------------------------------------------------ widgets

func _style(bg: Color, border: Color, bw: int, radius: int) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	return s


func _panel(parent: Control, preset: Control.LayoutPreset, pos: Vector2, size: Vector2) -> Panel:
	var p := Panel.new()
	p.set_anchors_preset(preset)
	p.position = pos
	p.size = size
	p.add_theme_stylebox_override("panel", _style(INK, Color(1, 1, 1, 0.12), 1, 12))
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(p)
	return p


func _label(parent: Node, text: String, size: int, pos: Vector2) -> Label:
	var l := Label.new()
	l.text = text
	l.position = pos
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", 4)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l


func _bar(parent: Control, pos: Vector2, size: Vector2, fill: Color) -> ProgressBar:
	var b := ProgressBar.new()
	b.position = pos
	b.size = size
	b.show_percentage = false
	b.add_theme_stylebox_override("background", _style(Color(0, 0, 0, 0.5), Color(0, 0, 0, 0), 0, 4))
	b.add_theme_stylebox_override("fill", _style(fill, Color(0, 0, 0, 0), 0, 4))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(b)
	return b


func _cross(parent: Control, arm: float, width: float, color: Color, gap: float) -> Control:
	var c := Control.new()
	c.set_anchors_preset(Control.PRESET_CENTER)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(c)
	for d in [Vector2.UP, Vector2.DOWN, Vector2.LEFT, Vector2.RIGHT]:
		var r := ColorRect.new()
		r.color = color
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var horizontal: bool = d.y == 0.0
		r.size = Vector2(arm, width) if horizontal else Vector2(width, arm)
		var off: Vector2 = d * (gap + arm * 0.5)
		r.position = off - r.size * 0.5
		c.add_child(r)
	return c
