# Art

Generated with Gemini and ChatGPT, then processed into what the game can ship.

```
art/
  symbols/      45 PNG, 512x512, transparent
  tiles/        23 JPEG named by game + 35 spare in tiles/unassigned
  backgrounds/  12 JPEG, 1536x1024
  ui/            9 — five transparent PNG, four black-background JPEG
```

`npm run check:art art` validates the symbols and UI.

## The one fault that keeps recurring

Across three drops, **the generator paints the transparency checkerboard into
the pixels**. On a dark reel that is a grey checked box.

- Drop 1: 11 of 30 symbols. Ten recovered by flood-filling from the frame
  edges, two beyond recovery.
- Drop 2: 4 of 9 UI assets, all unrecoverable — see below.
- Drop 3: 5 of 5 Gemini fruit symbols. The 5 ChatGPT ones were correct, so
  those were used and the Gemini set discarded.

**Hard edges can be rescued; soft glows cannot.** A glow is semi-transparent,
so the checkerboard shows through it, tinted. What was behind the glow is gone.

**Therefore glows are generated on solid black**, not transparency, and
composited additively — black contributes nothing under a screen blend. The
four re-done UI assets use this and are stored as JPEG, since they have no
alpha to preserve.

## Gemini stamps a badge on its output

A small four-pointed star, low in the right of frame. Removed from all 15 files
in drop 3.

Detection by "brightest thing in the corner" found a coin or an ice highlight
instead and patched the artwork. Detection by largest connected blob found
scenery. What worked was measuring the position across all fifteen: it is a
constant at 90.5% across, 85.8% down, so the search was abandoned in favour of
the constant.

Removal is a feathered disc filled with the median colour of the ring around
it. Blurring was tried first and does not work — blurring a bright star leaves
a softer bright star. The pixels have to be replaced.

## Other processing

- **466 MB became 20 MB.** Exports were 2048–2816px; a symbol is drawn at ~90
  CSS pixels.
- **Sizes normalised by area**, not longest edge — a wide subject scaled to
  match a tall one's width still reads as smaller.
- **Disconnected specks discarded before measuring.** A speck 1000px from the
  subject stretched its bounding box across the frame and told the normaliser a
  small monkey was the largest thing in the set.
- **One tile excluded for baked-in text.** Everything is OCR-checked.

## Known gaps

- The **lightning bolt** keeps a faint fringe — its glow blends into the
  checker. Regenerate it on black.
- **35 spare tiles** in `tiles/unassigned`, for games that do not exist yet.

## Provenance

AI-generated images cannot be copyrighted in the US, so ownership cannot be
warranted in a sale as they stand. See `docs/09-art-brief.md`.
