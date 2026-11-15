class_name CosmeticDefinition
extends GameDefinition
## A purely visual item. Cosmetics never change stats or abilities; there is deliberately no field that could.

enum Kind { SKIN, EMOTE, VICTORY_POSE, BANNER, ICON, ABILITY_VFX, TITLE }
enum Unlock { DEFAULT, PROGRESSION, ACHIEVEMENT, EVENT, BATTLE_PASS_FREE, BATTLE_PASS_PAID, STORE }

@export var kind: Kind = Kind.SKIN
## champion id this applies to, or empty for account-wide items
@export var champion_id: StringName = &""
@export var unlock: Unlock = Unlock.DEFAULT
## earnable currency price; 0 = not sold for it
@export var price_soft: int = 0
## premium currency price; 0 = not sold for it
@export var price_premium: int = 0
@export var asset: Resource
@export var icon: Texture2D
