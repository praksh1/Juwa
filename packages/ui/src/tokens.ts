/**
 * Design tokens — the single source of truth for how Juwa looks.
 *
 * A "token" is a named design decision. Instead of typing `#D4AF37` in forty
 * places, every gold thing in the app refers to `colors.gold.default`. When you
 * decide the gold should be warmer, you change it here and the whole app moves
 * together.
 *
 * This is what stops an app from slowly turning into seventeen slightly
 * different greens over six months of small changes.
 *
 * WHY THESE CHOICES
 *
 * Dark NAVY background, not neutral black. The frame of a casino app should
 * recede so the games are the brightest thing on screen — bright artwork on a
 * bright background turns to mush. Navy does that job while staying warmer and
 * more playful than the near-black we started with, which read as a betting
 * site rather than as a game.
 *
 * Bright, saturated accents. Juwa is a social casino: the money it makes comes
 * from coin sales, not from anyone's losses, so the app should look like a game
 * and not like a bookmaker. The apps that win this category are closer to a
 * puzzle game than to a Vegas floor.
 *
 * Gold as the primary: it reads as premium across every culture we're likely to
 * launch in, and it doesn't collide with the red/green we need for
 * win/loss states. It is a brighter, warmer gold than a luxury brand would use,
 * because it has to hold its own next to magenta and cyan.
 *
 * Green for wins, red for losses — with one deliberate exception noted below.
 */

export const colors = {
  /** Backgrounds, darkest to lightest. `base` is the app background. */
  surface: {
    base: '#070C1C',
    raised: '#111A38',
    overlay: '#1B274D',
    border: '#2D3C6E',
  },

  /** Primary brand colour. Buttons, highlights, the logo. */
  gold: {
    dark: '#A9730A',
    default: '#FFC53D',
    light: '#FFE08A',
    /** For the "big win" glow. */
    glow: 'rgba(255, 197, 61, 0.45)',
    /**
     * A faint tint for highlighting a card without wrecking the contrast of the
     * text on top of it. Using `gold.dark` as a fill here drops muted text below
     * the readable threshold — this is the version that stays legible.
     */
    wash: 'rgba(255, 197, 61, 0.16)',
  },

  /**
   * Secondary accents. These carry the "playful" half of the design: game
   * artwork, category badges, jackpot moments. Used at full strength on tiles
   * and sparingly in the chrome.
   */
  neon: {
    magenta: '#FF3D8A',
    cyan: '#22D3EE',
    violet: '#A855F7',
    lime: '#A3E635',
    orange: '#FF8A3D',
  },

  /**
   * Feedback colours.
   *
   * Note that `loss` is a muted grey-red, not a shouting red. Losing is the
   * common case in a casino — flashing an alarm colour at the player forty
   * times an hour makes the app feel hostile. Wins should be loud; losses
   * should be quiet.
   */
  feedback: {
    win: '#22C55E',
    winBright: '#4ADE80',
    loss: '#5A5F80',
    warning: '#FBBF24',
    error: '#F87171',
  },

  text: {
    primary: '#F4F7FF',
    secondary: '#A9B6D8',
    muted: '#6E7CA6',
    inverse: '#070C1C',
  },

  /** Roulette and card suits — fixed by the games themselves. */
  table: {
    felt: '#0B3D2E',
    feltLight: '#12563F',
    red: '#DC2626',
    black: '#18181B',
  },
} as const;

/**
 * Spacing scale, in points. Every margin and padding in the app must come from
 * this list. Arbitrary values (13, 27) are what make a layout feel subtly wrong
 * without anyone being able to say why.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Type scale. Sizes step by roughly 1.25x, which is a standard musical ratio —
 * it gives clear hierarchy without any two sizes looking like a mistake.
 *
 * Sized for a PHONE held at arm's length, not for a desktop browser. The first
 * version of this scale was a third larger, and on a 390pt-wide screen a single
 * heading ate half the lobby — which pushed the games, the only thing a player
 * came for, below the fold.
 */
export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  /**
   * Money is always tabular — digits share a fixed width so a balance ticking
   * from 999 to 1000 doesn't make the whole row jump sideways.
   */
  money: { fontSize: 16, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moneyLarge: { fontSize: 27, lineHeight: 33, fontWeight: '800', fontVariant: ['tabular-nums'] },
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  goldGlow: {
    shadowColor: colors.gold.default,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
} as const;

/**
 * Animation timings.
 *
 * These numbers are the difference between an app that feels premium and one
 * that feels cheap, and they are not arbitrary:
 *
 * - Under ~100ms reads as instant. Use for taps, so the UI feels responsive.
 * - 200–300ms is the sweet spot for transitions: visible but not sluggish.
 * - Slot reels deliberately run LONG (2.5s). The anticipation is the product.
 *   A reel that stops instantly is mathematically identical and commercially
 *   worthless.
 */
export const motion = {
  instant: 80,
  fast: 160,
  normal: 240,
  slow: 400,
  reelSpin: 2500,
  /** Each reel stops this much later than the one before it. */
  reelStagger: 220,
  /** When the last reel could complete a big win, slow it down further. */
  nearMissExtension: 1200,
  cardDeal: 300,
  cardFlip: 350,
  /** Standard easing — starts fast, settles gently. */
  easing: { in: 0.42, out: 0.0, x2: 0.58, y2: 1.0 },
} as const;

/** Touch targets below 44pt fail Apple's accessibility guidance. */
export const layout = {
  minTouchTarget: 44,
  screenPadding: spacing.lg,
  maxContentWidth: 720,
  tabBarHeight: 64,
} as const;

export type Colors = typeof colors;
export type Spacing = keyof typeof spacing;
export type TypographyVariant = keyof typeof typography;
