class_name CameraRig
extends Node3D
## Over-the-shoulder camera for the local champion. Follows the champion's aim yaw and pitch (written by PlayerInput),
## sits right of the shoulder, and the spring arm pulls it in against walls so it never ends up inside geometry.

@export var fov := 70.0
@export var follow_sharpness := 18.0

var champion: Champion
var camera: Camera3D
var arm: SpringArm3D
var _yaw: Node3D
var _pitch: Node3D


func _ready() -> void:
	top_level = true
	_yaw = Node3D.new()
	_yaw.name = "Yaw"
	add_child(_yaw)
	_pitch = Node3D.new()
	_pitch.name = "Pitch"
	_yaw.add_child(_pitch)
	arm = SpringArm3D.new()
	arm.name = "SpringArm3D"
	arm.spring_length = Champion.ARM_LENGTH
	arm.collision_mask = Targeting.LAYER_WORLD
	arm.margin = 0.25
	var sphere := SphereShape3D.new()
	sphere.radius = 0.25
	arm.shape = sphere
	arm.position = Vector3(Champion.SHOULDER_OFFSET, 0.0, 0.0)
	_pitch.add_child(arm)
	camera = Camera3D.new()
	camera.name = "Camera3D"
	camera.fov = fov
	camera.near = 0.08
	camera.far = 400.0
	camera.position = Vector3(0.0, 0.0, Champion.ARM_LENGTH)
	arm.add_child(camera)
	camera.make_current()


func attach(c: Champion) -> void:
	champion = c
	arm.add_excluded_object(c.get_rid())
	global_position = _pivot()
	_apply_angles()


func _physics_process(dt: float) -> void:
	if champion == null or not is_instance_valid(champion):
		return
	# smooth position (the body moves in physics steps); angles are exact so aim never lags the mouse
	var t := 1.0 - exp(-follow_sharpness * dt)
	global_position = global_position.lerp(_pivot(), t)
	_apply_angles()


func _pivot() -> Vector3:
	return champion.global_position + Vector3.UP * Champion.PIVOT_HEIGHT


func _apply_angles() -> void:
	_yaw.rotation = Vector3(0.0, champion.cmd_aim_yaw, 0.0)
	_pitch.rotation = Vector3(champion.cmd_aim_pitch, 0.0, 0.0)
