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
 * Near-black with a violet cast, arcade-neon accents. Confident and adult: the
 * failure mode being avoided is anything that reads as a children's game, so
 * there is no primary rainbow here and no bouncy pastel.
 *
 * The chrome recedes and the games carry the colour. Electric cyan is the
 * interactive accent — ONE glowing element per view, not everywhere, or the
 * glow stops meaning "press this". Magenta is reserved for bonus and jackpot
 * moments. Brass, not bright gold, carries currency: it reads as a token rather
 * than as treasure, which is the correct signal for coins that have no cash
 * value.
 *
 * Green for wins, red for alerts — with one deliberate exception noted below.
 */

export const colors = {
  /** Backgrounds, darkest to lightest. `base` is the app background. */
  surface: {
    base: '#08070E',
    raised: '#13111C',
    overlay: '#1C1929',
    border: '#2A2539',
  },

  /** Primary brand colour. Buttons, highlights, the logo. */
  gold: {
    dark: '#7A6425',
    default: '#C8A44D',
    light: '#E6CE8C',
    /** For the "big win" glow. */
    glow: 'rgba(200, 164, 77, 0.45)',
    /**
     * A faint tint for highlighting a card without wrecking the contrast of the
     * text on top of it. Using `gold.dark` as a fill here drops muted text below
     * the readable threshold — this is the version that stays legible.
     */
    wash: 'rgba(200, 164, 77, 0.18)',
  },

  /**
   * Secondary accents. These carry the "playful" half of the design: game
   * artwork, category badges, jackpot moments. Used at full strength on tiles
   * and sparingly in the chrome.
   */
  neon: {
    /** The primary interactive accent. One glowing thing per view. */
    cyan: '#2FE3D6',
    magenta: '#FF3D8A',
    violet: '#8B5CF6',
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
    win: '#3FD68A',
    winBright: '#7DEDB4',
    loss: '#5A5470',
    warning: '#E0A83C',
    error: '#FF6B6B',
  },

  text: {
    primary: '#EEEBF4',
    /**
     * Sits between `primary` and `muted`. The brief names only two greys, but
     * a two-step ramp forces every secondary line down to `muted`, which is
     * below the readable threshold on the raised panels.
     */
    secondary: '#A79FBC',
    muted: '#7B7591',
    inverse: '#08070E',
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
/**
 * The display face: a heavy condensed grotesque, set tight and uppercase.
 *
 * The named webfonts are listed first so that dropping the files into the app
 * later picks them up with no code change. Until then it falls through to
 * Impact and Haettenschweiler, which ship with Windows and macOS respectively
 * and are the same genre of letterform. This project cannot fetch a webfont at
 * build time, and a display face that arrives late is worse than one that was
 * never promised — the headline reflows in front of the player.
 */
export const displayFace =
  "'Archivo Black', 'Anton', 'Bebas Neue', Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif";

/** Body and UI. Falls through to the platform's own grotesque. */
export const bodyFace =
  "'Archivo', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const typography = {
  display: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    fontFamily: displayFace,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  h1: { fontSize: 26, lineHeight: 30, fontWeight: '800', fontFamily: displayFace, letterSpacing: 0.4 },
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
  reelStagger: 270,
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
