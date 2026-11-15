class_name MatchModeDefinition
extends GameDefinition
## Rules for a game mode (Convergence first). The match server reads these; nothing is hard-coded.

@export var team_size: int = 4
@export var score_to_win: int = 100
## objective points per second while one team holds the zone uncontested
@export var score_per_second: float = 1.0
## capture progress per second per player on the zone (0..1 scale), capped by capture_max_players
@export var capture_rate: float = 0.12
@export var capture_max_players: int = 3
## seconds between objective moves; 0 = never moves
@export var objective_move_interval: float = 90.0
@export var respawn_base: float = 5.0
## extra respawn seconds per minute of match time, capped by respawn_max
@export var respawn_per_minute: float = 0.5
@export var respawn_max: float = 10.0
## seconds; 0 = no limit
@export var time_limit: float = 600.0
@export var overtime: bool = true


func respawn_delay(match_seconds: float) -> float:
	return minf(respawn_base + respawn_per_minute * match_seconds / 60.0, respawn_max)


func validate() -> PackedStringArray:
	var errors := super()
	if team_size < 1:
		errors.append("%s needs at least one player per team" % id)
	if score_to_win < 1:
		errors.append("%s needs a positive score to win" % id)
	if respawn_base < 0.0 or respawn_max < respawn_base:
		errors.append("%s has an invalid respawn range" % id)
	return errors
