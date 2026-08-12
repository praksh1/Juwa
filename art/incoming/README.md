# art/incoming — put raw generator output here

Drop files here exactly as Gemini returns them. **Do not rename, resize, crop or
clean them up.** This folder is the untouched drop; processing happens on the
way out of it, into `art/celebration/`.

## Why raw, and why a separate folder

Three drops of generated art have landed in this repo so far and **not one was
shippable as delivered** — see the fault list in `../README.md`. Every drop has
needed the same two repairs:

- **The transparency checkerboard painted into the pixels.** The image looks
  correct in a preview on white and shows a grey checked box on a dark reel.
  Drop 1: 11 of 30 files. Drop 2: 4 of 9. Drop 3: 5 of 5 from Gemini.
- **A four-pointed badge stamped into the corner**, at a constant 90.5% across
  and 85.8% down.

Both are recoverable from a raw file and *not* recoverable from one that has
already been resized or re-encoded — rescaling smears the checkerboard into the
artwork and moves the badge off its constant position. So: raw in here, cleaned
files out into `art/celebration/`.

Nothing in this folder ships. The build copies the whole `art/` tree, so treat
that as a reason to keep this folder small rather than as a problem — files are
moved out of it, not copied.

## Checking a drop

```
npm run check:art art/incoming
```

Reports opaque backgrounds, inconsistent subject sizes, off-centre subjects,
near-identical silhouettes and oversized files. It is dependency-free and reads
the PNG header directly, so it works on a fresh clone.

## Naming

Use the filenames in `docs/13-win-celebration-art.md` exactly — `coin-00.png`,
`dragon-wing-near.png`, and so on. The code loads them by name, and a file
called `Gemini_Generated_Image_1.png` is one I have to guess about.

## What happened to the first drop

25 files arrived, 20 with the checkerboard baked in and 5 (the glows, on solid
black) correct. All 25 were recovered — the 20 by `scripts/decheck-art.mjs`, the
5 by leaving them alone — and none needed regenerating. The repaired files live
in `art/overlays/`.

The raw originals stay here as provenance and as the input the repair can be
re-run from if it is ever improved. They are excluded from the web build by
`app/scripts/finalize-web.mjs`: they are the BROKEN versions of files that ship
from `overlays/`, and shipping both would be megabytes of download for images
nothing references.
