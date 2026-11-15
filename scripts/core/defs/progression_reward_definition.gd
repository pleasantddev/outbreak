class_name ProgressionRewardDefinition
extends GameDefinition
## A step on a progression track (account level, champion mastery, patron rank, battle pass tier).
## Rewards are cosmetics, currency, lore or loadout options (sidegrade charms, boons); never raw power.

enum Track { ACCOUNT, CHAMPION_MASTERY, PATRON_RANK, BATTLE_PASS_FREE, BATTLE_PASS_PAID }

@export var track: Track = Track.ACCOUNT
## champion or patron id for mastery and rank tracks
@export var track_owner: StringName = &""
@export var level: int = 1
@export var xp_required: int = 1000
@export var cosmetic: CosmeticDefinition
@export var charm: CharmDefinition
@export var boon_id: StringName = &""
@export var soft_currency: int = 0
@export var title: String = ""
@export_multiline var lore_entry: String = ""
