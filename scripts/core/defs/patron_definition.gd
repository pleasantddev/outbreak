class_name PatronDefinition
extends GameDefinition
## A researched Nigerian spiritual figure or tradition, and (only if playable) the game mechanics proposed for it.
## The documented cultural record and the invented game layer are kept in separate groups and must not be mixed.

enum Classification { PLAYABLE_CANDIDATE, LORE_ONLY, SUPREME_CREATOR, COLLECTIVE_CATEGORY, RESTRICTED, UNVERIFIED }
enum ReviewStatus { NOT_REVIEWED, IN_REVIEW, APPROVED, CHANGES_REQUESTED }
enum Approval { DRAFT, PROTOTYPE_ONLY, APPROVED_FOR_RELEASE, WITHDRAWN }

@export_group("Cultural record (documented)")
## stable id such as PATRON_SANGO; `id` mirrors it
@export var patron_id: StringName
@export var alternative_names: PackedStringArray = []
## e.g. "Yoruba (Ìṣẹ̀ṣe)", "Igbo (Odinani)", "Edo"
@export var tradition_community: String = ""
@export var geographic_context: String = ""
@export_multiline var documented_cultural_role: String = ""
@export var research_sources: PackedStringArray = []
@export var pronunciation: String = ""
@export var classification: Classification = Classification.UNVERIFIED
@export var cultural_review_status: ReviewStatus = ReviewStatus.NOT_REVIEWED
@export var approval_status: Approval = Approval.DRAFT

@export_group("Game layer (invented, subject to review)")
@export_multiline var gameplay_identity: String = ""
@export var gift: PatronGift
@export var boons: Array[PatronBoon] = []
@export var charms: Array[CharmDefinition] = []
@export var visual_direction: String = ""
@export var vfx_color: Color = Color.WHITE


## Only playable candidates with a gift and at least one boon may be equipped. This is what stops a supreme creator,
## a collective category or a restricted subject from ever becoming a combat buff.
func is_equippable() -> bool:
	return classification == Classification.PLAYABLE_CANDIDATE and gift != null and not boons.is_empty() \
		and approval_status != Approval.WITHDRAWN


func boon(boon_id: StringName) -> PatronBoon:
	for b in boons:
		if b and b.id == boon_id:
			return b
	return null


func validate() -> PackedStringArray:
	var errors := super()
	if patron_id == &"" or patron_id != id:
		errors.append("%s: patron_id must be set and equal id" % id)
	if tradition_community.strip_edges() == "":
		errors.append("%s has no tradition or community" % id)
	if classification != Classification.UNVERIFIED and research_sources.is_empty():
		errors.append("%s is classified but lists no research sources" % id)
	if classification != Classification.PLAYABLE_CANDIDATE and (gift != null or not boons.is_empty() or not charms.is_empty()):
		errors.append("%s is not a playable candidate but carries game mechanics" % id)
	if classification == Classification.PLAYABLE_CANDIDATE:
		if gift == null:
			errors.append("%s is playable but has no gift" % id)
		for b in boons:
			if b:
				errors.append_array(b.validate())
	return errors
