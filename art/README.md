# Art

Generated with Gemini, then processed into what the game can actually ship.

```
art/
  symbols/      40 PNG, 512x512, transparent
  tiles/        45 JPEG, 1024x1113 (the 0.92 aspect the lobby renders)
  backgrounds/   3 JPEG, 1536x1024
```

`npm run check:art art` validates the lot.

## What was done to the delivered files

**466 MB became 15 MB.** Exports were 2048–2816px and up to 8 MB each; a slot
symbol is drawn at about 90 CSS pixels, so 512 is already twice what a retina
screen resolves. GitHub refused the upload at full size, and so would a phone
on mobile data.

**Eleven symbols had no transparency.** The generator painted the transparency
checkerboard into the pixels — on a dark reel those would have appeared as grey
checked boxes. Recovered by flood-filling the background inward from the edges,
which leaves interior whites alone: several subjects are largely white, and a
global colour match would have punched holes through them.

**Two files could not be recovered** and were dropped: the checkerboard covered
nearly the whole frame, leaving nothing to isolate.

**Symbol sizes were normalised by area, not by longest edge.** A wide subject
scaled so its width matches a tall one still reads as smaller, because the eye
judges overall mass.

**Disconnected specks are discarded before measuring.** Background removal left
faint debris near the frame edges, and a speck 1000px from the subject stretched
its bounding box across the whole image — which told the normaliser that a small
monkey was already the largest thing in the set, and shrank everything else to
match it.

**One tile was excluded for baked-in text** — it carried a game title and a
paytable strip. Every file was OCR'd; the only other hits were ornament misread
as letters, confirmed by eye.

## Known gaps

- **Backgrounds: 3 of 12.** The delivered `background/` folder was mostly more
  symbols, which is where 10 of the 40 came from.
- **The lightning bolt** keeps a faint fringe: its glow blends into the
  checkerboard, so there is no clean edge to cut along. Worth regenerating.
- **Filenames** are the generator's for 20 of them. Harmless — the loader maps
  files to symbols explicitly — but unhelpful to read.

## Provenance

AI-generated images cannot be copyrighted in the US, so ownership of these
cannot be warranted in a sale as they stand. See `docs/09-art-brief.md`. The
route to defensible ownership is a designer materially editing them, with the
layered sources kept as evidence of authorship.
