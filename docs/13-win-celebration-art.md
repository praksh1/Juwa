# Big-win celebration art — brief for Gemini

What to generate, why it is split the way it is, and the exact prompts.

## Read this part first

**Every asset here is a LAYER, not a picture.** A single finished image of a
dragon breathing fire over a pile of coins is worthless to us — it can only fade
in and fade out. The same dragon delivered as five separate transparent files
(body, near wing, far wing, jaw, glow) can beat its wings, snap its head and
pulse, forever, at any speed, on any screen size, for about 40KB.

So the rule for every prompt below: **one subject, isolated, transparent
background, no shadow cast onto anything.**

### Technical requirements (put these in every prompt)

| Requirement | Value | Why |
| --- | --- | --- |
| Format | PNG with alpha | Anything with a background cannot be layered |
| Background | Fully transparent | See below if Gemini will not do it |
| Size | 1024×1024 (coins: 512×512) | We downscale; we cannot upscale |
| Framing | Subject fills ~85% of the canvas, centred | Consistent pivot when we rotate it |
| Shadows | On the subject only, never cast onto the background | A cast shadow is a background |
| Cropping | Nothing touching the canvas edge | Clipped edges show when it scales up |
| Style | Painted, high-detail casino art, warm gold key light from upper-left | Matches the existing lobby tiles |

> **If Gemini refuses transparency** — some versions flatten to white — ask for
> the subject on **pure magenta `#FF00FF`**. That colour appears nowhere in the
> subject matter here, so it keys out cleanly and I can do that in one pass.

### One more thing that matters more than it sounds

**Ask for each layer in a separate request, referencing the previous one.**
Generating "a dragon" and then "that dragon's wing" as two prompts gives two
dragons. The working method is: generate the full creature first, then ask for
each part *of that image* with everything else erased. Gemini's image editing
holds the pose between requests; a fresh prompt does not.

---

## Set 1 — The coin fountain (highest value, build this first)

Used on **every** big win in the app: slots, roulette, blackjack, all five
instant games. This is the one that pays for itself, because it is not
theme-specific.

We currently throw ~60 vector sparks with real gravity and drag. Swapping the
sparks for painted coins turns a particle effect into a coin fountain, and the
physics code does not change at all.

**What to make: one coin, at six rotation angles.** Six is the number that
makes a spinning coin read as spinning rather than as a flipping card. Name them
`coin-00.png` through `coin-05.png`.

> **Prompt (repeat six times, changing only the bracketed part)**
>
> A single gold casino coin, floating, seen [face-on / turned 15 degrees / turned
> 35 degrees / turned 55 degrees / turned 75 degrees / edge-on], 512 by 512
> pixels, PNG with a fully transparent background. Thick milled edge, deep
> relief, a stamped crown on the face. Warm polished gold with a bright specular
> highlight from the upper left and a warm bounce light from below. Painted
> mobile-game casino art, high detail, crisp edges. The coin fills about 85% of
> the frame and is centred. No background, no ground, no cast shadow, no text,
> no other objects.

**Also useful, same set:** `coin-burst-glow.png` — a soft radial gold flare,
512×512, transparent, no hard edge. We put one behind each coin so the fountain
reads as lit rather than as stickers.

---

## Set 2 — Dragon's Hoard (the one you asked for)

Fires on a big win in **Dragon's Hoard** only. This is the template for
per-game celebrations; if it works we do two or three more.

The dragon must be generated **once**, then separated. Order matters:

**Step 1 — the master image** (this file is never shipped; it exists so the
parts match)

> A fearsome Chinese-style treasure dragon, front three-quarter view, wings
> spread wide, head raised and jaws open, coiled over a hoard of gold. Deep
> emerald and jade scales with gold horns and claws, glowing amber eyes.
> Painted mobile-game casino art, high detail, dramatic warm rim light from the
> upper left. 1024 by 1024, PNG, fully transparent background, no ground, no
> cast shadow, no coins, no text.

**Step 2 — the layers.** Each of these is an EDIT of the image from step 1, so
say so explicitly:

| File | Prompt (as an edit of the master) | What it does in the app |
| --- | --- | --- |
| `dragon-body.png` | "Same image, with both wings completely removed and the lower jaw removed. Keep the body, neck, head, upper jaw, horns and tail exactly as they are. Transparent where the removed parts were." | The anchor. Never moves. |
| `dragon-wing-near.png` | "Only the near wing from that image, isolated on a fully transparent background. Keep it in the same spread position. Nothing else in frame." | Rotates about its shoulder, ±18°, ~700ms |
| `dragon-wing-far.png` | "Only the far wing from that image, isolated on a fully transparent background. Nothing else in frame." | Same, in antiphase, slightly smaller |
| `dragon-jaw.png` | "Only the lower jaw and lower teeth from that image, isolated on a fully transparent background." | Rotates about the hinge, opens on the roar |
| `dragon-glow.png` | "A soft amber glow shaped like that dragon's silhouette, blurred, no detail, on a fully transparent background." | Pulses behind everything |

> **Critical for the wings:** ask for each wing **with its shoulder joint
> included**, not cropped at the body line. I rotate around the shoulder, and if
> the joint is missing the wing detaches from the body when it moves. Say:
> "include the base of the wing where it meets the shoulder."

---

## Set 3 — The BIG WIN banner

Shown across the middle of the screen over the fountain. One asset, used
everywhere, three variants by size of win.

| File | Prompt |
| --- | --- |
| `banner-big-win.png` | A wide ornate gold banner ribbon reading "BIG WIN" in bold three-dimensional gold letters with a dark red outline. Ornate scrollwork on both ends, small gems set into the frame. 1024 by 512, PNG, fully transparent background. Painted casino art, warm key light from upper left. No background, no cast shadow, nothing behind the banner. |
| `banner-mega-win.png` | As above, reading "MEGA WIN", with more elaborate scrollwork and small flames along the top edge. |
| `banner-jackpot.png` | As above, reading "JACKPOT", in white-gold with diamonds set into the frame and a starburst behind the lettering. |

Keep the lettering **inside** 80% of the width — banners get scaled down on a
phone and edge-to-edge text becomes unreadable.

---

## Set 4 — Reusable sparkle atlas (small, high value)

Four tiny transparent files that make everything else look expensive:

- `spark-star.png` — a four-pointed white-gold star flare, 256×256, soft
- `spark-round.png` — a soft round white bloom, 256×256, no hard edge
- `spark-streak.png` — a thin vertical light streak, 128×512, fading at both ends
- `confetti-gold.png` — a single curled gold foil ribbon, 256×256

> **Prompt shape for all four:** "[the subject], on a fully transparent
> background, PNG, [size]. Soft glowing edges, no hard outline, no background,
> no cast shadow, nothing else in frame. Painted game VFX art."

---

## What I will do with these

Nothing about the money path changes. These are decorations drawn over a result
the server already decided and the client already received — the same rule the
existing celebration follows.

1. **Coins** replace the vector sparks in `Fireworks.tsx`. Same physics, same
   trigger, same power scaling. One afternoon.
2. **Banner** slots into the existing `WinOverlay`, which currently draws its
   own text.
3. **Dragon** becomes a new component that mounts over the reels on a big win in
   Dragon's Hoard, driven by three `Animated.Value`s (wing angle, jaw angle,
   glow opacity).
4. **Sparkles** go into both, and into the bonus meter when it arms.

## Priority, if you only do some

1. **Set 1 (coins)** — used on every win in every game.
2. **Set 3 (banner)** — used on every big win in every game.
3. **Set 4 (sparkles)** — cheap, improves everything.
4. **Set 2 (dragon)** — one game, but it is the proof that per-game
   celebrations are worth doing.

## Budget note

Total: 6 coins + 1 glow + 5 dragon layers + 3 banners + 4 sparkles = **19
images**. Every one of them is reusable indefinitely and none needs regenerating
when a game's maths changes.
