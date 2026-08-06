# Round two prompts

Two sets to generate, plus a fix for the fault that cost eleven symbols and
four UI assets in round one.

---

## ⚠️ First: the transparency fault

Eleven of thirty symbols and four of nine UI assets came back with the
**transparency checkerboard painted into the pixels**. On a dark reel that is a
grey checked box, not a symbol.

The eleven symbols were recoverable — flood-filling the pattern away from the
frame edges works when the subject has a hard edge. **The four UI assets were
not**, and the difference explains everything: they were the ones with big soft
glows. A glow is semi-transparent, so the checkerboard shows *through* it,
tinted gold. What was behind the glow is gone. No amount of processing gets it
back.

Two rules follow, and they matter more than any wording below.

**Rule 1 — say it hard, every time:**

```
The background MUST be fully transparent, a real alpha channel.
NO backdrop of any kind: no white, no colour, no gradient, no shadow plate,
and NO transparency checkerboard pattern drawn into the image.
The subject must be completely isolated on empty transparency.
```

**Rule 2 — glows go on black, not on transparency.**

Anything with a bloom, burst, sparkle or halo should be generated on **solid
pure black**. Glow is additive light: composited with a screen blend, black
becomes invisible and the glow keeps its softness. Asking for a soft glow on
transparency is asking for a value that cannot be represented, which is why the
generator falls back to drawing the checkerboard.

```
Solid pure black background (#000000), edge to edge, no transparency.
The glow must fade smoothly into the black.
```

---

## 1. The classic fruit family — 5 images

The highest-value set left. Four games have no artwork at all — Juwa Classic
(the flagship, tagged HOT in the lobby), Lucky Sevens, Triple Bar and Fruit
Stand — and five images cover all four.

Generate at **1024×1024**. Not 2048: it uploads, and a slot symbol is drawn at
about 90 pixels on a phone.

### Shared style block — prepend to all five

```
Style: premium mobile casino slot symbol, 2020s social-casino quality.
Glossy 3D rendered look, rich saturated colour, thick dark outline separating
the subject from the background, soft key light from the upper left, warm rim
light from the lower right, subtle inner bevel and a glossy specular highlight.
No text, no letters, no numbers, no watermark, no signature.
No people, no photorealism.

Single subject, centred, filling about 80% of a square frame, with even margin
on all four sides.

The background MUST be fully transparent, a real alpha channel. NO backdrop of
any kind: no white, no colour, no gradient, no shadow plate, and NO
transparency checkerboard pattern drawn into the image.

Detail is subordinate to silhouette: the shape must stay identifiable when
shrunk to 90 pixels tall.
```

### The five subjects

Listed **most valuable first**. The art has to agree with the paytable — a
player reads value from how expensive a symbol looks, and if the lemon
out-glitters the diamond they will feel cheated when it pays less.

| # | Pays | Subject prompt |
|---|---|---|
| 1 | highest | `A pair of glossy red cherries joined at the stem, with two bright green leaves. Deep crimson with a mirror highlight on each cherry.` |
| 2 | | `A single ripe purple plum with one green leaf, deep violet skin with a soft bloom and a crisp white highlight.` |
| 3 | | `A bright yellow lemon, slightly tilted, with one glossy green leaf. Dimpled citrus skin, warm golden yellow.` |
| 4 | | `A polished golden bell with a dark clapper and a small red ribbon at the crown. Warm brass, deep engraved rim.` |
| 5 | lowest | `A stack of three chrome-and-gold bars, cleanly separated, seen slightly from above. Metallic, no text or lettering on the bars.` |

⚠️ **The bar has no text on it.** Real slot bars read "BAR", and a generator
will try. It will get it wrong, and the existing vector BAR is already better.
Say "no lettering" explicitly.

**Colour separation:** each of the five must own a different dominant colour —
red, purple, yellow, brass, silver. Five gold symbols on one reel is five
symbols a player cannot tell apart mid-spin.

---

## 2. Reel backgrounds — 11 images

⚠️ **Read this before generating.** These are the riskiest assets in the whole
set, and a bad one is worse than none at all.

A reel background sits **behind** the symbols. Its entire job is to not compete
with them. Ask a generator for "a dramatic Egyptian tomb" and you get exactly
that: busy, high-contrast, focal point dead centre — directly behind the five
things a player must read in half a second.

The prompt below therefore fights the generator's instincts on purpose. Expect
to reject a lot. If a background is not obviously *quiet*, throw it away.

Generate at **1536×1024** (3:2 landscape).

### The prompt

```
A background image for the reel area of a mobile slot machine.
3:2 landscape.

Scene: {SCENE}

CRITICAL COMPOSITION RULES — these matter more than the subject:
- Deliberately LOW CONTRAST and DARK overall. This sits behind bright symbols
  and must never compete with them.
- The CENTRE of the image must be almost EMPTY: quiet, dark, unfocused. No
  subject, no face, no bright object anywhere in the middle two thirds.
- All detail, ornament and interest belongs at the OUTER EDGES only.
- Soft vignette darkening toward the middle.
- No single bright focal point anywhere.
- Muted, desaturated colour. Deep shadow tones with only sparse, small glints.
- No text, no letters, no numbers, no people, no faces.

Think of the far wall of a dim room, seen out of focus — atmosphere, not
subject.
```

### The eleven scenes

One per theme family, so a game's background matches its symbols.

| # | `{SCENE}` |
|---|---|
| 1 | `a pirate ship's dark lower deck, wet timber and rope, distant lantern light at the edges` |
| 2 | `a dim frontier saloon at night, dark wood panelling, faint oil lamps in the far corners` |
| 3 | `a shadowed temple interior with red paper lanterns hung far to the left and right` |
| 4 | `a moonlit jungle canopy, dense dark foliage framing an empty clearing` |
| 5 | `a night sky over distant marble ruins, deep indigo, faint constellations at the corners` |
| 6 | `deep space, dark nebula clouds pushed to the edges, empty black in the middle` |
| 7 | `a cavern of dark blue ice, crystal formations only along the outer edges` |
| 8 | `smouldering dark volcanic rock, faint ember glow low at the left and right edges` |
| 9 | `a rain-slick alley at night, distant neon reflections blurred at the far edges` |
| 10 | `a dim underwater trench, dark teal water, faint coral silhouettes at the borders` |
| 11 | `a night carnival seen from far away, small blurred lights strung across the top corners` |

### How to judge one

Shrink it to thumbnail size and squint. If your eye is drawn to anything in the
middle, it will fight the symbols. Reject it.

---

## 3. Re-do: the four UI assets

These four came back unusable — soft glow over a painted checkerboard. Generate
on **solid black** instead, at **1024×1024**, using the black-background rule
above.

| Asset | Prompt |
|---|---|
| Coin explosion | `A burst of gold coins and coloured gems exploding outward from the centre, radiating light. Solid pure black background, edge to edge. The glow fades smoothly into the black. No text.` |
| Sparkle burst | `A radial burst of white and gold sparkles and light streaks from the centre. Solid pure black background, edge to edge. No text.` |
| Big win glow | `An open treasure chest overflowing with gold, a warm halo of light behind it. Solid pure black background, edge to edge. No text.` |
| Jackpot pile | `A large heap of gold bars, coins and gems, lit from above, glow fading into the background. Solid pure black background, edge to edge. No text.` |

Five of the nine survived and are already in the game: `chest`, `coin_pack`,
`gem_pack`, `store`, `jackpot_medallion`. Only these four need redoing.

---

## Checking before you send

```
npm run check:art art
```

And the one thing the checker cannot see: **open a few on a dark background**
before uploading. The checkerboard fault is invisible on a white canvas and
obvious on black, which is exactly why it survived a whole round.
