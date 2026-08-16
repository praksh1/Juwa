import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { publishBalance } from '../api/usePlayer';
import { Button, Card, Txt } from '../components/primitives';
import { SoundToggles } from '../components/SoundToggles';
import { playCue, playLoop, preloadSamples, sounds, spinNow, unlock, useSoundSet } from '../sound';
import { ROULETTE_SOUNDS } from '../api/sound-sets';
import { ROULETTE_BED, useAmbientBed } from '../ambience';
import { RouletteWheel, type WheelPhase } from '../components/RouletteWheel';
import { Fireworks, type FireworksHandle } from '../components/Fireworks';
import { usePrefersReducedMotion } from '../motion';
import { ROULETTE_GAME_ID } from '../api/games';
import {
  PlayApiError,
  createPlayApi,
  type PlayApi,
  type RoundResponse,
} from '../api/client';

const GAME_ID = ROULETTE_GAME_ID;
const MIN_BET = minor(50);
const MAX_BET = minor(500_000);

/**
 * European roulette.
 *
 * LAYOUT
 *
 * The felt is rotated: a real table is 3 rows by 12 columns, which on a phone
 * gives 30px-wide numbers nobody can reliably hit. Turning it 90 degrees — 12
 * rows of 3 — gives cells roughly 110 by 40, which is comfortably tappable.
 * Every mobile roulette app converges on this for the same reason.
 *
 * WHICH BETS
 *
 * Straight-up (tap a number) and all the outside bets: red/black, odd/even,
 * high/low, dozens and columns. The engine also supports splits, streets,
 * corners and lines — those are bets placed on the *lines between* numbers, and
 * they need precise touch targets on grid intersections. That is a felt with
 * pinch-zoom, which is its own piece of work; the bets here are what casual
 * players actually place.
 *
 * Nothing is decided here. The bets go to the server, which spins and settles.
 */

/** Mirrors the engine's wheel. Everything not here and not zero is black. */
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function colourOf(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

type BetType =
  | 'straight' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high'
  | 'dozen' | 'column';

interface Bet {
  type: BetType;
  selection: number[];
  amount: number;
}

/** How long the wheel takes to come to rest once it has its answer. */
const WHEEL_LAND_SECONDS = 3.4;
/**
 * Big enough that the painted numbers are readable on a phone, small enough
 * that the whole result — wheel, number, and the win line — clears the dock.
 *
 * The result is in a scrollable stage above the pinned controls, so the wheel
 * can be large enough to feel like a physical object without covering the
 * payout readout on a compact phone.
 */
const WHEEL_SIZE = 232;

/** Payout quoted as "X to 1"; the stake comes back on top. */
const ODDS: Record<BetType, number> = {
  straight: 35, dozen: 2, column: 2,
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
};

const CHIPS = [50, 100, 500, 1_000, 5_000];

/** Button (52) plus the dock's own padding. Reserved at the foot of the scroll. */
const DOCK_HEIGHT = 52 + 24;

/** Stable key so tapping the same spot twice stacks rather than duplicates. */
const keyOf = (type: BetType, selection: number[]) => `${type}:${selection.join(',')}`;

function describeBet(bet: Bet): string {
  switch (bet.type) {
    case 'straight': return `Number ${bet.selection[0]}`;
    case 'dozen': return ['1st 12', '2nd 12', '3rd 12'][bet.selection[0] ?? 0]!;
    case 'column': return `Column ${(bet.selection[0] ?? 0) + 1}`;
    case 'low': return '1–18';
    case 'high': return '19–36';
    default: return bet.type.charAt(0).toUpperCase() + bet.type.slice(1);
  }
}

export function RouletteScreen() {
  const api = useRef<PlayApi>(createPlayApi()).current;

  const [balance, setBalance] = useState(minor(0));
  const [chip, setChip] = useState(100);
  const [bets, setBets] = useState<Map<string, Bet>>(new Map());
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState<number | null>(null);
  const [round, setRound] = useState<RoundResponse | null>(null);
  /*
   * The table's own sounds.
   *
   * The four roulette recordings are the only files in the library that name a
   * specific game, and a ball rattling into a pocket under a slot reel would be
   * a sound from a different table — so they are wired here and nowhere else.
   * `spin` carries the wheel, `win` the winning number.
   */
  useEffect(() => {
    useSoundSet({ spin: ROULETTE_SOUNDS.wheel, win: ROULETTE_SOUNDS.win, big: ROULETTE_SOUNDS.win });
    /*
     * The ball's two recordings, fetched on arrival rather than on demand.
     *
     * `SoundSet` has no field for them — they belong to this table and to
     * nothing else — so they were being loaded lazily by the first `playLoop`
     * and `playCue` that wanted them. That made the FIRST spin of a session
     * the one spin with no ball on it, which is the spin a new player judges
     * the table by.
     */
    void preloadSamples([ROULETTE_SOUNDS.ball, ROULETTE_SOUNDS.drop]);
  }, []);

  /**
   * The room the table is in.
   *
   * The slots have had music since they were built and this screen had none —
   * so walking from a machine to the roulette table meant walking out of a
   * casino into a silent room, which is a bigger tonal drop than any single
   * missing effect. `bed-classic` is the right family: this is the oldest game
   * in the building.
   */
  useAmbientBed(ROULETTE_BED);


  const [error, setError] = useState<string | null>(null);
  /**
   * The wheel's own phase, and where it has been told to stop.
   *
   * Separate from `spinning` because the two end at different moments: the
   * request is finished long before the wheel is, and the result must not be
   * announced while the ball is still running. `spinning` gates the controls;
   * this drives the picture.
   */
  const [wheelPhase, setWheelPhase] = useState<WheelPhase>('idle');
  const [wheelTarget, setWheelTarget] = useState<number | null>(null);
  const [wheelPlan, setWheelPlan] = useState({ from: 0, duration: WHEEL_LAND_SECONDS });
  /** Gold coins and ribbons thrown only after the ball visibly lands. */
  const celebration = useRef<FireworksHandle | null>(null);
  const [celebrationStage, setCelebrationStage] = useState({ width: WHEEL_SIZE, height: 310 });
  /** Resolved by the wheel's own stop, so the readout can never run ahead. */
  const wheelStopped = useRef<(() => void) | null>(null);
  /**
   * Stops the looping ball rattle.
   *
   * In a ref because it is created in one branch of an async function and
   * called in two others — including the error path, where a spin that failed
   * must not leave a ball rolling round an idle wheel.
   */
  const stopRoll = useRef<(() => void) | null>(null);
  /** The wheel's hum, which loops for the same span as the ball. */
  const stopHum = useRef<(() => void) | null>(null);

  /** A spin abandoned by leaving the screen must not leave a ball rolling. */
  useEffect(
    () => () => {
      stopRoll.current?.();
      stopHum.current?.();
    },
    [],
  );
  const scroller = useRef<ScrollView>(null);
  /**
   * The winning number's entrance.
   *
   * Overshoots to 1.3 and settles back, which is the shape of something being
   * put down rather than something fading in. It is keyed on `display`, so it
   * fires exactly once per spin and exactly when the ball has stopped — the
   * same moment the number becomes true.
   */
  const revealScale = useRef(new Animated.Value(1)).current;
  const reduced = usePrefersReducedMotion();

  /**
   * Where to scroll so the player can SEE the result of the spin they paid for.
   *
   * This used to be `y: 0`, which is right only if the whole result card
   * happens to fit above the pinned controls. It does on a 664-point phone and
   * it does not on a 553-point one, where scrolling to the top put the wheel on
   * screen and "WIN 200 GC" underneath the dock — the player was returned to a
   * view of the answer being covered up.
   *
   * So it is derived instead: put the BOTTOM of the result card at the bottom
   * of the space the dock leaves. On a tall screen the whole card fits and this
   * is zero, i.e. the top, which is what it always was. On a short screen it
   * scrolls past part of the wheel to show the number and the win line — the
   * right thing to sacrifice, because the wheel has already finished saying
   * what it had to say.
   */
  const cardBottom = useRef(0);
  const viewport = useRef(0);
  const resultScrollTarget = useCallback(
    () => Math.max(0, cardBottom.current - (viewport.current - DOCK_HEIGHT) + spacing.sm),
    [],
  );

  useEffect(() => {
    if (display === null || reduced) {
      revealScale.setValue(1);
      return;
    }
    revealScale.setValue(0.55);
    Animated.sequence([
      Animated.timing(revealScale, {
        toValue: 1.3,
        duration: 190,
        easing: Easing.out(Easing.back(2.2)),
        useNativeDriver: true,
      }),
      Animated.spring(revealScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [display, reduced, revealScale]);

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => alive && setBalance(minor(result.balance)))
      .catch(() => alive && setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api]);

  const total = useMemo(
    () => [...bets.values()].reduce((sum, bet) => sum + bet.amount, 0),
    [bets],
  );

  const place = useCallback(
    (type: BetType, selection: number[]) => {
      if (spinning) return;
      unlock();
      sounds.tap();
      setError(null);
      setRound(null);
      setBets((current) => {
        const next = new Map(current);
        const key = keyOf(type, selection);
        const existing = next.get(key);
        next.set(key, {
          type,
          selection,
          // Tapping again stacks another chip, exactly like the felt.
          amount: (existing?.amount ?? 0) + chip,
        });
        return next;
      });
    },
    [chip, spinning],
  );

  const clear = useCallback(() => {
    if (spinning) return;
    sounds.tap();
    setBets(new Map());
    setError(null);
  }, [spinning]);

  const spin = useCallback(async () => {
    if (spinning || bets.size === 0) return;
    if (total > balance) {
      setError('Not enough coins for those bets');
      return;
    }

    unlock();

    /*
     * Show the wheel NOW, not when the result arrives.
     *
     * A player who scrolled to the bottom of the felt to place their bets taps
     * Spin from down there — and then watches a static betting grid for three
     * and a half seconds while the wheel they paid for spins off-screen above
     * them. Scrolling only after the ball landed meant the entire animation
     * happened where nobody could see it, and the first thing they saw was the
     * answer.
     *
     * This is the same target the result uses, so the view does not move again
     * when the ball stops: one scroll per spin, at the moment the spin starts.
     */
    scroller.current?.scrollTo({ y: resultScrollTarget(), animated: true });

    /*
     * The ball running round the rim, for as long as it actually runs.
     *
     * This was one `playCue` of a ONE SECOND recording under a spin that lasts
     * three and a half. The rattle stopped a third of the way in, the table
     * went silent, and then the drop arrived from nowhere — which is what "the
     * spin and stop sounds feel out of sync" was describing. Nothing was
     * mistimed; there was simply no sound for most of the spin, so the drop had
     * nothing to be the end of.
     *
     * Looped, it runs exactly as long as the ball does — including the part
     * that depends on how quickly the server answers — and it is stopped on the
     * frame the ball lands, underneath the drop.
     */
    /*
     * TWO looped layers, for the whole length of the spin.
     *
     * The first attempt looped only the ball and left `sounds.spinStart()` —
     * which plays `roulette-wheel.mp3` ONCE, and that file is also one second
     * long. So the wheel hum still stopped a third of the way in, and the
     * founder still heard the spin fall out of sync with the picture.
     *
     * Both files are one-second recordings and the spin lasts as long as it
     * lasts, so both have to loop. The wheel sits underneath (it is the room,
     * quiet) and the ball rattles on top. They are stopped together on the
     * frame the ball lands, underneath the drop.
     */
    stopRoll.current?.();
    stopRoll.current = playLoop(ROULETTE_SOUNDS.ball, 0.42);
    stopHum.current?.();
    stopHum.current = playLoop(ROULETTE_SOUNDS.wheel, 0.22);

    setSpinning(true);
    setError(null);
    setRound(null);
    setBalance((current) => minor(current - total));

    // The wheel starts turning on the tap, so the round trip hides inside an
    // animation the player was going to watch anyway — the same trick the
    // reels use, and the reason a spin feels instant on a slow connection.
    setDisplay(null);
    setWheelTarget(null);
    setWheelPhase('spinning');

    try {
      const result = await api.placeBet({
        gameId: GAME_ID,
        stake: total,
        action: { type: 'place-bets', bets: [...bets.values()] },
        idempotencyKey: `${Date.now()}-roulette`,
      });

      const state = result.state as { winningNumber: number; winningBets: number[] };

      /*
       * Hand the wheel its answer and wait for the BALL to stop.
       *
       * Not a fixed `setTimeout`: that timer started when the server replied
       * while the wheel started on the tap, so every spin was out of step by
       * the round-trip time — and the number could appear while the ball was
       * still travelling. The wheel resolves this promise from its own final
       * frame, so the result is announced exactly when it is visibly true.
       */
      await new Promise<void>((resolve) => {
        wheelStopped.current = resolve;
        setWheelTarget(state.winningNumber);
        setWheelPlan({ from: spinNow() + 0.04, duration: WHEEL_LAND_SECONDS });
        setWheelPhase('landing');
      });

      setDisplay(state.winningNumber);
      setRound(result);
      setBalance(minor(result.balance));
      publishBalance(minor(result.balance));

      /*
       * The rattle ends and the ball drops, in that order and on the same
       * frame the picture says it happened.
       *
       * `sounds.reelStop(0)` used to play over the top of this. That is the
       * detent of a slot machine's reel — a mechanism this table does not have
       * — and layering it under the drop made the landing sound like a
       * fruit machine stopping rather than a ball settling into a pocket.
       */
      stopRoll.current?.();
      stopRoll.current = null;
      stopHum.current?.();
      stopHum.current = null;
      playCue(ROULETTE_SOUNDS.drop, 0.7);

      /*
       * Again, and deliberately not redundant.
       *
       * The scroll at the top of this function is the one that matters — it
       * puts the wheel on screen before it starts turning. This one catches
       * the case where the player scrolled away DURING the spin, which is
       * exactly when they would most want bringing back. On the normal path it
       * is a no-op, because the view is already here.
       */
      scroller.current?.scrollTo({ y: resultScrollTarget(), animated: true });

      const payout = result.settlement?.payout ?? 0;
      setTimeout(() => {
        if (payout > total) {
          const multiple = payout / Math.max(total, 1);
          // The burst is deliberately tied to the ball's landing rather than
          // the server response: the table never celebrates information the
          // player has not seen yet.
          if (multiple >= 25) {
            sounds.megaWin();
            celebration.current?.blast(1);
            celebration.current?.pour(1, 2.8);
          } else if (multiple >= 10) {
            sounds.bigWin();
            celebration.current?.blast(0.9);
            celebration.current?.pour(0.72, 1.6);
          } else if (multiple >= 3) {
            sounds.win();
            celebration.current?.fire(0.9);
          } else {
            sounds.win();
            celebration.current?.fire(Math.max(0.32, Math.min(0.64, (multiple - 1) / 4)));
          }
        }
        else sounds.lose();
      }, 220);
    } catch (caught) {
      stopRoll.current?.();
      stopRoll.current = null;
      stopHum.current?.();
      stopHum.current = null;
      setWheelPhase('idle');
      setDisplay(null);
      setBalance((current) => minor(current + total));
      sounds.error();
      setError(caught instanceof PlayApiError ? caught.message : 'Could not spin. Try again.');
    } finally {
      setSpinning(false);
    }
  }, [api, balance, bets, spinning, total]);

  const result = round?.state as
    | { winningNumber: number; winningBets: number[] }
    | undefined;
  const payout = round?.settlement?.payout ?? 0;

  const NumberCell = ({ n }: { n: number }) => {
    const bet = bets.get(keyOf('straight', [n]));
    const colour = colourOf(n);
    const won = result && result.winningNumber === n;
    return (
      <Pressable
        onPress={() => place('straight', [n])}
        disabled={spinning}
        accessibilityRole="button"
        accessibilityLabel={`Bet ${format(minor(chip), 'GC')} on ${n}`}
        style={[
          styles.cell,
          colour === 'red' && styles.red,
          colour === 'black' && styles.black,
          colour === 'green' && styles.green,
          won && styles.cellWon,
        ]}
      >
        {/* A lit top half. Thirty-seven gradients would be thirty-seven SVGs;
            one flat overlay at 9% white does the same job — the cell stops
            being a coloured rectangle and starts being a moulded lozenge. */}
        <CellGloss />
        <Txt variant="bodySmall">{n}</Txt>
        {bet ? <ChipMark amount={bet.amount} /> : null}
      </Pressable>
    );
  };

  const OutsideBet = ({
    label,
    type,
    selection = [],
    flex = 1,
    tint,
  }: {
    label: string;
    type: BetType;
    selection?: number[];
    flex?: number;
    tint?: string;
  }) => {
    const bet = bets.get(keyOf(type, selection));
    return (
      <Pressable
        onPress={() => place(type, selection)}
        disabled={spinning}
        accessibilityRole="button"
        accessibilityLabel={`Bet ${format(minor(chip), 'GC')} on ${label}`}
        style={[styles.outside, { flex }, tint ? { backgroundColor: tint } : null]}
      >
        <Txt variant="caption">{label}</Txt>
        {bet ? (
          <Txt variant="caption" color={colors.gold.light}>
            {format(minor(bet.amount), 'GC')}
          </Txt>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
    <ScrollView
      ref={scroller}
      style={styles.screen}
      contentContainerStyle={styles.content}
      onLayout={(event) => (viewport.current = event.nativeEvent.layout.height)}
    >
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
        </View>
        <View style={styles.rtpPill}>
          <Txt variant="caption" color={colors.text.secondary}>
            Single zero · RTP 97.30%
          </Txt>
        </View>
        {/* Sound, reachable without leaving the game. See SoundToggles. */}
        <SoundToggles compact />
      </View>

      {/* The result. Wrapped because the measurement has to be of the whole
          cluster and `Card` takes no onLayout of its own. */}
      <View
        style={styles.wheelStage}
        onLayout={(event) => {
          const { y, height, width } = event.nativeEvent.layout;
          cardBottom.current = y + height;
          setCelebrationStage((current) =>
            current.width === width && current.height === height ? current : { width, height },
          );
        }}
      >
      <Image
        source={{ uri: '/art/tiles/juwa-roulette-eu.png' }}
        resizeMode="cover"
        style={styles.wheelArtwork}
      />
      <View style={styles.wheelShell}>
        <LinearGradient colors={['rgba(82,38,8,0.98)', 'rgba(7,9,17,0.98)', 'rgba(3,5,12,0.99)']} style={StyleSheet.absoluteFill} />
        <View style={styles.wheelCrown} pointerEvents="none">
          <Txt variant="caption" color="#FFE5A0">EUROPEAN ROULETTE · PRIVATE SALON</Txt>
        </View>
        <View style={styles.wheel}>
        <RouletteWheel
          size={WHEEL_SIZE}
          phase={wheelPhase}
          target={wheelTarget}
          landFrom={wheelPlan.from}
          landDuration={wheelPlan.duration}
          onLanded={() => {
            setWheelPhase('idle');
            wheelStopped.current?.();
            wheelStopped.current = null;
          }}
        />
        {/* The number, under the wheel rather than inside it: at this size the
            pocket the ball is sitting in is legible as a colour but not as a
            two-digit number, and the payout depends on the number.

            It ARRIVES rather than appearing. A number that simply swaps in is
            indistinguishable from a number that was always there — the thing
            the player is waiting for goes past unmarked. */}
        <Animated.View
          style={[
            styles.ball,
            display !== null && colourOf(display) === 'red' && styles.red,
            display !== null && colourOf(display) === 'black' && styles.black,
            display !== null && colourOf(display) === 'green' && styles.green,
            { transform: [{ scale: revealScale }] },
          ]}
        >
          <Txt variant="h1">{display ?? '—'}</Txt>
        </Animated.View>
        <View style={styles.readout} accessibilityLiveRegion="polite">
          {spinning ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              No more bets…
            </Txt>
          ) : error ? (
            <Txt variant="bodySmall" color={colors.feedback.error}>
              {error}
            </Txt>
          ) : round ? (
            <Txt
              variant="h3"
              color={payout > 0 ? colors.feedback.winBright : colors.text.muted}
            >
              {payout > 0 ? `WIN ${format(minor(payout), 'GC')}` : 'No win this time'}
            </Txt>
          ) : bets.size > 0 ? (
            // It went on saying "pick a chip, then tap the table" while the
            // table already had chips on it — an instruction the player has
            // visibly finished following, which reads as the game not having
            // noticed.
            <Txt variant="bodySmall" color={colors.text.secondary}>
              {bets.size} {bets.size === 1 ? 'bet' : 'bets'} down · tap Spin
            </Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Pick a chip, then tap the table
            </Txt>
          )}
        </View>
        </View>
      </View>
      {/* The shared casino celebration language, over the wheel but never in
          the way of its controls.  This is the only table that was missing it. */}
      <Fireworks
        width={celebrationStage.width}
        height={celebrationStage.height}
        controller={celebration}
      />
      </View>

      {/* Chip denomination */}
      <View style={styles.chipRow}>
        {CHIPS.map((value) => (
          <Pressable
            key={value}
            onPress={() => setChip(value)}
            disabled={spinning}
            accessibilityRole="button"
            accessibilityState={{ selected: value === chip }}
            style={[styles.chipButton, value === chip && styles.chipButtonActive]}
          >
            <Txt
              variant="caption"
              color={value === chip ? colors.text.inverse : colors.text.secondary}
            >
              {value >= 1000 ? `${value / 1000}k` : value}
            </Txt>
          </Pressable>
        ))}
      </View>

      {/* The felt, rotated for a phone */}
      <Card style={styles.felt}>
        <Pressable
          onPress={() => place('straight', [0])}
          disabled={spinning}
          accessibilityRole="button"
          accessibilityLabel={`Bet ${format(minor(chip), 'GC')} on zero`}
          style={[styles.zero, result?.winningNumber === 0 && styles.cellWon]}
        >
          <CellGloss />
          <Txt variant="bodySmall">0</Txt>
          {bets.get(keyOf('straight', [0])) ? (
            <ChipMark amount={bets.get(keyOf('straight', [0]))!.amount} />
          ) : null}
        </Pressable>

        {Array.from({ length: 12 }, (_, row) => (
          <View key={row} style={styles.feltRow}>
            {[1, 2, 3].map((col) => (
              <NumberCell key={col} n={row * 3 + col} />
            ))}
          </View>
        ))}

        {/* Column bets sit under the column they cover. */}
        <View style={styles.feltRow}>
          {[0, 1, 2].map((index) => (
            <OutsideBet key={index} label={`Col ${index + 1}`} type="column" selection={[index]} />
          ))}
        </View>
      </Card>

      <View style={styles.outsideGroup}>
        <View style={styles.feltRow}>
          <OutsideBet label="1st 12" type="dozen" selection={[0]} />
          <OutsideBet label="2nd 12" type="dozen" selection={[1]} />
          <OutsideBet label="3rd 12" type="dozen" selection={[2]} />
        </View>
        <View style={styles.feltRow}>
          <OutsideBet label="1–18" type="low" />
          <OutsideBet label="EVEN" type="even" />
          <OutsideBet label="RED" type="red" tint={colors.table.red} />
        </View>
        <View style={styles.feltRow}>
          <OutsideBet label="19–36" type="high" />
          <OutsideBet label="ODD" type="odd" />
          <OutsideBet label="BLACK" type="black" tint={colors.table.black} />
        </View>
      </View>

      {/* What is on the table right now */}
      {bets.size > 0 ? (
        <Card style={styles.slip}>
          {[...bets.entries()].map(([key, bet]) => (
            <View key={key} style={styles.slipRow}>
              <Txt variant="caption" color={colors.text.secondary}>
                {describeBet(bet)} · pays {ODDS[bet.type]}:1
              </Txt>
              <Txt variant="caption">{format(minor(bet.amount), 'GC')}</Txt>
            </View>
          ))}
          <View style={[styles.slipRow, styles.slipTotal]}>
            <Txt variant="bodySmall">Total staked</Txt>
            <Txt variant="money" color={colors.gold.default}>
              {format(minor(total), 'GC')}
            </Txt>
          </View>
        </Card>
      ) : null}

    </ScrollView>

      {/* Once bets are down, the wheel owns the room. The felt remains behind
          this glass stage rather than competing with the spin. */}
      {spinning ? (
        <View style={styles.spinStage} pointerEvents="none">
          <LinearGradient colors={['rgba(3,4,11,0.96)', 'rgba(27,8,3,0.94)', 'rgba(3,4,11,0.98)']} style={StyleSheet.absoluteFill} />
          <Image source={{ uri: '/art/tiles/juwa-roulette-eu.png' }} resizeMode="cover" style={styles.spinArtwork} />
          <View style={styles.spinCrown}><Txt variant="caption" color="#FFE8A7">NO MORE BETS · BALL IN MOTION</Txt></View>
          <RouletteWheel
            size={292}
            phase={wheelPhase}
            target={wheelTarget}
            landFrom={wheelPlan.from}
            landDuration={wheelPlan.duration}
          />
          <Txt variant="h3" color="#FFE7A3">THE TABLE IS LIVE</Txt>
        </View>
      ) : null}

      {/*
        THE DOCK.

        Spin and Clear used to be the last thing on the page, below twelve rows
        of felt, three rows of outside bets and the bet slip. Placing a bet
        means scrolling to the bottom of that; spinning meant scrolling further;
        and then the code scrolled the player back to the top to show them the
        result. Three scrolls per spin, on a game whose whole rhythm is bet,
        spin, look.

        The founder asked for the controls to be moved up next to the wheel.
        Pinned is that request taken seriously: next to the wheel is reachable
        from the top of the page and nowhere else, whereas a dock is reachable
        from everywhere — including the bottom of the felt, which is exactly
        where a player is standing when they have finished betting.

        It carries the staked total as well, because the number a player wants
        before committing is what this spin costs, and that was three sections
        further up in the slip.
      */}
      <View style={styles.dock}>
        <View style={styles.dockTotal}>
          <Txt variant="caption" color={colors.text.muted}>
            STAKED
          </Txt>
          <Txt variant="bodySmall" color={total > 0 ? colors.gold.default : colors.text.muted}>
            {format(minor(total), 'GC')}
          </Txt>
        </View>
        <Button
          label="Clear"
          variant="secondary"
          onPress={clear}
          disabled={spinning || bets.size === 0}
          style={styles.clear}
        />
        <Button
          label={spinning ? 'Spinning…' : round ? 'Spin again' : 'Spin'}
          onPress={spin}
          loading={spinning}
          disabled={spinning || bets.size === 0 || total > balance || total < MIN_BET}
          style={styles.spin}
        />
      </View>
    </View>
  );
}

/**
 * The lit face of a felt cell.
 *
 * A flat white overlay at fifty per cent height was the first attempt, and on
 * the red numbers it passed — but on the black ones it read as a hard two-tone
 * band across the middle of the cell rather than as light. A gloss is a
 * FALLOFF; the edge is the whole thing. So it is a real gradient, which on the
 * web compiles to a CSS `linear-gradient` and costs nothing per cell.
 */
function CellGloss() {
  return (
    <View style={styles.cellGloss} pointerEvents="none">
      <LinearGradient
        colors={['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
        locations={[0, 0.42, 0.78]}
        style={styles.cellGlossFill}
      />
    </View>
  );
}

/**
 * A stake sitting on a number, drawn as a chip.
 *
 * It was a gold pill in the corner of the cell with the amount in it, which is
 * a label. A player scanning a felt for their own money is looking for the
 * shape of a chip — a disc with an edge and a lighter face — and the amount
 * printed on it is a detail they read second, after they have found it.
 *
 * The edge is drawn with a ring rather than a border so the disc keeps its full
 * diameter: at 22 points a 2-point border eats a tenth of the face, and the
 * number stops fitting.
 */
function ChipMark({ amount }: { amount: number }) {
  const label = amount >= 1_000_000
    ? `${Math.round(amount / 100_000) / 10}m`
    : amount >= 1000
      ? `${Math.round(amount / 100) / 10}k`
      : String(amount);
  return (
    <View style={styles.chipMark} pointerEvents="none">
      <View style={styles.chipEdge} />
      <View style={styles.chipFace}>
        <Txt variant="caption" color="#3A2A05" style={styles.chipText}>
          {label}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.base },
  // The bottom padding clears the dock, which floats over this scroll view.
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: DOCK_HEIGHT + spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  wheel: { alignItems: 'center', gap: spacing.sm, borderColor: colors.gold.dark, paddingTop: spacing.sm },
  // Fireworks uses absolute fill, so the wrapper establishes a stage exactly
  // around the wheel/result cluster rather than across the whole scroll view.
  wheelStage: { position: 'relative', overflow: 'hidden', borderRadius: 24, backgroundColor: '#060812' },
  wheelArtwork: { ...StyleSheet.absoluteFillObject, opacity: 0.32 },
  wheelShell: { overflow: 'hidden', borderRadius: 24, borderWidth: 2, borderColor: '#C99C35', padding: spacing.md, shadowColor: '#E7B33F', shadowOpacity: 0.52, shadowRadius: 30, shadowOffset: { width: 0, height: 11 } },
  wheelCrown: { alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(255,224,143,0.68)', backgroundColor: 'rgba(12,5,2,0.72)' },
  spinStage: { ...StyleSheet.absoluteFillObject, zIndex: 8, alignItems: 'center', justifyContent: 'center', gap: spacing.md, overflow: 'hidden' },
  spinArtwork: { ...StyleSheet.absoluteFillObject, opacity: 0.24 },
  spinCrown: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: '#E1B555', backgroundColor: 'rgba(13,7,4,0.86)' },
  ball: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10111C',
    borderWidth: 2,
    borderColor: '#D1A33A',
  },
  readout: { minHeight: 28, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  chipButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: '#15131B',
    borderWidth: 1,
    borderColor: '#6E5224',
    minWidth: 56,
    alignItems: 'center',
  },
  chipButtonActive: { backgroundColor: '#D2A13A', borderColor: '#FFE9A7' },
  felt: { backgroundColor: '#08281D', borderColor: '#C69A39', borderWidth: 2, gap: 3, padding: spacing.sm, shadowColor: '#000', shadowOpacity: 0.42, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  feltRow: { flexDirection: 'row', gap: 3 },
  zero: {
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: '#0B6E3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    flex: 1,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  red: { backgroundColor: colors.table.red },
  black: { backgroundColor: colors.table.black },
  green: { backgroundColor: '#0B6E3A' },
  cellWon: { borderWidth: 2, borderColor: colors.gold.light },
  chipMark: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  /** The rim: darker gold, full diameter, sitting behind the face. */
  chipEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: '#8A5F0A',
  },
  chipFace: {
    position: 'absolute',
    left: 2.5,
    right: 2.5,
    top: 2.5,
    bottom: 2.5,
    borderRadius: 9.5,
    backgroundColor: colors.gold.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontWeight: '900', fontSize: 10, lineHeight: 12 },
  /**
   * The lit face of a felt cell. See CellGloss.
   *
   * The gradient covers the cell edge to edge and is painted before the
   * number, so it lies over the cell's background and under its text. That
   * means a tap anywhere except directly on the digits lands on the gloss
   * first — hence the `pointerEvents="none"` wrapper, without which the outer
   * two thirds of every betting cell would be dead while the middle still
   * worked. A half-responsive tap target is worse than an obviously broken
   * one, because the player concludes the app is slow rather than that they
   * missed.
   */
  cellGloss: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  cellGlossFill: { flex: 1 },
  outsideGroup: { gap: 3 },
  outside: {
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15131B',
    borderWidth: 1,
    borderColor: '#715521',
  },
  slip: { gap: spacing.xs, padding: spacing.md },
  slipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slipTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  /**
   * The pinned control bar.
   *
   * Absolute rather than a flex sibling, so the felt scrolls UNDER it and the
   * dock keeps its own opaque background — a translucent bar over a bright red
   * number cell is a bar you cannot read. `content` reserves the matching
   * height at the bottom so nothing is permanently hidden behind it.
   */
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: '#0B0D16',
    borderTopWidth: 1,
    borderTopColor: '#D6A83E',
  },
  dockTotal: { minWidth: 74 },
  clear: { flex: 1 },
  spin: { flex: 2, minHeight: 52 },
});
