extends GameTest
## Definition validation rules: six-slot kits, sidegrade charms, patron classification and the Covenant loadout rules.


class _Noop extends AbilityEffect:
	func apply(_ctx: AbilityContext) -> void:
		pass


func _ability(id: StringName, slot: AbilityDefinition.Slot) -> AbilityDefinition:
	var a := AbilityDefinition.new()
	a.id = id
	a.display_name = String(id)
	a.slot = slot
	a.effects = [_Noop.new()]
	if slot == AbilityDefinition.Slot.ULTIMATE:
		a.ult_cost = 1.0
	return a


func _champion() -> ChampionDefinition:
	var c := ChampionDefinition.new()
	c.id = &"test_vanguard"
	c.display_name = "Test Vanguard"
	c.base_stats = StatBlock.new()
	for s in AbilityDefinition.Slot.values():
		c.abilities.append(_ability(StringName("a%d" % s), s))
	return c


func test_champion_needs_one_ability_per_slot() -> void:
	var c := _champion()
	eq(c.validate().size(), 0, "valid kit: %s" % str(c.validate()))
	c.abilities[5] = _ability(&"dup", AbilityDefinition.Slot.BASIC)
	var errs := c.validate()
	check(errs.size() >= 2, "two basics and no ultimate are both reported: %s" % str(errs))


func test_ultimate_cost_rules() -> void:
	var u := _ability(&"u", AbilityDefinition.Slot.ULTIMATE)
	u.ult_cost = 0.0
	check(not u.validate().is_empty(), "ultimate without a cost is invalid")
	var b := _ability(&"b", AbilityDefinition.Slot.BASIC)
	b.ult_cost = 0.5
	check(not b.validate().is_empty(), "a basic attack cannot spend ultimate charge")


func _charm(id: StringName, mods: Array) -> CharmDefinition:
	var c := CharmDefinition.new()
	c.id = id
	c.display_name = String(id)
	for m in mods:
		c.modifiers.append(m)
	return c


func test_charms_must_be_sidegrades() -> void:
	var pure_buff := _charm(&"buff", [StatModifier.make(&"mobility", 0.0, 0.2)])
	check(pure_buff.validate().has("buff has no drawback; charms must be sidegrades"), "a pure buff is rejected")
	var trade := _charm(&"trade", [StatModifier.make(&"mobility", 0.0, 0.2), StatModifier.make(&"utility_effectiveness", 0.0, -0.15)])
	eq(trade.validate().size(), 0, "a trade-off is accepted")
	var by_cooldown := _charm(&"cd", [StatModifier.make(&"max_health", -25.0, 0.0)])
	by_cooldown.slot_cooldown_scale = {AbilityDefinition.Slot.MOBILITY: 0.8}
	eq(by_cooldown.validate().size(), 0, "a faster cooldown paid for with health is accepted")


func _patron(id: StringName, cls: PatronDefinition.Classification) -> PatronDefinition:
	var p := PatronDefinition.new()
	p.id = id
	p.patron_id = id
	p.display_name = String(id)
	p.tradition_community = "Test tradition"
	p.classification = cls
	p.research_sources = ["test source"]
	return p


func test_supreme_creator_cannot_carry_mechanics_or_be_equipped() -> void:
	var p := _patron(&"PATRON_TEST_CREATOR", PatronDefinition.Classification.SUPREME_CREATOR)
	check(not p.is_equippable(), "supreme creator is never equippable")
	p.gift = PatronGift.new()
	check(not p.validate().is_empty(), "supreme creator with a gift fails validation")


func test_playable_patron_needs_gift_and_boon() -> void:
	var p := _patron(&"PATRON_TEST", PatronDefinition.Classification.PLAYABLE_CANDIDATE)
	check(not p.is_equippable(), "no gift yet")
	p.gift = PatronGift.new()
	p.gift.id = &"gift"
	p.gift.display_name = "Gift"
	var b := PatronBoon.new()
	b.id = &"boon"
	b.display_name = "Boon"
	p.boons = [b]
	check(p.is_equippable(), "gift and boon make it equippable")
	eq(p.validate().size(), 0, "valid: %s" % str(p.validate()))


func test_classified_entries_need_sources() -> void:
	var p := _patron(&"PATRON_LORE", PatronDefinition.Classification.LORE_ONLY)
	p.research_sources = []
	check(not p.validate().is_empty(), "a classified entry without sources fails")
	p.classification = PatronDefinition.Classification.UNVERIFIED
	check(p.validate().is_empty(), "an unverified entry may have no sources yet")


## A stand-in registry so Covenant can be tested without data files.
class _FakeRegistry extends Node:
	var champions := {}
	var patrons := {}
	var charms := {}
	func champion(id: StringName) -> ChampionDefinition: return champions.get(id)
	func patron(id: StringName) -> PatronDefinition: return patrons.get(id)
	func charm(id: StringName) -> CharmDefinition: return charms.get(id)


func _covenant_world() -> _FakeRegistry:
	var r := _FakeRegistry.new()
	var c := _champion()
	r.champions[c.id] = c
	var p := _patron(&"PATRON_TEST", PatronDefinition.Classification.PLAYABLE_CANDIDATE)
	p.gift = PatronGift.new()
	p.gift.modifiers = [StatModifier.make(&"defense", 10.0, 0.0)]
	var b := PatronBoon.new()
	b.id = &"boon_a"
	b.display_name = "Boon A"
	b.modifiers = [StatModifier.make(&"move_speed", 0.0, 0.1)]
	p.boons = [b]
	r.patrons[p.id] = p
	r.patrons[&"PATRON_CREATOR"] = _patron(&"PATRON_CREATOR", PatronDefinition.Classification.SUPREME_CREATOR)
	var minor := _charm(&"minor_a", [StatModifier.make(&"mobility", 0.0, 0.2), StatModifier.make(&"max_health", -20.0, 0.0)])
	var major := _charm(&"major_a", [StatModifier.make(&"ability_power", 30.0, 0.0), StatModifier.make(&"defense", -5.0, 0.0)])
	major.size = CharmDefinition.Size.MAJOR
	r.charms[minor.id] = minor
	r.charms[major.id] = major
	return r


func _loadout() -> Loadout:
	var l := Loadout.new()
	l.champion_id = &"test_vanguard"
	l.patron_id = &"PATRON_TEST"
	l.boon_id = &"boon_a"
	l.minor_charms = [&"minor_a", &""]
	l.major_charm = &"major_a"
	return l


func test_covenant_accepts_a_good_loadout_and_applies_it() -> void:
	var r := _covenant_world()
	var l := _loadout()
	eq(Covenant.validate(l, r).size(), 0, "valid loadout: %s" % str(Covenant.validate(l, r)))
	var attrs := Attributes.new(StatBlock.new())
	Covenant.apply(l, r, attrs)
	near(attrs.final(&"defense"), 10.0 - 5.0, 0.0001, "gift +10, major charm -5")
	near(attrs.final(&"move_speed"), 6.0 * 1.1, 0.0001, "boon +10 percent")
	near(attrs.final(&"max_health"), 250.0 - 20.0, 0.0001, "minor charm drawback")
	r.free()


func test_covenant_rejects_bad_loadouts() -> void:
	var r := _covenant_world()
	var l := _loadout()
	l.patron_id = &"PATRON_CREATOR"
	check(Covenant.validate(l, r).size() >= 1, "supreme creator refused")
	l = _loadout()
	l.minor_charms = [&"major_a", &""]
	l.major_charm = &""
	check(str(Covenant.validate(l, r)).contains("major charm in a minor slot"), "slot size enforced: %s" % str(Covenant.validate(l, r)))
	l = _loadout()
	l.minor_charms = [&"minor_a", &"minor_a"]
	check(str(Covenant.validate(l, r)).contains("equipped twice"), "duplicates refused")
	l = _loadout()
	l.boon_id = &"someone_elses_boon"
	check(str(Covenant.validate(l, r)).contains("does not belong"), "foreign boon refused")
	r.free()


func test_loadout_round_trips_through_a_dictionary() -> void:
	var l := _loadout()
	var back := Loadout.from_dict(l.to_dict())
	eq(back.to_dict(), l.to_dict(), "round trip")
	var junk := Loadout.from_dict({"minor": "not a list", "champion": 5})
	eq(junk.minor_charms.size(), 2, "junk input still yields two minor slots")
