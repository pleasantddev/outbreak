class_name Covenant
extends RefCounted
## Checks a Loadout against the rules and applies it to a champion's Attributes.
## Rules: a real champion; a playable patron (never a supreme creator, collective category or restricted subject);
## a boon that belongs to that patron and is unlocked; minor charms in minor slots, a major charm in the major slot;
## no charm twice; patron charms only with their own patron.


## Returns a list of problems; empty means the loadout may enter a match.
static func validate(loadout: Loadout, registry: Node, patron_rank: int = 99) -> PackedStringArray:
	var errors := PackedStringArray()
	if loadout == null:
		return PackedStringArray(["no loadout"])
	if registry.champion(loadout.champion_id) == null:
		errors.append("unknown champion %s" % loadout.champion_id)
	var patron: PatronDefinition = registry.patron(loadout.patron_id)
	if patron == null:
		errors.append("unknown patron %s" % loadout.patron_id)
	elif not patron.is_equippable():
		errors.append("%s cannot be equipped (%s)" % [patron.display_name, PatronDefinition.Classification.keys()[patron.classification]])
	else:
		var b := patron.boon(loadout.boon_id)
		if b == null:
			errors.append("boon %s does not belong to %s" % [loadout.boon_id, patron.display_name])
		elif b.required_rank > patron_rank:
			errors.append("boon %s needs patron rank %d" % [loadout.boon_id, b.required_rank])
	var seen := {}
	var slots: Array = [[loadout.minor_charms[0], CharmDefinition.Size.MINOR], [loadout.minor_charms[1], CharmDefinition.Size.MINOR], [loadout.major_charm, CharmDefinition.Size.MAJOR]]
	for entry in slots:
		var cid: StringName = entry[0]
		if cid == &"":
			continue
		var c: CharmDefinition = registry.charm(cid)
		if c == null:
			errors.append("unknown charm %s" % cid)
			continue
		if c.size != entry[1]:
			errors.append("%s is a %s charm in a %s slot" % [c.display_name, CharmDefinition.Size.keys()[c.size].to_lower(), CharmDefinition.Size.keys()[entry[1]].to_lower()])
		if seen.has(cid):
			errors.append("%s is equipped twice" % c.display_name)
		seen[cid] = true
		if c.category == CharmDefinition.Category.PATRON and c.patron_id != loadout.patron_id:
			errors.append("%s only works with patron %s" % [c.display_name, c.patron_id])
	return errors


## Adds the patron gift, the chosen boon and the charms to `attrs`, each under its own source so they can be removed.
static func apply(loadout: Loadout, registry: Node, attrs: Attributes) -> void:
	var patron: PatronDefinition = registry.patron(loadout.patron_id)
	if patron and patron.is_equippable():
		attrs.add_all(patron.gift.modifiers, &"gift:" + patron.id)
		var b := patron.boon(loadout.boon_id)
		if b:
			attrs.add_all(b.modifiers, &"boon:" + b.id)
	for cid in [loadout.minor_charms[0], loadout.minor_charms[1], loadout.major_charm]:
		var c: CharmDefinition = registry.charm(cid) if cid != &"" else null
		if c:
			attrs.add_all(c.modifiers, &"charm:" + c.id)
