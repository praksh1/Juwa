import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BASE_CABINET,
  MIN_SYMBOL_CONTRAST,
  bonusCabinet,
  cabinetIsLegible,
  hexToHsl,
  mix,
  firstVivid,
  type GameTheme,
} from './cabinet.js';
import { contrastRatio, parseHex } from './contrast.js';

function hsl(h: number, s: number, l: number): string {
  // Minimal HSL -> hex, only used to sweep the hue circle in the tests.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Every hue, at the saturations and lightnesses a lobby tile realistically uses. */
function themeSweep(): GameTheme[] {
  const themes: GameTheme[] = [];
  for (let h = 0; h < 360; h += 10) {
    for (const s of [0.35, 0.6, 0.85, 1]) {
      for (const l of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        themes.push({ primary: hsl(h, s, l), secondary: hsl((h + 20) % 360, s, l), accent: '#FFC53D' });
      }
    }
  }
  return themes;
}

test('mix returns each end exactly', () => {
  assert.equal(mix('#102030', '#405060', 0), '#102030');
  assert.equal(mix('#102030', '#405060', 1), '#405060');
});

test('mix moves monotonically toward the target', () => {
  const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => parseHex(mix('#FFFFFF', '#000000', t)).r);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i]! < steps[i - 1]!, `step ${i} did not darken`);
  }
});

test('mix clamps out-of-range blends rather than producing invalid colours', () => {
  assert.equal(mix('#102030', '#405060', -5), '#102030');
  assert.equal(mix('#102030', '#405060', 9), '#405060');
});

test('the base cabinet keeps the reels readable', () => {
  assert.ok(cabinetIsLegible(BASE_CABINET));
});

test('EVERY hue produces a bonus cabinet the symbols still read on', () => {
  // The invariant that matters. A theme colour is picked to look good on a
  // lobby tile, where it is the subject; behind the reels it is the
  // background, and a saturated one swallows the symbols. Sweeping the whole
  // circle means a theme added later cannot quietly break this.
  const failures: string[] = [];
  for (const theme of themeSweep()) {
    const palette = bonusCabinet(theme);
    if (!cabinetIsLegible(palette)) {
      failures.push(`${theme.primary} -> bay ${palette.bay} (${contrastRatio('#FFFFFF', palette.bay).toFixed(2)}:1)`);
    }
  }
  assert.deepEqual(failures, [], `themes producing an illegible bonus cabinet:\n${failures.join('\n')}`);
});

test('the reel bay is always darker than the cabinet body', () => {
  // The recess is most of what separates a machine from five rectangles in a
  // row. If the bay ever came out lighter, the reels would read as raised.
  for (const theme of themeSweep()) {
    const { background, bay } = bonusCabinet(theme);
    const brightness = (hex: string) => {
      const { r, g, b } = parseHex(hex);
      return r + g + b;
    };
    assert.ok(
      brightness(bay) <= brightness(background),
      `${theme.primary}: bay ${bay} is lighter than body ${background}`,
    );
  }
});

/**
 * The real themes from the catalogue.
 *
 * Copied rather than imported: this package cannot depend on the engine. They
 * are here because the sweep alone missed a bug these caught — three of the
 * four below have a very dark `primary`, and the first version of
 * `bonusCabinet` darkened rather than normalised, so Frost Peak's bonus
 * cabinet came out #0a132c against a base of #0B1330 and the mode change was
 * invisible on the games most in need of one.
 */
const REAL_THEMES: Record<string, GameTheme> = {
  'juwa-classic': { primary: '#7C3AED', secondary: '#C026D3', accent: '#FFC53D' },
  'dragons-hoard': { primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' },
  'vault-breaker': { primary: '#18181B', secondary: '#52525B', accent: '#2FE3D6' },
  'frost-peak': { primary: '#1E3A8A', secondary: '#60A5FA', accent: '#DBEAFE' },
  'jade-temple': { primary: '#134E4A', secondary: '#14B8A6', accent: '#99F6E4' },
  'midnight-gold': { primary: '#1C1917', secondary: '#78716C', accent: '#FFC53D' },
};

function rgbDistance(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
}

test('the mode change is visible on EVERY theme, including the dark ones', () => {
  // The regression guard for the bug above. A mode indicator nobody notices is
  // not a mode indicator, and the games it failed on were precisely the ones
  // whose themes are already near-black.
  const failures: string[] = [];
  for (const [name, theme] of Object.entries(REAL_THEMES)) {
    const palette = bonusCabinet(theme);
    const moved = rgbDistance(palette.background, BASE_CABINET.background);
    if (moved < 60) failures.push(`${name}: body ${palette.background} vs base ${BASE_CABINET.background} (moved ${moved})`);
  }
  assert.deepEqual(failures, [], `bonus cabinets indistinguishable from the base:\n${failures.join('\n')}`);
});

test('every theme, swept, produces a visibly different bonus cabinet', () => {
  for (const theme of themeSweep()) {
    assert.ok(
      rgbDistance(bonusCabinet(theme).background, BASE_CABINET.background) >= 40,
      `${theme.primary}: bonus body barely moved from the base`,
    );
  }
});

test('every theme gets a vivid frame, even the monochrome ones', () => {
  // Vault Breaker is deliberately grey. Its secondary is grey too, so the
  // frame has to come from the accent — otherwise the one game whose theme
  // offers no colour gets the one bonus round with no signal.
  for (const [name, theme] of Object.entries(REAL_THEMES)) {
    const { s, l } = hexToHsl(bonusCabinet(theme).border);
    const usable = s * (1 - Math.abs(2 * l - 1));
    assert.ok(usable > 0.3, `${name}: frame is washed out (usable saturation ${usable.toFixed(2)})`);
  }
});

test('firstVivid skips a hue that is only there in the maths', () => {
  // Near-black and near-white both have a hue numerically and none to the eye.
  assert.equal(firstVivid('#010002', '#2FE3D6'), '#2FE3D6');
  assert.equal(firstVivid('#FFFFFE', '#C026D3'), '#C026D3');
});

test('firstVivid prefers order over maximum saturation', () => {
  // The bug this replaced: taking the most saturated made gold beat violet,
  // and since most themes share the same gold accent, every game's bonus
  // cabinet came out identical.
  assert.equal(firstVivid('#7C3AED', '#FFC53D'), '#7C3AED');
});

test('games with different themes get distinguishable bonus cabinets', () => {
  // The property the whole derivation exists for. Juwa Classic and Dragon's
  // Hoard share an accent colour and must still look nothing alike.
  //
  // The assertion is on the BODY AND FRAME TOGETHER rather than the body
  // alone, because a body collision is legitimate and does happen: Vault
  // Breaker is monochrome and falls through to its cyan accent, which lands in
  // the same hue family as Jade Temple's teal primary. Those two share a body
  // and differ in frame, which is a machine a player can still tell apart —
  // and contorting the hue selection to avoid it would be tuning the algorithm
  // to one coincidence in the current catalogue.
  const seen = new Map<string, string>();
  for (const [name, theme] of Object.entries(REAL_THEMES)) {
    const { background, border } = bonusCabinet(theme);
    const key = `${background}/${border}`;
    const clash = seen.get(key);
    assert.equal(clash, undefined, `${name} and ${clash} produce an identical cabinet ${key}`);
    seen.set(key, name);
  }
});

test('each theme keeps its own hue rather than collapsing to the shared accent', () => {
  // Six of the catalogue's themes carry accent #FFC53D. If the gold ever wins
  // the hue selection again, these three go identical.
  const bodies = ['juwa-classic', 'dragons-hoard', 'frost-peak'].map(
    (id) => bonusCabinet(REAL_THEMES[id]!).background,
  );
  assert.equal(new Set(bodies).size, 3, `expected three distinct bodies, got ${bodies.join(', ')}`);
});

test('the bonus body lands in the same lightness band whatever it was built from', () => {
  // This is what makes the derivation safe: a dark theme is lifted and a
  // bright one pulled down, so legibility does not depend on the theme.
  const lightnesses = Object.values(REAL_THEMES).map((t) => hexToHsl(bonusCabinet(t).background).l);
  const spread = Math.max(...lightnesses) - Math.min(...lightnesses);
  assert.ok(spread < 0.02, `bonus body lightness varies by ${spread.toFixed(3)} across themes`);
});

test('different games get visibly different bonus cabinets', () => {
  // The whole reason for deriving rather than hardcoding one red.
  const dragon = bonusCabinet({ primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' });
  const frost = bonusCabinet({ primary: '#1E3A8A', secondary: '#60A5FA', accent: '#DBEAFE' });
  assert.notEqual(dragon.background, frost.background);
  // Dragon's is redder; Frost's is bluer. Anything else means the hue was lost
  // in the darkening, which would make every game's bonus look the same.
  const d = parseHex(dragon.background);
  const f = parseHex(frost.background);
  assert.ok(d.r > d.b, `dragon bonus is not red-dominant: ${dragon.background}`);
  assert.ok(f.b > f.r, `frost bonus is not blue-dominant: ${frost.background}`);
});

test('the contrast floor is the large-text threshold, not the body-text one', () => {
  assert.equal(MIN_SYMBOL_CONTRAST, 3);
});
