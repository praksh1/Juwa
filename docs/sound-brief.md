# Sound brief

What the game still needs, written to be pasted into ElevenLabs Sound Effects
one prompt at a time.

`audio/README.md` is the inventory of what already exists — 26 usable files,
every length and level measured by decoding the file rather than trusting its
name. This is the other half: what is missing, why it matters, and the exact
words to ask for it.

## How to use this

ElevenLabs Sound Effects takes a text prompt and a duration. For each block
below:

1. Paste the prompt.
2. Set the duration to the one given. Shorter is almost always better — a slot
   fires these constantly and a tail that overlaps the next one turns into mud.
3. Generate the number of variants asked for. Variants matter more than quality
   for the short mechanical sounds: five identical reel stops in a row is the
   sound of a machine with one moving part.
4. Save with the filename given, exactly. The code looks these up by name, so a
   correct name is the difference between "wired in" and "another afternoon".
5. Upload to `audio/` on the branch.

Two settings worth knowing. **Prompt influence** high (towards "follow the
prompt") for the mechanical sounds, lower for the musical ones where a bit of
interpretation helps. And ask for **dry, close, no reverb** on anything short —
the game adds its own space, and a baked-in room makes two sounds played
together smear.

## Priority 1 — the sounds the player hears most

### Reel stop

The single most-heard sound in the whole app: five per spin, thousands per
session. It is the only mechanical sound still synthesised on every game, and
it is most of why the reels feel light.

- **Files:** `reel-stop-1.mp3` … `reel-stop-5.mp3` (five variants)
- **Duration:** 0.4 s

```
A single slot machine reel coming to a stop. One firm mechanical click with a
short low thud underneath it, like a detent catching. Close-miked, dry, tight,
no reverb, no music, no tail.
```

### Coin tick

Fires ten to fifteen times a second while a win counts up. Anything with a tail
becomes a buzz rather than a count, so this one has to be brutally short.

- **Files:** `coin-tick-1.mp3`, `coin-tick-2.mp3`
- **Duration:** 0.2 s

```
A single tiny bright metallic tick, like one coin landing on a stack or a
counter wheel advancing one place. Extremely short, dry, no reverb, no tail.
```

### Button tap

- **Files:** `ui-tap-1.mp3`, `ui-tap-2.mp3`
- **Duration:** 0.25 s

```
A soft rounded interface button click. Warm, subtle, premium, like a well-made
physical button. Dry, no reverb, no music.
```

## Priority 2 — the moments that are still silent

### Anticipation riser

Plays under the last reel when it can still complete a bonus, for exactly 0.6
seconds longer than a normal stop. Right now the tension is a synthesised sweep.
It must NOT resolve — the reel landing is the resolution.

- **Files:** `anticipation-1.mp3`, `anticipation-2.mp3`
- **Duration:** 3 s

```
A rising suspense riser for a casino machine. Low strings and a swelling synth
climbing steadily in pitch and intensity, building tension. It ends unresolved
at its loudest point with no impact, no cymbal crash and no release.
```

### Scatter landing

The symbol that triggers everything, landing on a reel. Currently indistinct
from any other stop, which is a wasted moment.

- **Files:** `scatter-land-1.mp3`, `scatter-land-2.mp3`, `scatter-land-3.mp3`
- **Duration:** 0.8 s

```
A special bonus symbol landing on a slot reel: a bright magical chime with a
short glittering sparkle tail. Clean, close, no reverb wash, no music bed.
```

### Coin locking — hold and spin

Dragon's Hoard, Vault Breaker and Pharaoh's Vault run a hold-and-spin round
where coins slam into place one at a time. It is the loudest moment those games
have and it currently makes a generic win noise.

- **Files:** `coin-lock-1.mp3`, `coin-lock-2.mp3`, `coin-lock-3.mp3`
- **Duration:** 0.6 s

```
A heavy gold coin slamming into a slot and locking in place. A weighty metallic
impact with a bright ring and a magnetic clunk. Solid, close-miked, dry, short
tail.
```

### Cascade / tumble

City Lights, Supernova and Storm Chaser clear their winning symbols and drop new
ones in, up to eight times in a chain. Each drop needs its own sound or the
chain reads as one long win.

- **Files:** `cascade-1.mp3`, `cascade-2.mp3`, `cascade-3.mp3`
- **Duration:** 0.9 s

```
Glass and gemstone game pieces shattering and tumbling away, then new pieces
dropping into place. Bright crystalline break with a short rattling fall. Dry,
close, no music.
```

### Bonus trigger

The moment three scatters land. Currently borrows the game's big-win fanfare,
which works but says "you won" rather than "something is about to happen".

- **Files:** `bonus-trigger-1.mp3`, `bonus-trigger-2.mp3`
- **Duration:** 2.5 s

```
A casino bonus round triggering. A bright orchestral hit followed by a rising
chime flourish and a shimmer, celebratory and expectant, announcing that
something is about to begin. No vocals.
```

## Priority 3 — worth having, not urgent

### Seamless spin loop

The four existing spin recordings are 2-second one-shots, which is a good match
for a normal spin and slightly short for one with an anticipation hold on the
last reel. A loopable bed would cover any length.

- **Files:** `reel-loop-1.mp3` … `reel-loop-4.mp3`
- **Duration:** 4 s

```
The continuous mechanical whirr of slot machine reels spinning at speed.
Steady, even, no start and no finish, seamlessly loopable. Dry, no music.
```

### Near miss

Two scatters landed and the third did not. Real cabinets mark this and it is
part of why they are compelling — and part of why it needs handling carefully,
since a near miss is a loss.

- **File:** `near-miss.mp3`
- **Duration:** 1.2 s

```
A short descending disappointed tone, gentle rather than harsh, marking a
missed opportunity. Soft, brief, understated.
```

### Music beds

Not Sound Effects — this is ElevenLabs **Music**, and it is a different and
larger job. One loopable 60-second bed per theme family would do far more for
"these are different games" than any remaining effect:

| bed | games | brief |
| --- | --- | --- |
| `bed-egypt.mp3` | Desert Mirage, Pharaoh's Vault | slow oud and frame drum, hot and patient |
| `bed-ice.mp3` | Frost Peak, Aurora, City Lights | glassy pads, high bells, no percussion |
| `bed-neon.mp3` | Neon Alley, Carnival Row, Sunset Strip | slow synthwave pulse, wet and nocturnal |
| `bed-asia.mp3` | Jade Temple, Dragon's Hoard, Spice Market | guzheng and taiko, sparse |
| `bed-classic.mp3` | the four fruit machines | warm lounge organ, brushed drums, 1960s bar |
| `bed-deep.mp3` | Ocean Drift, Emerald Nights, Jungle Run | low strings and choir, wide and slow |

All must loop without a seam and sit UNDER the effects — ask for "no lead
melody, no vocals, sparse, background".

## Re-renders

Ten of the shipped files peak above 1.0, which means the render clipped. They
are usable and they will sound slightly crunchy at full volume:

`win-2`, `win-5`, `megawin-1`, `megawin-3`, `megawin-4`, `megawin-5`,
`megawin-6`, `megawin-7`, `megawin-8`, `lever-3`

If they are easy to regenerate, adding **"clean, undistorted, with headroom, do
not clip"** to the prompt usually fixes it. This is a polish item, not a
blocker.
