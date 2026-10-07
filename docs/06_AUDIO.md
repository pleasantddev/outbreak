# Audio

Everything is synthesized at runtime with WebAudio. That keeps the download small, removes licensing risk and lets every sound react to the game.

## Mix

* Master into a compressor, with three buses: effects, music and ambience.
* A generated convolution reverb sized like a concrete street canyon, fed by every positional sound.
* HRTF panners with inverse distance roll off, so a survivor upstairs sounds above you and a gunshot three blocks away sounds three blocks away.

## Gameplay sounds

| Sound | Construction |
|---|---|
| Gunshots | Filtered noise burst, a high crack, a low sine thump, a delayed echo for distant shots; a profile per weapon; suppressed shots are a soft cough |
| Footsteps | Band passed noise tuned by surface: tiles click, wood thuds, metal rings, mud squelches; quieter when crouched |
| Impacts | Metal pings, flesh thuds, concrete cracks |
| Explosions | Long low noise, a falling sine and a rumbling tail |
| Creatures | FM throat voices through a vowel filter: Crawlers high and fast, Hollow low, Stalkers sub bass with a hiss |
| The Heart | A double sub heartbeat and a low swell on every pulse |
| Vehicles | Sawtooth and square engines whose pitch and filter follow speed; the danfo has a two tone horn |
| Generators | Positional 50 Hz hum near the closest three generators |
| UI | Clicks, hovers, pickups, reload clatter, ability whooshes, the Awakening roar |

## Ambience and score

* Rain as filtered noise, always on.
* Distant gunfire bursts and screams placed 200 to 400 m away, so the city keeps living.
* A score drone of detuned saw and triangle tones through a slowly breathing low pass filter. Tension raises its resonance.
* A heartbeat under 35 health that speeds up as you get closer to death.

## Announcer tones

Heart events get a deep falling swell, Awakening a roar, danger a two note siren, victory a rising chord.
