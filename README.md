# Bo Le Ka Ja (working title)

Third-person 4v4 hero arena brawler with no guns: martial arts, spiritual projectiles, mobility and ultimates. Players
are champions who pledge to a researched Nigerian spiritual patron. Spec: `CLAUDE.md` and `documentation/UNiti_GDD.txt`.
How it is built: `ARCHITECTURE.md`. What is done and next: `TASKS.md`. Asset licences: `ASSET_LICENSES.md`.

## Pinned versions

| Tool | Version | Notes |
|---|---|---|
| Godot | **4.7.2 stable** (official, ed1daf0bf) | GDScript only. The binary used so far lives at `~/Downloads/Godot.app`; move it to `/Applications` when convenient. |
| Physics | Jolt (built into Godot 4.7) | set in project.godot |
| Renderer | Forward+ on desktop, Mobile on Android | |
| Blender | not installed | needed later for the Mixamo pipeline (`brew install --cask blender`) |
| Python | 3.10 | tools only |

## Development machine (audited 15 Nov 2026)
MacBook Pro, macOS 12.7.6, Intel Core i7-6820HQ, 16 GB, Intel HD 530 plus AMD Radeon Pro 455 (2 GB), Metal family 2.
This is a weak GPU for Forward+, so performance numbers from it are a floor for desktop, not a stand-in for Android.

## Run it

```bash
# set once per shell (or put Godot on your PATH)
export GODOT=~/Downloads/Godot.app/Contents/MacOS/Godot

# open the editor
$GODOT --path . -e

# play (boot routes to the combat sandbox)
$GODOT --path .

# all headless checks: import, every script compiles, test suites. Non-zero exit on failure.
./tools/test.sh
./tools/test.sh --only=attributes      # one suite or test name fragment

# rewrite the InputMap in project.godot after changing tools/setup_input.gd
$GODOT --headless --path . --script res://tools/setup_input.gd
```

Multiplayer commands (`--server`, `--connect=host:port`) arrive in phase 3 and will be documented here when they work.

## Controls

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Move | WASD | Left stick |
| Look | Mouse | Right stick |
| Jump | Space | A / Cross |
| Basic attack | Left mouse | Right trigger |
| Secondary | Right mouse | Left trigger |
| Mobility | Shift | Left shoulder |
| Utility | E | Right shoulder |
| Signature | Q | X / Square |
| Ultimate | F | Y / Triangle |
| Scoreboard | Tab | Back |
| Pause | Esc | Start |

## Git
Commits are authored as `Pleasant <joylove.rightchoice@gmail.com>` with no AI attribution lines (set in this repo's
local git config). Run `./tools/test.sh` before committing.
