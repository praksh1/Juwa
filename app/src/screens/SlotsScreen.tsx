import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { BASE_CABINET, anticipatingReels, bonusCabinet, colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Button, Card, Txt } from '../components/primitives';
import { useRoute } from '@react-navigation/native';
import { Reel, type ReelPhase } from '../components/Reel';
import { scatterTrigger, slotDetails, slotPaytable } from '../api/games';
import { sounds, spinNow, unlock } from '../sound';
import { winTier, rollUpDuration, type WinTier } from '../motion';
import { CoinCounter } from '../components/CoinCounter';
import { CoinBurst } from '../components/CoinBurst';
import {
  PaytableButton,
  RulesIntro,
  rulesDismissed,
} from '../components/GameRules';
import { WinLines, litCells, useWinCycle } from '../components/WinLines';
import { WinOverlay, useCabinetShake } from '../components/WinOverlay';
import {
  PlayApiError,
  createPlayApi,
  type PlayApi,
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


/** What the machine shows before the first spin. */
function idleGrid(reels: number, rows: number): string[][] {
  const column = ['CHERRY', 'BAR', 'LEMON'].slice(0, rows);
  return Array.from({ length: reels }, () => [...column]);
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
  const ROWS = details?.rows ?? 3;
  const IDLE_GRID = useMemo(() => idleGrid(REELS, ROWS), [REELS, ROWS]);

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(2_000));
  const [reelPhase, setReelPhase] = useState<ReelPhase>('idle');
  const spinning = reelPhase !== 'idle';
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [grid, setGrid] = useState<string[][]>(() => idleGrid(REELS, ROWS));
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
    'idle' | 'base' | 'fs-intro' | 'fs' | 'fs-total'
  >('idle');
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
    setReelPhase('spinning');
    setPhase('base');
    setRunningWin(0);
    runningWinRef.current = 0;
    setFreeSpinsTotal(0);
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
    const landReels = (next: string[][], speedScale: number) =>
      new Promise<void>((resolve) => {
        landingResolver.current = resolve;

        // Book the entire landing before any of it happens.
        //
        // A small lead-in gives the audio thread time to receive the schedule;
        // without it the first stop can be requested for a moment that has
        // already passed and fires late.
        const t0 = spinNow() + LEAD_IN_SECONDS;
        const anticipate = anticipatingReels(next, scatterTriggerCount);

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

      const state = result.state as SlotsState;
      const spinWin = (multiplier: number) => Math.floor(bet * multiplier);

      // The reels have been looping since the tap. Land them on the real result
      // and wait for the last one to physically stop.
      await landReels(state.baseSpin.grid, 1);
      if (superseded()) return;

      setReelPhase('idle');
      setRound(result);
      const baseTotal = spinWin(state.baseSpin.totalMultiplier);
      setRunningWin(baseTotal);
      runningWinRef.current = baseTotal;

      const baseWin = spinWin(state.baseSpin.totalMultiplier);
      celebrate(baseWin, bet);

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
          setReelPhase('spinning');
          sounds.spinStart();
          await wait(260);
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
      </View>

      <Card style={[styles.machine, cabinetStyle]}>
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
        <Animated.View style={[styles.reelBay, bayStyle]}>
        <View
          style={styles.reels}
          onLayout={(e) => setReelsWidth(e.nativeEvent.layout.width)}
        >
          {Array.from({ length: REELS }, (_, i) => (
            <Reel
              key={i}
              index={i}
              rows={ROWS}
              phase={reelPhase}
              round={reelRound}
              landFrom={schedule[i]?.from ?? 0}
              landDuration={schedule[i]?.duration ?? 1}
              result={grid[i] ?? IDLE_GRID[i]!}
              litCells={lit}
              anticipating={anticipating[i] ?? false}
              {...(details?.art ? { family: details.art } : {})}
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
              onLanded={() => handleReelLanded(i)}
            />
          ))}
          {/* Above the symbols, below anything pressable. */}
          <WinLines wins={lineWins} reels={REELS} phase={winPhase} width={reelsWidth} />
        </View>

        {/* Coins are thrown from the centre of the reels, above the symbols
            but below anything a player can press. */}
        <CoinBurst tier={celebration.tier} round={celebration.round} />
        </Animated.View>
        </Animated.View>

        <View style={styles.readout} accessibilityLiveRegion="polite">
          {phase === 'fs-intro' ? (
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
              Pick a bet and spin
            </Txt>
          )}
        </View>
        <WinOverlay
          tier={celebration.tier}
          amount={celebration.amount}
          round={celebration.round}
          onDone={() => setCelebration((c) => ({ ...c, tier: 'none' }))}
        />
      </Card>

      <View style={styles.betRow}>
        {options.map((option) => {
          const active = option === bet;
          const affordable = option <= balance;
          return (
            <Pressable
              key={option}
              onPress={() => setBet(option)}
              disabled={spinning || !affordable}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !affordable }}
              style={[
                styles.chip,
                active && styles.chipActive,
                !affordable && styles.chipDisabled,
              ]}
            >
              <Txt
                variant="caption"
                color={active ? colors.text.inverse : colors.text.secondary}
              >
                {format(option, 'GC')}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <Button
        label={spinning ? 'Spinning…' : `Spin ${format(bet, 'GC')}`}
        onPress={spin}
        disabled={spinning || bet > balance}
        loading={spinning}
        style={styles.spin}
      />

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
    padding: spacing.lg,
    gap: spacing.lg,
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
  machine: {
    gap: spacing.md,
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
    padding: spacing.sm,
  },
  fsRow: { alignItems: 'center', gap: 2 },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hidden: { opacity: 0 },
  reels: { flexDirection: 'row', gap: spacing.xs },
  readout: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  betRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
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
