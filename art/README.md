# Drop generated art here

Upload straight from the generator. **Do not rename anything** —
`Gemini_Generated_Image_8fj20a.png` is fine. The folder says what a file is.

```
art/
  symbols/
    classic/     5 files: diamond, bell, cherry, plum, lemon
    gems/        5 files
    ancient/     5 files
    neon/        5 files
    nature/      5 files
    festival/    5 files
  backgrounds/   12 files
  tiles/         50 files, one per game
  overlays/       3 files: burst, big, mega
  ui/             6 files
```

Then, from the repo root:

```
npm run check:art art
```

It reports what each problem will do on screen, so you can decide whether a file
is worth regenerating.

## What it checks

Per file — dimensions, a real alpha channel, whether the background actually got
removed, whether the subject is centred, whether it is large enough to read at
60px, whether it has enough margin not to crop, and file size.

Across a family — whether the five symbols carry the same visual weight. This is
the one that cannot be seen file by file: a set where one symbol is twice the
size of another looks broken in motion while every individual file passes.

## Sizes

| Folder | Size | Background |
|---|---|---|
| `symbols/*` | 512×512 | must be transparent |
| `backgrounds` | 1536×1024 | opaque |
| `tiles` | 1024×1024 | opaque |
| `overlays` | 1024×1024 | must be transparent |
| `ui` | 512×512 | must be transparent |

Whole set under 8MB. That figure is a first load on mobile data.

## Two things worth repeating

**Which five symbols.** `SEVEN`, `BAR`, `WILD` and `SCATTER` stay as the vector
art already in `app/src/components/SlotSymbol.tsx` — they carry typography, and
they are the symbols a player must read instantly on a moving reel. Generate
only `DIAMOND`, `BELL`, `CHERRY`, `PLUM`, `LEMON`, reinterpreted per family.

**Value hierarchy.** `DIAMOND` pays most and `LEMON` least. Rank your five by how
expensive they *look* and check that order matches. If the lemon looks more
lavish than the diamond, players misread the paytable and feel cheated — which
is a support ticket, not a style opinion.

Licences, invoices and layered source files go in `art/licences/`. That folder is
part of what gets sold.
