extends Node
## Player settings (graphics tier, look sensitivity, volumes), saved to user://settings.cfg.
## The tier changes what each scene's WorldEnvironment and lights do through `apply_to_environment`.
## Render resolution is never lowered as a performance fix; tiers cut effects instead.

signal tier_changed(tier: Tier)

enum Tier { ULTRA, HIGH, BALANCED, PERFORMANCE }

const PATH := "user://settings.cfg"
const TIER_NAMES := ["Ultra", "High", "Balanced", "Performance"]

var tier: Tier = Tier.HIGH
var mouse_sensitivity: float = 0.0025
var pad_sensitivity: float = 3.0
var invert_y: bool = false
var master_volume: float = 1.0
var reduced_effects: bool = false


func _ready() -> void:
	tier = default_tier()
	load_settings()


func default_tier() -> Tier:
	var os := OS.get_name()
	if os == "Android" or os == "iOS":
		return Tier.BALANCED
	return Tier.HIGH


func set_tier(t: Tier) -> void:
	tier = t
	save_settings()
	tier_changed.emit(t)


## Particle amount multiplier for VFX scenes.
func particle_scale() -> float:
	if reduced_effects:
		return 0.25
	return [1.0, 0.8, 0.5, 0.3][tier]


func apply_to_environment(env: Environment, sun: DirectionalLight3D = null) -> void:
	if env == null:
		return
	env.ssao_enabled = tier <= Tier.HIGH
	env.ssil_enabled = tier == Tier.ULTRA
	env.ssr_enabled = tier <= Tier.HIGH
	# volumetric fog is Forward+ only and costly; phones keep the plain depth fog
	env.volumetric_fog_enabled = tier <= Tier.HIGH and RenderingServer.get_current_rendering_method() == "forward_plus"
	env.glow_enabled = tier <= Tier.BALANCED and not reduced_effects
	env.sdfgi_enabled = false
	if sun:
		sun.shadow_enabled = tier != Tier.PERFORMANCE
		sun.directional_shadow_max_distance = [80.0, 60.0, 35.0, 25.0][tier]
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if tier == Tier.ULTRA \
			else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if tier == Tier.HIGH else DirectionalLight3D.SHADOW_ORTHOGONAL


func load_settings() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) != OK:
		return
	tier = clampi(int(cfg.get_value("graphics", "tier", tier)), 0, 3) as Tier
	reduced_effects = bool(cfg.get_value("graphics", "reduced_effects", reduced_effects))
	mouse_sensitivity = clampf(float(cfg.get_value("input", "mouse_sensitivity", mouse_sensitivity)), 0.0002, 0.02)
	pad_sensitivity = clampf(float(cfg.get_value("input", "pad_sensitivity", pad_sensitivity)), 0.5, 10.0)
	invert_y = bool(cfg.get_value("input", "invert_y", invert_y))
	master_volume = clampf(float(cfg.get_value("audio", "master", master_volume)), 0.0, 1.0)


func save_settings() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("graphics", "tier", tier)
	cfg.set_value("graphics", "reduced_effects", reduced_effects)
	cfg.set_value("input", "mouse_sensitivity", mouse_sensitivity)
	cfg.set_value("input", "pad_sensitivity", pad_sensitivity)
	cfg.set_value("input", "invert_y", invert_y)
	cfg.set_value("audio", "master", master_volume)
	cfg.save(PATH)
