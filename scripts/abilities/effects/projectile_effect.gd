class_name ProjectileEffect
extends AbilityEffect
## Launches a projectile from the caster's muzzle toward the aim point. On hitting an enemy it runs `on_hit` with that
## enemy as the target; on hitting the world it runs `on_impact` (usually an AreaEffect) at the impact point.

@export var speed: float = 32.0
@export var radius: float = 0.3
@export var max_distance: float = 45.0
@export var gravity: float = 0.0
@export var on_hit: Array[AbilityEffect] = []
@export var on_impact: Array[AbilityEffect] = []
@export var color: Color = Color(1.0, 0.75, 0.3)


func apply(ctx: AbilityContext) -> void:
	var p := Projectile.new()
	p.setup(self, ctx)
	ctx.caster.projectile_container().add_child(p)
	p.global_position = ctx.origin


func describe() -> String:
	return "projectile"
