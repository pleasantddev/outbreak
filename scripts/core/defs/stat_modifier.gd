class_name StatModifier
extends Resource
## One change to one stat. final = (base + sum(flat)) * (1 + sum(percent)).
## A charm trade-off is two modifiers: one that helps and one that costs.

@export var stat: StringName = &"max_health"
@export var flat: float = 0.0
## 0.2 means +20 percent, -0.15 means -15 percent
@export var percent: float = 0.0
## who added it (charm id, status id, boon id); removal is by source
@export var source: StringName = &""


static func make(p_stat: StringName, p_flat: float, p_percent: float, p_source: StringName = &"") -> StatModifier:
	var m := StatModifier.new()
	m.stat = p_stat
	m.flat = p_flat
	m.percent = p_percent
	m.source = p_source
	return m


## true if this modifier makes its stat worse for the owner
func is_drawback() -> bool:
	return flat < 0.0 or percent < 0.0
