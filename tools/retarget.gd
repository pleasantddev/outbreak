extends SceneTree
## Sets up Godot's import-time retargeting so every character and animation shares one humanoid skeleton
## ("GeneralSkeleton", SkeletonProfileHumanoid bone names). Then any animation plays on any body:
##   - UAL skeleton (Quaternius animations, the CC0 base bodies, the HustleLife realistic bodies)
##   - Bip01 skeleton (Microsoft Rocketbox avatars, MIT)
## Run: godot --headless --path . --script res://tools/retarget.gd   then   godot --headless --path . --import

const UAL_FILES := [
	"res://assets/animations/ual_core.glb", "res://assets/animations/ual_combat.glb",
	"res://assets/characters/male.glb", "res://assets/characters/female.glb",
]
const UAL_DIRS := ["res://assets/characters/realistic"]
const BIP_DIRS := ["res://assets/characters/rocketbox"]
const MIXAMO_DIRS := ["res://assets/animations/mixamo"]

const FINGERS := [["Thumb", "thumb", ["Metacarpal", "Proximal", "Distal"]], ["Index", "index", ["Proximal", "Intermediate", "Distal"]],
	["Middle", "middle", ["Proximal", "Intermediate", "Distal"]], ["Ring", "ring", ["Proximal", "Intermediate", "Distal"]],
	["Little", "pinky", ["Proximal", "Intermediate", "Distal"]]]


func ual_map() -> Dictionary:
	var m := {"Root": "root", "Hips": "pelvis", "Spine": "spine_01", "Chest": "spine_02", "UpperChest": "spine_03", "Neck": "neck_01", "Head": "Head"}
	for side in [["Left", "l"], ["Right", "r"]]:
		var S: String = side[0]
		var s: String = side[1]
		m[S + "Shoulder"] = "clavicle_" + s
		m[S + "UpperArm"] = "upperarm_" + s
		m[S + "LowerArm"] = "lowerarm_" + s
		m[S + "Hand"] = "hand_" + s
		m[S + "UpperLeg"] = "thigh_" + s
		m[S + "LowerLeg"] = "calf_" + s
		m[S + "Foot"] = "foot_" + s
		m[S + "Toes"] = "ball_" + s
		for f in FINGERS:
			for i in 3:
				m[S + f[0] + f[2][i]] = "%s_0%d_%s" % [f[1], i + 1, s]
	return m


func bip_map() -> Dictionary:
	var m := {"Root": "Bip01", "Hips": "Bip01 Pelvis", "Spine": "Bip01 Spine", "Chest": "Bip01 Spine1", "UpperChest": "Bip01 Spine2",
		"Neck": "Bip01 Neck", "Head": "Bip01 Head", "LeftEye": "Bip01 LEye", "RightEye": "Bip01 REye", "Jaw": "Bip01 MJaw"}
	for side in [["Left", "L"], ["Right", "R"]]:
		var S: String = side[0]
		var s: String = side[1]
		m[S + "Shoulder"] = "Bip01 %s Clavicle" % s
		m[S + "UpperArm"] = "Bip01 %s UpperArm" % s
		m[S + "LowerArm"] = "Bip01 %s Forearm" % s
		m[S + "Hand"] = "Bip01 %s Hand" % s
		m[S + "UpperLeg"] = "Bip01 %s Thigh" % s
		m[S + "LowerLeg"] = "Bip01 %s Calf" % s
		m[S + "Foot"] = "Bip01 %s Foot" % s
		m[S + "Toes"] = "Bip01 %s Toe0" % s
		for fi in FINGERS.size():
			var f: Array = FINGERS[fi]
			var suffix := ["", "1", "2"]
			for i in 3:
				m[S + f[0] + f[2][i]] = "Bip01 %s Finger%d%s" % [s, fi, suffix[i]]
	return m


## Mixamo rig (X Bot exports, "Without Skin"): no root bone, Hips is the top.
func mixamo_map() -> Dictionary:
	var p := "mixamorig_"
	var m := {"Hips": p + "Hips", "Spine": p + "Spine", "Chest": p + "Spine1", "UpperChest": p + "Spine2", "Neck": p + "Neck", "Head": p + "Head"}
	for S in ["Left", "Right"]:
		m[S + "Shoulder"] = p + S + "Shoulder"
		m[S + "UpperArm"] = p + S + "Arm"
		m[S + "LowerArm"] = p + S + "ForeArm"
		m[S + "Hand"] = p + S + "Hand"
		m[S + "UpperLeg"] = p + S + "UpLeg"
		m[S + "LowerLeg"] = p + S + "Leg"
		m[S + "Foot"] = p + S + "Foot"
		m[S + "Toes"] = p + S + "ToeBase"
		var names := {"Thumb": "Thumb", "Index": "Index", "Middle": "Middle", "Ring": "Ring", "Little": "Pinky"}
		for f in FINGERS:
			for i in 3:
				m[S + f[0] + f[2][i]] = "%s%sHand%s%d" % [p, S, names[f[0]], i + 1]
	return m


func make_bone_map(table: Dictionary, path: String) -> BoneMap:
	var bm := BoneMap.new()
	bm.profile = SkeletonProfileHumanoid.new()
	for k: String in table:
		bm.set_skeleton_bone_name(StringName(k), StringName(table[k]))
	var err := ResourceSaver.save(bm, path)
	print("bone map ", path, " ", error_string(err))
	return load(path)


func patch(file: String, skeleton_path: String, bm: BoneMap, fix_silhouette := false) -> void:
	var imp := file + ".import"
	var cfg := ConfigFile.new()
	if cfg.load(imp) != OK:
		print("no import file for ", file, " (import the project first)")
		return
	var subs: Dictionary = cfg.get_value("params", "_subresources", {})
	var nodes: Dictionary = subs.get("nodes", {})
	nodes["PATH:" + skeleton_path] = {
		"retarget/bone_map": bm,
		"retarget/bone_renamer/rename_bones": true,
		"retarget/bone_renamer/unique_node/make_unique": true,
		"retarget/bone_renamer/unique_node/skeleton_name": "GeneralSkeleton",
		"retarget/rest_fixer/apply_node_transforms": true,
		"retarget/rest_fixer/normalize_position_tracks": true,
		"retarget/rest_fixer/overwrite_axis": true,
		# A-pose rigs (Rocketbox) are straightened to the T-pose the other rigs use, or arms land in the wrong place
		"retarget/rest_fixer/fix_silhouette/enable": fix_silhouette,
	}
	subs["nodes"] = nodes
	cfg.set_value("params", "_subresources", subs)
	cfg.save(imp)
	print("retarget set: ", file)


func _files(dir: String, ext: String) -> PackedStringArray:
	var out := PackedStringArray()
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(ext):
			out.append(dir.path_join(f))
	for d in DirAccess.get_directories_at(dir):
		out.append_array(_files(dir.path_join(d), ext))
	return out


func _init() -> void:
	var ual := make_bone_map(ual_map(), "res://assets/animations/bonemap_ual.tres")
	var bip := make_bone_map(bip_map(), "res://assets/characters/rocketbox/bonemap_bip01.tres")
	var ual_files := PackedStringArray(UAL_FILES)
	for d in UAL_DIRS:
		ual_files.append_array(_files(d, ".glb"))
	for f in ual_files:
		patch(f, "Armature/Skeleton3D", ual)
	for d in BIP_DIRS:
		for f in _files(d, ".fbx"):
			patch(f, "Skeleton3D", bip, true)
	var mix := make_bone_map(mixamo_map(), "res://assets/animations/mixamo/bonemap_mixamo.tres")
	for d in MIXAMO_DIRS:
		for f in _files(d, ".fbx"):
			patch(f, "Skeleton3D", mix)
	quit()
