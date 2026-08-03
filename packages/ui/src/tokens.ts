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
 * Dark background: casinos are dark. Gold and neon only read as luxurious
 * against near-black; on white they look cheap. Dark also makes the reels the
 * brightest thing on screen, which is where we want the eye.
 *
 * Gold as the primary: it reads as premium across every culture we're likely to
 * launch in, and it doesn't collide with the red/green we need for
 * win/loss states.
 *
 * Green for wins, red for losses — with one deliberate exception noted below.
 */

export const colors = {
  /** Backgrounds, darkest to lightest. `base` is the app background. */
  surface: {
    base: '#0A0710',
    raised: '#141020',
    overlay: '#1E1830',
    border: '#2A2340',
  },

  /** Primary brand colour. Buttons, highlights, the logo. */
  gold: {
    dark: '#8C6D1F',
    default: '#D4AF37',
    light: '#F0D97D',
    /** For the "big win" glow. */
    glow: 'rgba(212, 175, 55, 0.45)',
  },

  /** Secondary accent — used sparingly, for jackpots and premium moments. */
  neon: {
    magenta: '#FF2E88',
    cyan: '#00E5FF',
    violet: '#8B5CF6',
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
    loss: '#7A5560',
    warning: '#F59E0B',
    error: '#EF4444',
  },

  text: {
    primary: '#F5F3F7',
    secondary: '#A79FB8',
    muted: '#6B6480',
    inverse: '#0A0710',
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
 */
export const typography = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '800' },
  h1: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  h2: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  h3: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /**
   * Money is always tabular — digits share a fixed width so a balance ticking
   * from 999 to 1000 doesn't make the whole row jump sideways.
   */
  money: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moneyLarge: { fontSize: 32, lineHeight: 38, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
