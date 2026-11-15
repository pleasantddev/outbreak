class_name LampFlicker
extends Node
## A failing sodium lamp: steady most of the time, then stutters for a moment. Presentation only.

var light: Light3D
var bulb: StandardMaterial3D
var _t := 0.0
var _next := 2.0
var _base := 0.0


func _ready() -> void:
	_base = light.light_energy
	_next = randf_range(1.5, 5.0)


func _process(dt: float) -> void:
	_t += dt
	if _t < _next:
		return
	var on := randf() > 0.45
	light.light_energy = _base if on else _base * 0.05
	bulb.emission_energy_multiplier = 6.0 if on else 0.3
	if _t > _next + 0.6:
		light.light_energy = _base
		bulb.emission_energy_multiplier = 6.0
		_t = 0.0
		_next = randf_range(2.0, 6.0)
