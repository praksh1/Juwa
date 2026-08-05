# The art brief

What Juwa actually needs drawn, what it does not, and how to get it without
buying something a purchaser cannot legally use.

---

## 1. What is already done, and therefore costs nothing

Four of the five things people mean by "the art" are code in this repository,
not files somebody has to draw:

| Thing | Where it lives | Status |
|---|---|---|
| **Animation** | `app/src/components/Reel.tsx`, `WinOverlay.tsx`, `CoinBurst.tsx` | Done. Reel position is a pure function of a shared clock; wins tier into burst / big / mega with a cabinet shake. Honours `prefers-reduced-motion`. |
| **Sound** | `app/src/sound.ts` | Done. Every effect is **synthesised** at runtime from oscillators and noise — no audio files at all. Scheduled against `AudioContext.currentTime`, which is why reel stops and their sounds agree to ~18ms. |
| **Game design & maths** | `packages/engine/src/games/` | Done. 5 tuned models, 23 themes, RTP measured by simulation rather than declared. |
| **Symbols** | `app/src/components/SlotSymbol.tsx` | Done as vector SVG, recoloured per theme. Legible at any size, ~2KB each. |
| **Lobby tiles, logo, icons** | `app/src/components/GameArt.tsx`, `Logo.tsx` | Drawn in code. Functional, deliberately plain. |

**Nobody needs to animate anything.** Animation here is timing code driven by
the audio clock; handing it to an artist would make it worse. The same is true
of the maths — "game design" in a slot is reel strips and paytables, and those
are tuned by simulation.

So the brief below is only for **static 2D images**. That is the entire gap.

---

## 2. The asset manifest

### 2.1 What to draw, exactly

| Group | Count | Size | Format |
|---|---|---|---|
| **Symbol families** — 6 sets × 5 picture symbols | 30 | 512×512 | PNG, transparent |
| **Reel backgrounds** — one per family, plus 6 seasonal | 12 | 1536×1024 | PNG or WebP |
| **Lobby tiles** — one per game | 50 | 1024×1024 | PNG or WebP |
| **Win overlay flourishes** — burst, big, mega | 3 | 1024×1024 | PNG, transparent |
| **Store / bonus icons** | 6 | 512×512 | PNG, transparent |
| **Total** | **~101** | | |

### 2.2 What NOT to draw, and why

**Keep `SEVEN`, `BAR`, `WILD` and `SCATTER` as the existing vector art.**

Those four carry typography. Image generators are unreliable with letterforms,
and these are the four symbols a player must read instantly at 60px on a moving
reel — the exact place where a slightly-wrong "BAR" or a smudged "7" destroys
trust. They are also the symbols shared across every theme, so redrawing them
per game buys variety in the one place variety is unwanted.

That leaves **five picture symbols per family**: `DIAMOND`, `BELL`, `CHERRY`,
`PLUM`, `LEMON` — reinterpreted per theme (in an Egyptian set the "cherry"
becomes a scarab, the "bell" an ankh, and so on).

### 2.3 The six families

23 games share five maths models today; art should be shared the same way. Six
families dressed with the existing per-theme colours cover 50 games without 50
commissions.

| Family | Covers | Character |
|---|---|---|
| **Classic** | Juwa Classic, Lucky Sevens, Triple Bar, Fruit Stand | Chrome, cherries, diner neon |
| **Gems** | Emerald Nights, Frost Peak, Aurora, Supernova | Faceted stone, cold light |
| **Ancient** | Pharaoh's Vault, Jade Temple, Dragon's Hoard | Carved stone, gold leaf |
| **Neon** | Neon Alley, City Lights, Sunset Strip, Vault Breaker | Synthwave, wet asphalt reflections |
| **Nature** | Ocean Drift, Jungle Run, Storm Chaser, Desert Mirage | Organic, weathered |
| **Festival** | Carnival Row, Spice Market, Royal Fortune, Midnight Gold | Warm, ornate, cloth and brass |

---

## 3. ⚠️ The copyright problem, which matters most if you intend to sell

**In the United States, purely AI-generated images cannot be copyrighted.** The
Copyright Office requires human authorship; output produced by a prompt alone is
not protected, and *Thaler v. Perlmutter* upheld that.

For a business that just wants pictures, this is a footnote. **For an asset sale
it is a diligence question**, and it has two teeth:

1. **You cannot assign what you do not own.** A buyer's lawyer will ask you to
   warrant that you own the art and can transfer it. Raw AI output does not let
   you make that warranty honestly.
2. **Anyone may copy it.** Uncopyrightable art can be lifted by a competitor
   with no recourse. A buyer paying for a differentiated product will care.

### How to stay safe

**Best — a human artist who assigns rights.** A contract with a
**work-for-hire / assignment clause** means you own the copyright outright. The
artist may use AI as one tool among others; what you are buying is their
authorship and the assignment. This is the only route that survives diligence
without argument.

**Acceptable — AI with meaningful human authorship, from an indemnified tool.**
Use **Adobe Firefly**: it is trained on licensed content and Adobe offers IP
indemnification for enterprise output. Then have a designer *materially* edit
every asset — recolour, recompose, repaint, assemble. Human editing creates a
protectable contribution, and the arrangement of the set is protectable as a
compilation. Keep the layered source files; they are the evidence of authorship.

**Risky — raw AI output, shipped as-is.** Fine for a prototype. It weakens a
sale, and you should not warrant ownership of it.

**Also check the tool's own terms.** Midjourney grants commercial rights on paid
plans; OpenAI assigns output rights to the user; Stable Diffusion under
CreativeML OpenRAIL-M permits commercial use. None of those grant *copyright* —
they grant permission to use. That is a different thing, and it is the
distinction a buyer's lawyer will draw.

**Keep a folder.** Every licence, invoice, contract and source file, named by
asset. That folder is part of what you are selling.

---

## 4. Routes and cost

| Route | Cost | Time | Sale-safe? |
|---|---|---|---|
| **Freelance artist, rights assigned** | $6,000 – $25,000 | 8–16 weeks | ✅ Yes |
| **Firefly + designer editing** | $1,500 – $5,000 | 3–6 weeks | ⚠️ Mostly — keep the sources |
| **Raw AI, no editing** | $50 – $300 | Days | ❌ No |
| **Stock packs with transfer rights** | $500 – $3,000 | 1 week | ⚠️ Read every licence |

**Recommendation for your goal:** generate a full set with Firefly to prove the
product and get it in front of people, then pay one artist **$6k–$12k** to
redraw the ~35 assets that actually appear on screen most (the six symbol
families and the backgrounds), with rights assigned. Lobby tiles can stay
generated-and-edited. That gets you defensible ownership of the art that
matters for well under the full commission price.

---

## 5. Prompts

### 5.1 The style contract — prepend to every prompt

```
Style: premium mobile casino game art, 2020s social-casino quality.
Bold, clean, high-contrast, readable at 60 pixels tall on a phone screen.
Rich saturated colour with a dark 3-4px outline separating the subject from
any background. Soft key light from the upper left, warm rim light from the
lower right. Subtle inner bevel and a glossy highlight. No text, no letters,
no numbers, no watermark, no signature. No photorealism, no gore, no people.
Centred single subject, even margins, square composition.
```

### 5.2 Symbols — 30 images

Run once per family × per symbol. Substitute both placeholders.

```
[STYLE CONTRACT]

A single {SUBJECT}, centred, filling about 80% of a square frame, on a fully
transparent background. Icon-like and instantly recognisable in silhouette.
Consistent visual weight with other symbols in the same set — no symbol should
look heavier or larger than its neighbours.

Palette: {PRIMARY}, {SECONDARY}, with {ACCENT} used only for highlights.
```

Substitutions — `{SUBJECT}` by family:

| Symbol | Classic | Gems | Ancient | Neon | Nature | Festival |
|---|---|---|---|---|---|---|
| DIAMOND | chrome diamond | faceted blue gem | lapis scarab | glowing hologram prism | dew-covered crystal | jewelled brooch |
| BELL | brass diner bell | ice-crystal bell | golden ankh | neon-outlined bell | carved wooden bell | festival hand bell |
| CHERRY | pair of glossy cherries | ruby cluster | red lotus flower | neon cherry sign | wild berries on a vine | candied fruit on a stick |
| PLUM | ripe purple plum | amethyst orb | painted clay urn | purple neon orb | forest plum with leaf | spiced purple fig |
| LEMON | bright lemon | citrine wedge | golden sun disc | yellow neon citrus | sunlit lemon on a branch | preserved lemon in glass |

Colours come from `packages/engine/src/games/slot-catalogue.ts` — each game's
`theme` object already holds `primary`, `secondary` and `accent`.

### 5.3 Reel backgrounds — 12 images

```
[STYLE CONTRACT — but ignore "centred single subject"]

A background for a slot machine reel area. 3:2 landscape. {SCENE}.
Deliberately LOW CONTRAST and dark, with all detail pushed to the edges —
the centre must stay quiet, because symbols sit on top of it and must never
compete with it. Soft vignette. No focal point in the middle third.
Palette: deep {PRIMARY} shadows, {SECONDARY} midtones, sparse {ACCENT} glints.
```

`{SCENE}` examples: *a dim art-deco casino wall with brass inlay*; *a cavern of
frozen crystal lit from below*; *a sandstone tomb wall carved with geometry*; *a
rain-slick alley of distant neon reflections*; *a moonlit jungle canopy*; *a
night market of hanging lanterns*.

### 5.4 Lobby tiles — 50 images

```
[STYLE CONTRACT]

Square cover art for a mobile casino game titled "{GAME NAME}".
A single bold hero subject, centred, that reads clearly as a thumbnail
280 pixels wide. Dramatic lighting, strong silhouette, generous dark margin
at the bottom third where a title will be overlaid in the app.
NO TEXT ANYWHERE IN THE IMAGE.
Palette: {PRIMARY}, {SECONDARY}, {ACCENT}.
Mood: {MOOD}.
```

The title is drawn by the app, not baked into the image — one asset then serves
every language, and a renamed game does not need redrawing.

### 5.5 Win flourishes — 3 images

```
[STYLE CONTRACT]

A celebratory {burst of coins | golden explosion | supernova of light and coins}
on a fully transparent background, radiating outward from the centre with a
clear empty hole in the middle where large text will be placed.
Symmetrical, energetic, no text.
```

---

## 6. Acceptance checklist

Reject an asset that fails any of these. They are the ones that cost a re-do
later:

- [ ] **Transparent** where the manifest says transparent — a white square behind a symbol is invisible on a light preview and obvious on a dark reel
- [ ] **Legible at 60px.** Shrink it and look. Most failures are here
- [ ] **Consistent weight** across a family — no symbol visually dominant
- [ ] **No text**, including accidental glyphs in ornamentation
- [ ] **Centre stays quiet** on backgrounds
- [ ] **Even margins** — symbols must not jitter when swapped on a reel
- [ ] **Under 150KB** each after compression; the whole set under 8MB
- [ ] **Source files kept** — layered PSD/SVG, not just the flattened PNG
- [ ] **Licence recorded** in the asset folder, naming the tool or contract

---

## 7. Wiring it in

Once assets exist, the code change is small and is my side of the work:

1. Add an `art` field to each theme in `slot-catalogue.ts` naming its family
2. `SlotSymbol.tsx` picks image or vector per symbol, falling back to the
   current vector art if an image is missing — so the game never breaks on a
   half-delivered set
3. `GameArt.tsx` uses the lobby tile when present
4. Preload and cache-bust through the existing service worker

Roughly **three days**, and it can be done family by family as art arrives
rather than waiting for all 101 assets.
