import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BASE_CABINET, anticipatingReels, bonusCabinet, colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { publishBalance } from '../api/usePlayer';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Card, Txt } from '../components/primitives';
import { SoundToggles } from '../components/SoundToggles';
import { useRoute } from '@react-navigation/native';
import { Reel, SPIN_UP_SECONDS, type ReelPhase } from '../components/Reel';
import { tintFromAccent } from '../components/SlotSymbol';
import { materialFor } from '../components/symbols/materials';
import { useCompactLayout } from '../layout';
import { scatterTrigger, slotDetails, slotPaytable } from '../api/games';
import { sounds, spinNow, stopBedIfPlaying, unlock, useSoundSet } from '../sound';
import { soundSetFor } from '../api/sound-sets';
import { winTier, rollUpDuration, type WinTier } from '../motion';
import { CoinCounter } from '../components/CoinCounter';
import { CoinBurst } from '../components/CoinBurst';
import {
  PaytableButton,
  RulesIntro,
  rulesDismissed,
} from '../components/GameRules';
import { REEL_GAP, WinLines, litCells, useWinCycle } from '../components/WinLines';
import { CabinetGlass, ReelFrame, SlotConsole, SpinLever } from '../components/SlotControls';
import { cabinetFor, roomFor } from '../api/cabinets';
import { hasTileArt } from '../components/GameArt';
import { WinOverlay, useCabinetShake } from '../components/WinOverlay';
import { DragonRoar, DRAGON_GAME_ID } from '../components/DragonRoar';
import { HoldSpinRound } from '../components/HoldSpinRound';
import { PrizeWheel } from '../components/PrizeWheel';
import { BonusMeter, type BonusReward } from '../components/BonusMeter';
import {
  PlayApiError,
  createPlayApi,
  type PlayApi,
  type FeatureOutcome,
  type RoundResponse,
  type SlotsState,
  USE_DEMO_API,
} from '../api/client';

/** Free spins run at this fraction of the base spin duration. */
const FS_SPEED = 0.45;

/**
 * The landing schedule, in seconds. These are the numbers that decide whether
 * the machine feels mechanical or cheap.
 */
const BASE_LAND_SECONDS = 0.95;
/** Gap between consecutive reels stopping. */
const STAGGER_SECONDS = 0.27;
/** Added to EACH reel that still has the bonus live on it. */
const ANTICIPATION_SECONDS = 0.6;
/** Booked slightly ahead so the audio thread receives the schedule in time. */
const LEAD_IN_SECONDS = 0.04;
/**
 * The shortest the reels may loop before they are allowed to start landing.
 *
 * The reels begin turning on the tap and land when the server answers, which
 * is the trick that hides the round trip inside an animation the player was
 * going to watch anyway. But the demo adapter answers in 180ms and a fast
 * connection is not much slower — less than the 420ms the reels take to reach
 * full speed. Without a floor the machine would begin decelerating while it
 * was still accelerating, which does not look like a fast spin; it looks like
 * a fault.
 *
 * The margin on top is so the reels are demonstrably AT speed for a moment
 * rather than reaching it and immediately giving it up.
 */
const MIN_LOOP_SECONDS = SPIN_UP_SECONDS + 0.16;
/**
 * How long the winning symbols stay lit before they are cleared by a tumble.
 *
 * Short, because the chain has to keep moving to read as a chain, but not zero:
 * symbols that vanish the instant they are announced were never shown at all,
 * and the player is left with a grid that changed for no visible reason.
 */
const CASCADE_HOLD_MS = 750;
/** How long the refill takes to fall. All reels together — see `landReels`. */
const CASCADE_DROP_SECONDS = 0.32;
/** The refill falls two symbols, not the ten a full landing covers. */
const CASCADE_TRAVEL = 2;

/**
 * The largest a cell may get.
 *
 * Well above the old 58, which was both the design size AND the ceiling — so
 * every machine in the catalogue clamped to it and none of them could differ.
 * A three-reel classic reaches about 108 on a 390-point phone; the ceiling is
 * only here to stop a hypothetical two-reel game filling the screen.
 */
const MAX_SYMBOL_SIZE = 118;
/**
 * What a symbol fills of its cell unless the cabinet asks for more.
 *
 * High, because on a phone the cell is already as small as the geometry allows
 * and every point of inset inside it comes straight off the artwork.
 */
const DEFAULT_SYMBOL_FILL = 0.96;
/**
 * How much taller than wide a cell is unless the cabinet says otherwise.
 *
 * Height is abundant and width is not: on a 390x844 phone a five-reel machine
 * has about 160 points of height per row available and can only afford 68 of
 * width. Some of that surplus belongs in the cells — a cabinet's cells are
 * taller than they are wide — but only some.
 *
 * The first attempt at this set 1.5, and it was wrong in a way worth writing
 * down: the machine did grow to fill the screen, but a 68-point symbol in a
 * 102-point cell is a symbol with a third of a symbol's worth of empty space
 * under it, and thirty of those read as a sparse grid of small pictures. The
 * player asked for symbols that were "loud and clear" and got the opposite of
 * loud by making their boxes bigger.
 *
 * Surplus height goes to the CABINET instead — the top glass above the reels —
 * because that is where a real machine puts it, and a taller cabinet makes the
 * machine bigger without making a single symbol smaller.
 */
const DEFAULT_ROW_ASPECT = 1.18;
/**
 * The band a cabinet may choose its cell shape inside.
 *
 * Square is the floor: a cell shorter than it is wide clips the artwork, since
 * the symbol is square and sized off the cell's WIDTH. The ceiling is where a
 * grid stops reading as a grid and starts reading as columns of separate
 * pictures, which is the mistake described above.
 */
const MIN_ROW_ASPECT = 1.0;
const MAX_ROW_ASPECT = 1.34;

/**
 * Everything on screen that is not the reel window or the top glass.
 *
 * MEASURED off the built screen at 390x844, not estimated: navigation header
 * 95, balance strip and its gap 92, readout 48, console and its gap 92,
 * fairness line 42, tab bar 62, and the cabinet's own borders and padding 15.
 *
 * The old figure here was 230, which was not a measurement of anything. It
 * survived only because width binds first on a three-row machine, so the
 * height budget was never actually spent — until a five-row diamond spent it
 * and pushed the spin button off the bottom of the phone.
 *
 * In landscape the console moves BESIDE the machine and the readout collapses,
 * so most of that budget comes back and the reels take the height instead.
 */
const PORTRAIT_CHROME = 436;
/*
 * Landscape is not "portrait with more room": it has 390 points of height in
 * total, of which the navigation header takes 55 and the balance strip 48. The
 * console moves out of the budget entirely — it goes in a rail beside the
 * reels — but what is left is still less than half the portrait budget, and
 * understating it clipped the balance strip behind the header.
 */
const COMPACT_CHROME = 200;
/**
 * The tallest the top glass may grow.
 *
 * It exists to absorb height the reels cannot use, and on a phone there is a
 * lot of that: five reels fix a symbol at about 72 points whatever the screen
 * does, so a three-row window is 260 points tall on an 844-point phone and no
 * arithmetic changes it. The rest belongs to the cabinet — which is what a real
 * fruit machine's top box is, and it is not small.
 *
 * Capped all the same, because past this the sign is a billboard with a slot
 * machine underneath it rather than a machine with a name on it.
 */
const MAX_GLASS = 150;
/** Below this it is a stripe rather than a sign, and is better not drawn. */
const MIN_GLASS = 30;
/**
 * Height set aside for the glass BEFORE the reels are sized.
 *
 * Without it, a tall grid takes every point there is and the machine loses the
 * one part that says which game you are in — Ocean Drift's five-row diamond
 * did exactly that. A reserve costs the diamond about four points of symbol
 * and buys it a nameplate.
 */
const GLASS_RESERVE = 34;

/**
 * How long auto-spin waits after being switched on, before spending anything.
 *
 * Long enough to press STOP having changed your mind, which is the whole
 * point: the previous version started a round almost immediately, so realising
 * you meant to set the stake first cost you a spin.
 */
const AUTO_GRACE_MS = 2_600;
/**
 * The gap between automatic spins, by what the last one paid.
 *
 * A win cleared by the next spin was not shown at all, and the bigger it was
 * the more there is to take in — so the pause grows with it. Two losing spins
 * have nothing between them worth waiting for.
 */
const AUTO_PAUSE_MS: Record<WinTier, number> = {
  none: 900,
  win: 1_800,
  burst: 2_600,
  big: 4_000,
  mega: 5_500,
};

/** What the drops after the first grid are worth, in stake multiples. */
function dropSum(steps: readonly { totalMultiplier: number }[]): number {
  return steps.reduce((sum, step) => sum + step.totalMultiplier, 0);
}


/** What the machine shows before the first spin. */
function idleGrid(rows: readonly number[]): string[][] {
  return rows.map((height) => {
    const column = ['CHERRY', 'BAR', 'LEMON', 'BELL', 'SEVEN'].slice(0, height);
    while (column.length < height) column.push('CHERRY');
    return column;
  });
}


/**
 * The slot machine.
 *
 * THE IMPORTANT PART: this screen decides nothing. It sends a stake, receives a
 * finished result from the server, and animates it. The reels are already
 * spinning while the response is in flight, so the network round trip hides
 * inside the animation the player would be watching anyway — the spin *feels*
 * instant even though the outcome was computed 200ms away.
 *
 * If the request fails, the reels stop on the previous grid and the error is
 * shown. They never stop on a guess.
 */
export function SlotsScreen() {
  const api = useRef<PlayApi>(createPlayApi()).current;

  /**
   * Which game this is.
   *
   * The route name IS the game id — every slot in the catalogue is registered
   * against this one screen. So the screen is generic: limits, theme and the
   * published RTP all come from the catalogue entry rather than from constants
   * that would only ever be right for one game.
   */
  const route = useRoute();
  const gameId = route.name;
  const details = slotDetails(gameId);
  const paytable = slotPaytable(gameId);
  /**
   * How many scatters this game needs. Zero when it has no bonus round, which
   * switches anticipation off entirely rather than guessing a threshold.
   */
  const scatterTriggerCount = paytable ? (scatterTrigger(paytable)?.count ?? 0) : 0;
  /**
   * The rules card, shown once per game unless dismissed for good.
   *
   * Read from storage in the initial state rather than an effect: an effect
   * would render the machine first and drop the card over it a frame later,
   * which reads as a glitch rather than an introduction.
   */
  const [showRules, setShowRules] = useState(() => !rulesDismissed(gameId));
  const MIN_BET = minor(details?.minBet ?? 20);
  const MAX_BET = minor(details?.maxBet ?? 50_000);
  /**
   * Reel count comes from the catalogue, not a constant. Three of the games are
   * three-reel classics, and a screen hard-wired to five would render two empty
   * columns and wait forever for a fifth reel to report that it had stopped.
   */
  const REELS = details?.reels ?? 5;
  /**
   * Rows PER REEL, not one number for the machine.
   *
   * The diamond games are 3-4-5-4-3 — widest in the middle — which is the only
   * shape an "all ways pay" mechanic can be drawn on, since there is no fourth
   * row on reel one for a payline to cross. A single row count cannot express
   * that, and a machine hard-wired to a rectangle would show the diamond games
   * with cells they do not have.
   */
  const ROWS = useMemo(
    () => details?.rows ?? Array.from({ length: REELS }, () => 3),
    [details?.rows, REELS],
  );
  /** The deepest reel. What the bay has to be tall enough for. */
  const MAX_ROWS = useMemo(() => Math.max(...ROWS), [ROWS]);
  const IDLE_GRID = useMemo(() => idleGrid(ROWS), [ROWS]);

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(2_000));
  const [reelPhase, setReelPhase] = useState<ReelPhase>('idle');
  const spinning = reelPhase !== 'idle';
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [grid, setGrid] = useState<string[][]>(() => IDLE_GRID);
  /**
   * Scatters on the grid the player is looking at.
   *
   * Zero while the reels are turning, because `grid` already holds the SETTLED
   * result the moment the request returns — counting it during the spin would
   * light all three lamps before the reels had landed and give the outcome away
   * a second and a half early.
   */
  const visibleScatters = useMemo(
    () =>
      reelPhase !== 'idle'
        ? 0
        : grid.reduce((n, reel) => n + reel.filter((cell) => cell === 'SCATTER').length, 0),
    [grid, reelPhase],
  );
  const [error, setError] = useState<string | null>(null);
  const spinToken = useRef(0);

  /**
   * Free-spins state.
   *
   * The server resolves the entire bonus round in the same request as the base
   * spin — `state.freeSpins` arrives already decided. So this is pure
   * presentation: the money is settled, and what remains is showing the player
   * what they won rather than depositing it silently.
   *
   * That matters commercially. The bonus round is roughly one spin in 117 and
   * is a real slice of the 96.25% RTP. Paying it out without the sequence means
   * charging players for excitement and not delivering it.
   */
  const [phase, setPhase] = useState<
    'idle' | 'base' | 'fs-intro' | 'fs' | 'fs-total' | 'feature'
  >('idle');
  /**
   * The feature round being played, if one is.
   *
   * Held rather than read off the round because the round is replaced by the
   * next spin the moment one starts, and the presentation outlives the request
   * that produced it.
   */
  const [feature, setFeature] = useState<FeatureOutcome | null>(null);
  const [freeSpinIndex, setFreeSpinIndex] = useState(0);
  const [freeSpinsTotal, setFreeSpinsTotal] = useState(0);
  const [runningWin, setRunningWin] = useState(0);
  /**
   * The same figure as `runningWin`, readable from inside the spin closure.
   *
   * The bonus round accumulates across an await-driven loop, and reading the
   * state variable there returns whatever it was when the closure was created
   * — zero — so the final celebration would be sized off nothing.
   */
  const runningWinRef = useRef(0);
  /**
   * Resolved by the feature component when its sequence has finished.
   *
   * A hold-and-spin round runs for as long as coins keep landing, so the spin
   * sequence cannot wait a fixed number of milliseconds for it — it has to be
   * told.
   */
  const featureDone = useRef<(() => void) | null>(null);
  // Increments per spin so each reel run is a distinct animation.
  const [reelRound, setReelRound] = useState(0);
  /**
   * The landing schedule: when each reel starts settling and for how long, in
   * seconds on the shared clock. Computed once per spin and handed to the
   * reels, so every reel and every stop sound refers to one timeline.
   */
  const [schedule, setSchedule] = useState<{ from: number; duration: number }[]>([]);
  /** Which reels are lit for the bonus on the spin currently animating. */
  const [anticipating, setAnticipating] = useState<boolean[]>([]);
  /**
   * The ladder rung the current tumble is paying at, or 0 when not tumbling.
   *
   * Shown on the machine because it is the entire reason a chain is worth
   * watching: without it a fourth drop looks exactly like a first one.
   */
  const [cascadeStep, setCascadeStep] = useState(0);
  /**
   * Auto-spin.
   *
   * Held here rather than inside the console, because it has to survive the
   * spin it triggers and because stopping it has to be possible mid-round —
   * a player who wants out of an auto-spin wants out now, not after the reels
   * have finished.
   */
  const [auto, setAuto] = useState(false);
  /** True until the grace period after pressing AUTO has elapsed. */
  const [autoStarting, setAutoStarting] = useState(false);
  /** The machine this game is built as: frame, room, and which controls. */
  const cabinet = useMemo(() => cabinetFor(gameId), [gameId]);
  /** The room this machine stands in — its own tile unless told otherwise. */
  const room = useMemo(() => roomFor(gameId, hasTileArt(gameId)), [gameId]);
  /**
   * The metal the drawn symbols are cast in.
   *
   * SEVEN, BAR, WILD and SCATTER stay vector in every game — they are
   * typography and the two symbols that must be recognised instantly — so they
   * were identical everywhere. Same glyph now, but cast in this game's own
   * colour, which is the difference between one seven and twenty-three.
   */
  const symbolTint = useMemo(() => tintFromAccent(details?.theme.accent), [details?.theme.accent]);
  /** What this game's low symbols are cut from. See symbols/materials. */
  const material = useMemo(() => materialFor(gameId), [gameId]);

  /*
   * This machine's own recordings.
   *
   * Chosen on entry and preloaded immediately, which is why it is an effect
   * rather than something the spin handler does: decoding happens happily on a
   * suspended audio context, so the whole set is ready before the player has
   * finished reading the rules card and the first spin is never the one that
   * waits for a download.
   */
  useEffect(() => {
    const set = soundSetFor(gameId);
    useSoundSet(set);
    /*
     * Leaving the game takes its music with it, faded rather than cut. Without
     * this, backing out to the lobby leaves the last cabinet still playing
     * underneath it.
     *
     * Conditional, because this cleanup can run AFTER the next screen has
     * already started its own bed — see stopBedIfPlaying. Unconditional, it
     * silenced whatever the player had just navigated to.
     */
    const bed = set.bed;
    return () => {
      if (bed) stopBedIfPlaying(bed);
    };
  }, [gameId]);

  /**
   * Resolved by the LAST reel's own stop callback. This is the handshake that
   * keeps the sound and the readout tied to what is actually on screen.
   */
  const landingResolver = useRef<(() => void) | null>(null);

  /**
   * The celebration.
   *
   * Kept separate from `settlement` because the two have different lifetimes:
   * the settled figure stays on screen until the next spin, while the dimming,
   * the burst and the overlay run once and stop. Driving both from one value
   * left the grid dimmed indefinitely after any win.
   */
  const [celebration, setCelebration] = useState<{ tier: WinTier; amount: number; round: number }>({
    tier: 'none',
    amount: 0,
    round: 0,
  });
  const celebrationRound = useRef(0);
  const shake = useCabinetShake(celebration.tier, celebration.round);

  /**
   * How long auto-spin waits before the next round.
   *
   * Three things it has to respect, all of them the player's:
   *
   *   CHANGING YOUR MIND. Pressing AUTO used to start a spin almost at once,
   *   which is a trap — the moment you realise you meant to change the stake
   *   first, the money is already gone. The first round waits.
   *
   *   SEEING WHAT YOU WON. A win that is cleared by the next spin was not
   *   shown. The pause scales with the size of it, because a mega win takes
   *   longer to read and is the one you actually want to look at.
   *
   *   NOT DRAGGING. Between two losing spins there is nothing to look at, so
   *   that gap stays short.
   */
  const autoDelay = useMemo(() => {
    if (autoStarting) return AUTO_GRACE_MS;
    return AUTO_PAUSE_MS[celebration.tier];
  }, [autoStarting, celebration.tier]);

  /** Start the grace period when auto is switched on, and clear it after. */
  useEffect(() => {
    if (!auto) {
      setAutoStarting(false);
      return;
    }
    setAutoStarting(true);
    const timer = setTimeout(() => setAutoStarting(false), AUTO_GRACE_MS);
    return () => clearTimeout(timer);
  }, [auto]);

  const celebrate = useCallback((payout: number, stake: number) => {
    const tier = winTier(payout, stake);
    if (tier === 'none') return;

    celebrationRound.current += 1;
    setCelebration({ tier, amount: payout, round: celebrationRound.current });

    if (tier === 'mega') sounds.megaWin();
    else if (tier === 'big') sounds.bigWin();
    else if (tier === 'burst') sounds.coins(8);
    else sounds.win();
  }, []);

  /**
   * The reel's own stop callback. It no longer plays the sound — that was
   * booked in advance against the audio clock — it only reports that the last
   * reel has physically settled, which is what the spin sequence waits on.
   */
  const handleReelLanded = useCallback(
    (index: number) => {
      if (index === REELS - 1) {
        landingResolver.current?.();
        landingResolver.current = null;
      }
    },
    [REELS],
  );

  const inFreeSpins = phase === 'fs-intro' || phase === 'fs' || phase === 'fs-total';

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => {
        if (!alive) return;
        const current = minor(result.balance);
        setBalance(current);
        setBet(suggestedBet(current, MIN_BET, MAX_BET));
      })
      .catch(() => setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api]);

  const options = useMemo(() => betOptions(balance, MIN_BET, MAX_BET), [balance]);

  const settlement = round?.settlement;
  const slots = round?.state as SlotsState | undefined;
  /**
   * The lines that paid on whatever spin is currently on screen.
   *
   * Every one of them, in the order the engine evaluated them. The old version
   * of this kept only `line < 3` — a leftover from treating the payline index
   * as a row index — which silently discarded every zig-zag win. Those wins
   * were paid and were invisible, which is the worst combination: the balance
   * moved and the machine showed nothing to explain it.
   */
  const lineWins = useMemo(() => {
    if (spinning && phase !== 'fs' && phase !== 'fs-total') return [];
    if (!slots) return [];
    // During the bonus round the highlight follows whichever free spin is on
    // screen, not the base spin that triggered it.
    const source =
      phase === 'fs' || phase === 'fs-total'
        ? (slots.freeSpins[freeSpinIndex] ?? slots.baseSpin)
        : slots.baseSpin;
    return source.lineWins.filter((win) => (win.cells?.length ?? 0) > 0);
  }, [slots, spinning, phase, freeSpinIndex]);

  /**
   * Total first, then walk the lines one at a time, then loop.
   *
   * Held while the reels are still, which is also when the player is reading.
   */
  const winPhase = useWinCycle(lineWins, !spinning);
  const lit = useMemo(() => litCells(lineWins, winPhase), [lineWins, winPhase]);

  /**
   * The reels are laid out with `flex: 1`, so their width is whatever the
   * phone gives them. The overlay needs the real number to put the line
   * through the middle of the symbols rather than near it.
   */
  const [reelsWidth, setReelsWidth] = useState(0);

  /**
   * The machine shrinks on a short screen.
   *
   * A phone held sideways leaves roughly 200 points of height once Safari's
   * chrome and the tab bar are taken out. Three rows of 58-point symbols plus a
   * readout, the bet chips and a spin button need more than twice that, so the
   * machine ran off the bottom and the game was unplayable in landscape — the
   * player could see one row of symbols and no button.
   *
   * Scaling the symbols is the fix rather than scrolling, because a slot is one
   * object: the reels and the button that turns them have to be on screen
   * together, or every spin is two gestures and a guess.
   */
  const compact = useCompactLayout();
  const { height: viewportHeight } = useWindowDimensions();
  const symbolSize = useMemo(() => {
    // Everything above and below the reels: header, readout, chips, button and
    // tab bar. Taken from the portrait layout rather than guessed.
    // MEASURED. In portrait the header, readout, chips and spin button sit
    // above and below the reels and come to about 300.
    //
    // In landscape the chips and button move BESIDE the machine, so only the
    // navigation header, the card padding and the readout are spending height
    // — about 120. That is the whole reason for the side-by-side layout: at 258
    // the symbols had to shrink to 20 points to fit, which was playable and
    // did not look like a slot machine.
    // MEASURED against the built screen, not guessed. The old 300 left the
    // machine occupying about a fifth of a 900-point phone with dead space
    // above and below it — a slot cabinet is the screen, not a widget on it.
    const chrome = compact ? COMPACT_CHROME : PORTRAIT_CHROME;
    /*
     * Budgeted against the SHORTEST cell the machine could use, not the one it
     * will actually use.
     *
     * Symbols are square and sized off the cell's width, so dividing the height
     * budget by a tall aspect shrinks the symbol to make room for space it does
     * not need. Using the floor means height only ever binds on a genuinely
     * short screen; on a phone held upright width binds, which is the truth of
     * the geometry — five reels across 390 points is what fixes a symbol at
     * about 72, and no amount of spare height changes that.
     */
    const byHeight = Math.floor(
      (viewportHeight - chrome - (compact ? 0 : GLASS_RESERVE)) / (MAX_ROWS * MIN_ROW_ASPECT),
    );

    /*
     * WIDTH MATTERS AS MUCH AS HEIGHT, and used not to count at all.
     *
     * Reels are laid out with `flex: 1`, so a three-reel machine's reels are
     * nearly twice as wide as a five-reel one's. Sizing on height alone put a
     * 58-point symbol in the middle of a 108-point-wide cell with empty space
     * either side, and every machine in the catalogue came out at exactly 58
     * because the old cap swallowed the height calculation whole — which is
     * precisely why they all looked the same size.
     *
     * Taking the smaller of the two means the grid decides the scale: three
     * reels give big chunky symbols, five give medium, and the 3-4-5-4-3
     * diamond gives smaller ones because it has nineteen cells to fit.
     */
    const byWidth =
      reelsWidth > 0
        ? Math.floor((reelsWidth - REEL_GAP * (REELS - 1)) / REELS)
        : byHeight;

    // Never so small the artwork stops reading — below about 26 points a
    // symbol is a coloured smudge — and never so large it stops fitting.
    return Math.max(26, Math.min(MAX_SYMBOL_SIZE, Math.min(byHeight, byWidth)));
  }, [viewportHeight, MAX_ROWS, compact, reelsWidth, REELS]);

  /**
   * How tall a cell is against how wide it is.
   *
   * Symbols are square but CELLS need not be, and on a phone held upright they
   * must not be. Real cabinets have slightly taller-than-wide cells: the
   * artwork stays square and centred and the reel gains a little breathing
   * room above and below it, which is what stops three rows reading as one
   * dense block.
   *
   * A LITTLE. Clamped hard, because this is the knob that was over-turned the
   * last time: every point of aspect above 1 is empty space around a symbol
   * that is already as large as the width allows, and past about a third the
   * grid stops being a grid.
   */
  const cellHeight = useMemo(() => {
    const want = cabinet.rowAspect ?? DEFAULT_ROW_ASPECT;
    const aspect = Math.min(MAX_ROW_ASPECT, Math.max(MIN_ROW_ASPECT, want));
    /*
     * Air is the FIRST thing given up when the screen runs out.
     *
     * A cabinet may ask for a third again of its symbol in height, but only out
     * of height that exists. Ocean Drift's five-row diamond asked for 1.3 and
     * got a 470-point reel window on a phone that had 370 to give, which pushed
     * the console off the bottom — a machine you cannot spin. Clamping here
     * rather than refusing the request means the tall grids simply sit tighter,
     * which is what a real cabinet does with a big grid anyway.
     */
    const room = Math.floor(
      (viewportHeight - (compact ? COMPACT_CHROME : PORTRAIT_CHROME) - (compact ? 0 : GLASS_RESERVE)) /
        MAX_ROWS,
    );
    return Math.max(symbolSize, Math.min(Math.round(symbolSize * aspect), room));
  }, [symbolSize, cabinet.rowAspect, viewportHeight, compact, MAX_ROWS]);

  /**
   * What is left of the screen once the reels and the controls are paid for.
   *
   * This is the height the machine used to leave as black space above and
   * below itself, and then — worse — as empty space inside its own cells. It
   * goes to the top glass, which is where a cabinet keeps its spare height.
   */
  /**
   * The wheel's face, from the model the server is actually using.
   *
   * Not a hardcoded list: the winning SEGMENT INDEX comes from the server, so a
   * client drawing a different set of segments would stop the pointer on a
   * number the player was not paid. Falls back to the shipped face only if the
   * paytable has not loaded yet, and the wheel cannot be reached before it has.
   */
  const wheelSegments = useMemo(() => {
    const spec = paytable?.feature;
    return spec?.kind === 'wheel' ? spec.segments : [2, 5, 10, 3, 20, 5, 50, 3];
  }, [paytable]);

  /**
   * The wheel's own spec, or nothing.
   *
   * Present only on games whose model actually has a wheel, so the meter beside
   * the reels appears on Triple Bar and Fruit Stand and on no other machine.
   */
  const bonusSpec = useMemo((): { reward: BonusReward; trigger: number } | null => {
    if (!paytable) return null;

    // A wheel, if this machine has one. Checked first because a game can have
    // both, and the wheel is the more striking of the two to advertise.
    const spec = paytable.feature;
    if (spec?.kind === 'wheel') {
      // The paytable the app is served does not carry the trigger count, and
      // three is the rule for every wheel in the catalogue. Hard-coded here
      // rather than guessed per game: if a two-scatter wheel is ever added,
      // this is the line that has to change, and the meter would visibly be
      // wrong until it did.
      return { reward: { kind: 'wheel', segments: spec.segments }, trigger: 3 };
    }

    /*
     * Otherwise free spins, which is the bonus on most of the catalogue and
     * was completely invisible until now — measured at one round in 95 to 187
     * spins, a player could reasonably conclude the game had none. Games with
     * neither (the three-reel classics, and the tumbler whose cascade IS the
     * feature) return null and get no panel, which is honest: an empty meter
     * would advertise something that is never coming.
     */
    const scatter = scatterTrigger(paytable);
    if (scatter) {
      return {
        reward: {
          kind: 'free-spins',
          spins: scatter.spins,
          multiplier: paytable.freeSpinMultiplier,
        },
        trigger: scatter.count,
      };
    }
    return null;
  }, [paytable]);

  const glassHeight = useMemo(() => {
    if (compact) return 0;
    // Cannot come out negative: `cellHeight` is clamped against this same
    // budget, and GLASS_RESERVE was taken out of it before the reels were
    // sized. The floor is belt and braces for an unusually short viewport.
    const spare = viewportHeight - PORTRAIT_CHROME - cellHeight * MAX_ROWS;
    return Math.round(Math.max(0, Math.min(MAX_GLASS, spare)));
  }, [compact, viewportHeight, cellHeight, MAX_ROWS]);

  /**
   * The bonus-round re-theme.
   *
   * Free spins are the only part of a slot where the rules are different —
   * every win multiplied, spins that cost nothing — so the machine has to say
   * which mode it is in without the player reading anything. The whole cabinet
   * changes colour, derived from this game's own theme rather than one
   * hardcoded red, so Dragon's Hoard goes deep red and Frost Peak goes glacial.
   *
   * Crossfaded rather than switched. A hard cut looks like a rendering fault;
   * the fade reads as the machine changing gear, and it is slow enough to be
   * noticed at a glance and fast enough not to delay the first free spin.
   */
  const bonusPalette = useMemo(
    () => (details ? bonusCabinet(details.theme) : BASE_CABINET),
    [details],
  );
  const bonusMix = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(bonusMix, {
      toValue: inFreeSpins ? 1 : 0,
      duration: 520,
      // Colours cannot be driven natively; this has to run on the JS thread.
      useNativeDriver: false,
    }).start();
  }, [inFreeSpins, bonusMix]);

  const fade = (from: string, to: string) =>
    bonusMix.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const cabinetStyle = {
    backgroundColor: fade(BASE_CABINET.background, bonusPalette.background),
    borderColor: fade(BASE_CABINET.border, bonusPalette.border),
    shadowColor: bonusPalette.glow,
  };
  const bayStyle = { backgroundColor: fade(BASE_CABINET.bay, bonusPalette.bay) };

  const spin = useCallback(async () => {
    if (spinning) return;
    if (bet > balance) {
      setError('Not enough coins for that bet');
      return;
    }

    // Must happen inside the tap: iOS refuses to start audio otherwise.
    unlock();
    sounds.spinStart();

    const token = ++spinToken.current;
    setError(null);
    setRound(null);
    // On the same clock the reels and the stop sounds use, so the floor below
    // is measured against the moment the reels actually started turning.
    const startedTurningAt = spinNow();
    setReelPhase('spinning');
    setPhase('base');
    setRunningWin(0);
    runningWinRef.current = 0;
    setFreeSpinsTotal(0);
    setCascadeStep(0);
    setCelebration({ tier: 'none', amount: 0, round: celebrationRound.current });
    setReelRound((n) => n + 1);

    // Optimistic debit so the balance reacts on the tap rather than after the
    // round trip. The server's authoritative figure overwrites it below.
    setBalance((current) => minor(current - bet));

    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const superseded = () => token !== spinToken.current;

    /**
     * Show a grid on the reels and resolve when the last reel physically stops.
     *
     * This replaces a `wait(reelSpin + stagger * (REELS - 1))`, which was wrong
     * in a way that was audible: the timer started when the network replied,
     * but the reels started on the tap. Every spin was out of step by the
     * round-trip time, and that time is different every spin.
     */
    const landReels = (next: string[][], speedScale: number, drop = false) =>
      new Promise<void>((resolve) => {
        landingResolver.current = resolve;

        // Book the entire landing before any of it happens.
        //
        // A small lead-in gives the audio thread time to receive the schedule;
        // without it the first stop can be requested for a moment that has
        // already passed and fires late.
        const t0 = spinNow() + LEAD_IN_SECONDS;
        /*
         * A tumble is not a spin and must not be staggered like one.
         *
         * Reels stop one after another because they are separate physical
         * reels decelerating. Symbols falling into the gaps a win left behind
         * are one event on one grid: staggering them would say the reels had
         * turned again, which is the opposite of what a cascade means. So
         * every reel drops together, over a short distance, and none of the
         * anticipation machinery runs.
         */
        const anticipate = drop
          ? Array.from({ length: REELS }, () => false)
          : anticipatingReels(next, scatterTriggerCount);
        if (drop) {
          setAnticipating(anticipate);
          setSchedule(
            Array.from({ length: REELS }, () => ({ from: t0, duration: CASCADE_DROP_SECONDS })),
          );
          setGrid(next);
          setReelRound((n) => n + 1);
          setReelPhase('landing');
          sounds.reelStopAt(0, t0 + CASCADE_DROP_SECONDS);
          return;
        }

        // Each anticipating reel adds to every reel after it, so the delay
        // accumulates and the machine visibly slows the closer it gets. A flat
        // extra on each would keep the gaps identical, which is a pause rather
        // than a build.
        let held = 0;
        const plan = Array.from({ length: REELS }, (_, i) => {
          if (anticipate[i]) held += ANTICIPATION_SECONDS;
          const base = (BASE_LAND_SECONDS + i * STAGGER_SECONDS) * speedScale;
          return { from: t0, duration: base + held };
        });

        for (const [i, reel] of plan.entries()) {
          sounds.reelStopAt(i, reel.from + reel.duration);
          // The rising tone runs through the gap this reel's hold created,
          // from the moment the previous reel stopped until this one does.
          if (anticipate[i] && i > 0) {
            const previous = plan[i - 1]!;
            const from = previous.from + previous.duration;
            sounds.tensionAt(from, reel.from + reel.duration - from);
          }
        }

        setAnticipating(anticipate);
        setSchedule(plan);
        setGrid(next);
        setReelRound((n) => n + 1);
        setReelPhase('landing');
      });

    try {
      const result = await api.placeBet({
        gameId,
        stake: bet,
        // Unique per attempt, so a retry after a timeout is recognised as the
        // same bet rather than charged again.
        idempotencyKey: `${Date.now()}-${token}`,
      });
      if (superseded()) return;

      // Let the reels finish getting up to speed before asking them to stop.
      // See MIN_LOOP_SECONDS: on a fast connection the answer arrives while
      // they are still accelerating.
      const spentSoFar = spinNow() - startedTurningAt;
      if (spentSoFar < MIN_LOOP_SECONDS) {
        await wait((MIN_LOOP_SECONDS - spentSoFar) * 1000);
        if (superseded()) return;
      }

      const state = result.state as SlotsState;
      const spinWin = (multiplier: number) => Math.floor(bet * multiplier);

      // The reels have been looping since the tap. Land them on the real result
      // and wait for the last one to physically stop.
      await landReels(state.baseSpin.grid, 1);
      if (superseded()) return;

      setReelPhase('idle');
      setRound(result);

      /*
       * The tumbles, one at a time.
       *
       * The server settled the whole chain in the same request, so this is
       * presentation — but it is presentation the player is owed. A cascade
       * shown only in its final state is a large win with no explanation, and
       * the escalating ladder that makes a chain worth watching becomes
       * invisible. Worse, the money would already be in the balance: the
       * machine would pay for four drops and show one.
       *
       * The running total climbs as each drop lands, so the number on screen
       * and the number in the balance are the same number at every moment.
       */
      const drops = state.baseSpin.cascades ?? [];
      let stepTotal = spinWin(state.baseSpin.totalMultiplier - dropSum(drops));
      setRunningWin(stepTotal);
      runningWinRef.current = stepTotal;

      for (const step of drops) {
        // Hold on the win first. The symbols about to vanish are the ones the
        // player is being told paid, and clearing them immediately means they
        // were never really shown.
        await wait(CASCADE_HOLD_MS);
        if (superseded()) return;

        setCascadeStep(step.stepMultiplier);
        // Symbols clearing. One per drop, so a chain reads as a chain.
        sounds.cascade();
        await landReels(step.grid, 1, true);
        if (superseded()) return;
        setReelPhase('idle');

        stepTotal += spinWin(step.totalMultiplier);
        setRunningWin(stepTotal);
        runningWinRef.current = stepTotal;
        sounds.coins(3);
      }
      setCascadeStep(0);

      /*
       * The scatter moment.
       *
       * Announced when the grid has landed rather than per reel: the engine
       * reports a count for the whole spin, and inventing a per-reel timing the
       * server never sent would be a sound describing something that did not
       * happen.
       *
       * Two scatters with no third is a NEAR MISS, and it gets its own quiet
       * marker. Quiet on purpose — a near miss is a loss, and a machine that
       * celebrates one is telling the player something untrue.
       */
      const scatters = state.baseSpin.scatterCount;
      if (scatters >= 3) sounds.scatter();
      else if (scatters === 2) sounds.nearMiss();

      const baseWin = spinWin(state.baseSpin.totalMultiplier);
      celebrate(baseWin, bet);

      /*
       * The feature round, if this machine has one and it fired.
       *
       * Played BEFORE the free-spin branch and never alongside it: the engine's
       * `resolveRound` awards one or the other, never both, and a presentation
       * that could show both would be describing a round the server does not
       * deal.
       *
       * Awaited on a promise the component resolves rather than on a fixed
       * timeout, because a hold-and-spin round has no fixed length — that is
       * the entire point of it.
       */
      if (state.feature) {
        setFeature(state.feature);
        sounds.bonus();
        setPhase('feature');
        await new Promise<void>((resolve) => {
          featureDone.current = resolve;
        });
        if (superseded()) return;
        setPhase('base');
        setFeature(null);

        const featureWin = spinWin(state.feature.multiplier);
        runningWinRef.current += featureWin;
        setRunningWin(runningWinRef.current);
        celebrate(featureWin, bet);
        await wait(1_200);
        if (superseded()) return;
      }

      if (state.freeSpinsAwarded > 0) {
        setFreeSpinsTotal(state.freeSpinsAwarded);
        sounds.bonus();
        setPhase('fs-intro');
        await wait(1_800);
        if (superseded()) return;

        setPhase('fs');
        for (let i = 0; i < state.freeSpins.length; i++) {
          const spinResult = state.freeSpins[i]!;
          setFreeSpinIndex(i);

          // A short loop before each landing, so a free spin still reads as a
          // spin. The results are already decided — this is presentation.
          //
          // Long enough for the shortened spin-up below to complete: a free
          // spin that starts landing mid-ramp has the same velocity step as a
          // base spin would, and there are a dozen of them in a row to notice
          // it in.
          setReelPhase('spinning');
          sounds.spinStart();
          await wait(SPIN_UP_SECONDS * FS_SPEED * 1000 + 90);
          if (superseded()) return;

          // Free spins land faster: the tension that earns a slow base spin is
          // already spent, and a dozen full-length spins is a minute of waiting.
          await landReels(spinResult.grid, FS_SPEED);
          if (superseded()) return;

          setReelPhase('idle');
          const freeWin = spinWin(spinResult.totalMultiplier);
          runningWinRef.current += freeWin;
          setRunningWin(runningWinRef.current);
          celebrate(freeWin, bet);
          await wait(500);
          if (superseded()) return;
        }

        setPhase('fs-total');
        celebrate(runningWinRef.current, bet);
        await wait(2_600);
        if (superseded()) return;
      }

      // The balance from the server already includes every free spin, so it is
      // applied once, at the end — otherwise it would jump before the show did.
      setBalance(minor(result.balance));
      // And to every other screen, so the lobby header is not still showing the
      // figure it loaded when the player walked in. See publishBalance.
      publishBalance(minor(result.balance));
      setPhase('idle');
      setReelPhase('idle');
    } catch (caught) {
      if (superseded()) return;
      setReelPhase('idle');
      setPhase('idle');
      sounds.error();
      // The optimistic debit never happened as far as the server is concerned.
      setBalance((current) => minor(current + bet));
      setError(
        caught instanceof PlayApiError ? caught.message : 'Something went wrong. Try again.',
      );
    }
  }, [api, balance, bet, spinning, celebrate]);

  /**
   * Auto-spin: keep going until the player stops it or the money does.
   *
   * Driven from an effect keyed on `spinning` rather than by chaining the next
   * spin onto the end of the last one, so pressing STOP takes effect at the
   * end of the round in flight instead of being swallowed by a promise that
   * was already going to fire. A short beat between rounds keeps it readable
   * as a sequence of spins rather than one continuous blur.
   *
   * It stops itself when the next bet is no longer affordable. An auto-spin
   * that silently does nothing while the player watches is worse than one that
   * visibly ends.
   */
  useEffect(() => {
    if (!auto || spinning) return;
    if (bet > balance) {
      setAuto(false);
      return;
    }
    const timer = setTimeout(() => { void spin(); }, autoDelay);
    return () => clearTimeout(timer);
  }, [auto, spinning, bet, balance, spin, autoDelay]);

  return (
    <View style={styles.screen}>
      {showRules && details && paytable ? (
        <RulesIntro game={details} model={paytable} onPlay={() => setShowRules(false)} />
      ) : null}
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
        </View>
        {/*
          Not a <Badge>: Badge renders dark text for a light chip, which on a
          dark chip is unreadable. This is a muted informational pill instead.
        */}
        <View style={styles.rtpPill}>
          <Txt variant="caption" color={colors.text.secondary}>
            RTP {((details?.rtp ?? 0.96) * 100).toFixed(2)}%
          </Txt>
        </View>
        {/*
          Small and beside the machine rather than a screen of its own. A player
          wanting to know what a bell pays wants it without leaving the game;
          a player who does not should barely notice it is there.
        */}
        {details && paytable ? <PaytableButton game={details} model={paytable} /> : null}
        {/*
          Music and effects, right here in the header.
          
          The moment a player wants the sound off is during a spin, not on a
          settings screen two taps away — and a mute they cannot find is a mute
          they satisfy by silencing the whole browser tab, which turns off every
          sound in the product permanently. Compact, so it costs two icons of
          width and no height.
        */}
        <SoundToggles compact />
      </View>

      {/*
        Side by side when height is scarce.

        A phone in landscape has width to spare and almost no height, so
        stacking the controls under the machine spends the one scarce dimension
        on the one that is abundant. Putting them beside it hands the full
        height back to the reels — symbols go from 20 points to over 60, which
        is the difference between "playable" and "looks like a slot machine".
      */}
      <View style={compact ? styles.landscapeRow : undefined}>
      <Card style={[styles.machine, compact && styles.machineCompact, cabinetStyle]}>
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
        {/*
          The room, the surround, and the lever.

          The background images have been in the repository referenced by
          nothing at all. They are deliberately dark and low-contrast, which is
          what lets a symbol read on top of one — so they work as a room the
          machine stands in rather than as a picture competing with the game.
        */}
        <View style={styles.machineRow}>
        <ReelFrame style={cabinet.frame}>
        {/* The lit sign above the reels, cast in this game's own material. */}
        {glassHeight >= MIN_GLASS && details ? (
          <CabinetGlass name={details.name} material={material} height={glassHeight} />
        ) : null}
        <Animated.View style={[styles.reelBay, compact && styles.reelBayCompact, bayStyle]}>
        {room ? (
          <>
            <Image
              source={{ uri: room }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityElementsHidden
            />
            {/* The room has to stay a room. A tile was drawn to be looked at,
                so at full strength it competes with the symbols in front of
                it — this holds it back to a setting. */}
            <View style={styles.roomScrim} pointerEvents="none" />
          </>
        ) : null}
        <View
          style={[styles.reels, styles.reelsFill]}
          onLayout={(e) => setReelsWidth(e.nativeEvent.layout.width)}
        >
          {Array.from({ length: REELS }, (_, i) => (
            <Reel
              key={i}
              index={i}
              rows={ROWS[i] ?? 3}
              phase={reelPhase}
              round={reelRound}
              landFrom={schedule[i]?.from ?? 0}
              landDuration={schedule[i]?.duration ?? 1}
              result={grid[i] ?? IDLE_GRID[i]!}
              litCells={lit}
              size={symbolSize}
              cellHeight={cellHeight}
              // How much of the cell the artwork takes. Art direction rather
              // than arithmetic — see `symbolFill` in api/cabinets.
              fill={cabinet.symbolFill ?? DEFAULT_SYMBOL_FILL}
              {...(cascadeStep > 0 ? { travel: CASCADE_TRAVEL } : {})}
              // Free spins run at roughly half length all through, and a
              // spin-up left at its base duration would be most of one.
              spinUp={inFreeSpins ? SPIN_UP_SECONDS * FS_SPEED : SPIN_UP_SECONDS}
              anticipating={anticipating[i] ?? false}
              {...(details?.art ? { family: details.art } : {})}
              gameId={gameId}
              tint={symbolTint}
              material={material}
              // Dimming needs something to contrast AGAINST. A scatter win
              // pays from anywhere on the grid and produces no winning line,
              // so dimming on payout alone turned the whole machine dark and
              // highlighted nothing.
              //
              // It also has to follow the WALK rather than the celebration:
              // the celebration ends after a couple of seconds, but the line
              // cycle keeps running until the next spin, and a lit line on an
              // undimmed grid is barely a highlight at all.
              celebrating={lit.size > 0}
              // Stops the pulse and the shine once the walk has finished,
              // without un-marking what won.
              settled={winPhase.kind === 'settled'}
              onLanded={() => handleReelLanded(i)}
            />
          ))}
          {/* Above the symbols, below anything pressable. */}
          <WinLines
            wins={lineWins}
            reels={REELS}
            phase={winPhase}
            width={reelsWidth}
            cellHeight={cellHeight}
            rows={ROWS}
            ways={details?.pays === 'ways'}
            gameId={gameId}
            {...(details?.art ? { family: details.art } : {})}
          />
        </View>

        {/*
          The feature round, over the reels it was won on.
          Covers the bay rather than replacing the screen, so the machine is
          still visibly the machine you triggered it from.
        */}
        {phase === 'feature' && feature?.kind === 'hold-spin' ? (
          <HoldSpinRound
            seed={feature.seed}
            steps={feature.steps}
            full={feature.full}
            rows={ROWS}
            stake={bet}
            onDone={() => {
              featureDone.current?.();
              featureDone.current = null;
            }}
          />
        ) : null}
        {phase === 'feature' && feature?.kind === 'wheel' ? (
          <PrizeWheel
            segments={wheelSegments}
            index={feature.index}
            onDone={() => {
              featureDone.current?.();
              featureDone.current = null;
            }}
          />
        ) : null}

        {/* Coins are thrown from the centre of the reels, above the symbols
            but below anything a player can press. */}
        <CoinBurst tier={celebration.tier} round={celebration.round} />
        </Animated.View>
        </ReelFrame>
        {/* The handle sits beside the reels, at their height, so pulling it
            reads as working the machine rather than pressing a control. */}
        {cabinet.controls === 'lever' ? (
          <SpinLever
            onSpin={spin}
            spinning={spinning}
            disabled={bet > balance}
            height={cellHeight * MAX_ROWS}
          />
        ) : null}
        {/*
          The bonus, named and visible from the first second.
          
          Without it the bonus is invisible until it fires — measured at once
          in 53 spins on the wheel games and once in 95 to 187 on the rest — so
          a player's first session contains no evidence that the game has one
          at all. See BonusMeter.
        */}
        {bonusSpec ? (
          <BonusMeter
            reward={bonusSpec.reward}
            trigger={bonusSpec.trigger}
            scatters={visibleScatters}
            active={phase === 'feature' || phase === 'fs' || phase === 'fs-intro'}
            {...(details?.art ? { family: details.art } : {})}
          />
        ) : null}
        </View>
        </Animated.View>

        <View
          style={[styles.readout, compact && styles.readoutCompact]}
          accessibilityLiveRegion="polite"
        >
          {cascadeStep > 0 ? (
            /*
             * The rung, while a chain is running.
             *
             * Takes priority over everything else in the readout because it is
             * the only thing on screen that explains why the same symbols are
             * suddenly worth more, and it is on screen for well under a second
             * at a time.
             */
            <View style={styles.fsRow}>
              <Txt variant="bodySmall" color={colors.neon.cyan}>
                TUMBLE · {cascadeStep}× WINS
              </Txt>
              <Txt variant="money" color={colors.feedback.winBright}>
                {format(minor(runningWin), 'GC')}
              </Txt>
            </View>
          ) : phase === 'fs-intro' ? (
            <Txt variant="h3" color={colors.neon.magenta}>
              {freeSpinsTotal} FREE SPINS
            </Txt>
          ) : phase === 'fs' ? (
            <View style={styles.fsRow}>
              <Txt variant="bodySmall" color={colors.neon.magenta}>
                FREE SPIN {freeSpinIndex + 1} of {freeSpinsTotal} · 3× WINS
              </Txt>
              <Txt variant="money" color={colors.feedback.winBright}>
                {format(minor(runningWin), 'GC')}
              </Txt>
            </View>
          ) : phase === 'fs-total' ? (
            <Txt variant="h3" color={colors.feedback.winBright}>
              BONUS TOTAL {format(minor(runningWin), 'GC')}
            </Txt>
          ) : spinning ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Spinning…
            </Txt>
          ) : error ? (
            <Txt variant="bodySmall" color={colors.feedback.error}>
              {error}
            </Txt>
          ) : settlement && settlement.payout > 0 ? (
            // While the overlay is up it owns the figure. Two counters rolling
            // to the same total at slightly different rates reads as a bug.
            <View
              style={[
                styles.winRow,
                (celebration.tier === 'big' || celebration.tier === 'mega') && styles.hidden,
              ]}
            >
              <Txt variant="caption" color={colors.text.muted}>
                WIN
              </Txt>
              <CoinCounter
                amount={settlement.payout}
                tier={celebration.tier}
                color={colors.feedback.winBright}
                variant="money"
              />
            </View>
          ) : settlement ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              No win — spin again
            </Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              {/* Say which control this machine is played with. A lever game
                  that tells you to "spin" is describing a button it does not
                  have — and a player who cannot find the control does not have
                  a game. */}
              {cabinet.controls === 'lever'
                ? 'Pick a bet, then pull the lever'
                : 'Pick a bet and spin'}
            </Txt>
          )}
        </View>
        {/*
          Dragon's Hoard, and only Dragon's Hoard.
          
          Every other machine celebrates with the shared coin fountain, on
          purpose. This one has a creature on its lobby tile and now shows it
          when it pays — the test of whether a per-game celebration earns the
          art it costs. It sits UNDER the win overlay so the banner and the
          rolling counter stay readable over it.
        */}
        <DragonRoar
          round={celebration.round}
          active={gameId === DRAGON_GAME_ID && (celebration.tier === 'big' || celebration.tier === 'mega')}
          size={Math.min(300, cellHeight * 3)}
        />
        <WinOverlay
          tier={celebration.tier}
          amount={celebration.amount}
          round={celebration.round}
          onDone={() => setCelebration((c) => ({ ...c, tier: 'none' }))}
        />
      </Card>

      <View style={compact ? styles.controlsColumn : undefined}>
        {/*
          The cabinet's own controls.

          Which cluster a game gets is data — see api/cabinets. The lever games
          keep the console for the bet and the balance but spin from the handle
          beside the reels, because a lever with no way to change your stake is
          a museum piece rather than a machine.
        */}
        <SlotConsole
          bet={bet}
          balance={balance}
          win={runningWin}
          options={options}
          onBet={setBet}
          onSpin={spin}
          spinning={spinning}
          auto={auto}
          onToggleAuto={() => setAuto((on) => !on)}
          compact={compact}
          {...(cabinet.controls === 'lever' ? { hideSpin: true } : {})}
        />
      </View>
      </View>

      <Txt variant="caption" color={colors.text.muted} style={styles.fairness}>
        {USE_DEMO_API
          ? '⚠️ Demo mode — outcomes are generated on-device and are not the real game.'
          : round
            ? `Fair: ${round.fairness.serverSeedHash.slice(0, 16)}… · nonce ${round.fairness.nonce}`
            : 'Every result is provably fair.'}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.base,
    /*
     * Tight vertically, roomy horizontally.
     *
     * Three 16-point gaps and 32 points of vertical padding is 80 points of
     * black — a tenth of a phone — spent separating a cabinet from nothing. The
     * horizontal padding stays because the balance strip and the fairness line
     * need it; the machine cancels it for itself with a negative margin.
     */
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  machineCompact: { gap: spacing.xs, padding: spacing.sm, flex: 1 },
  landscapeRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  // Wide enough for "10,000 GC" on a chip without wrapping to three lines.
  controlsColumn: { width: 190, gap: spacing.sm, justifyContent: 'center' },
  machine: {
    gap: spacing.sm,
    /*
     * EDGE TO EDGE.
     *
     * The screen pads itself by 16 a side and the card added 8 more, so a
     * five-reel machine lost 48 points of width — most of a symbol — to
     * margins around a cabinet that is supposed to BE the screen. The negative
     * margin cancels the screen's padding for this one card, because the reels
     * are the content and nothing else on the page competes with them.
     */
    marginHorizontal: -spacing.lg,
    padding: 2,
    overflow: 'hidden',
    borderColor: colors.gold.dark,
    borderWidth: 2,
    backgroundColor: '#0B1330',
  },
  /**
   * The reel bay is recessed: darker than the cabinet, with a gold inner rule.
   * A slot machine's reels sit BEHIND glass, and that inset is most of what
   * separates a machine from five rectangles in a row.
   */
  reelBay: {
    backgroundColor: '#05091A',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.gold.dark,
    // Width is the scarce dimension on a phone: five reels across 390 points
    // means every point spent on padding comes straight off the symbols. This
    // was 8 on each side plus a 4-point gap between every reel, which together
    // took a fifth of the machine's width before a symbol was drawn.
    padding: 3,
  },
  fsRow: { alignItems: 'center', gap: 2 },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hidden: { opacity: 0 },
  /**
   * `center` rather than the default stretch, so a ragged machine reads as a
   * diamond rather than as five columns hanging from a shelf. On a rectangular
   * game it changes nothing at all.
   */
  reels: { flexDirection: 'row', gap: REEL_GAP, alignItems: 'center' },
  readout: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  readoutCompact: { minHeight: 18 },
  // Still above the 44-point touch minimum; only the generous padding goes.
  spinCompact: { paddingVertical: spacing.xs, minHeight: 44 },
  reelBayCompact: { padding: spacing.xs },
  /** The machine and its lever, side by side. */
  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // The reels must claim the full width of the bay. Without this they are
  // sized by their content and the machine collapses into the corner.
  reelsFill: { width: '100%' },
  /*
   * The room has to stay a room, but it also has to be VISIBLE.
   *
   * At 0.62 over artwork that was already painted dark, every game's room came
   * out as the same black rectangle — which meant the twenty-three distinct
   * backdrops the cabinet work was built around were, on screen, not there at
   * all. Pulled back to 0.42, and that overshot: Neon Alley's tile has a giant
   * 777 across the middle of it, and at that strength it competed with the
   * symbols rather than sitting behind them. This is the value where the room
   * is legible as a room and loses every argument with a symbol.
   */
  roomScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4, 6, 16, 0.58)' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    minWidth: 64,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  chipDisabled: { opacity: 0.35 },
  spin: { minHeight: 56 },
  fairness: { textAlign: 'center' },
});
