import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { Button, Card, Txt } from '../components/primitives';
import { playCue, sounds, spinNow, unlock, useSoundSet } from '../sound';
import { ROULETTE_SOUNDS } from '../api/sound-sets';
import { RouletteWheel, type WheelPhase } from '../components/RouletteWheel';
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
/** Big enough that the painted numbers are readable on a phone. */
const WHEEL_SIZE = 230;

/** Payout quoted as "X to 1"; the stake comes back on top. */
const ODDS: Record<BetType, number> = {
  straight: 35, dozen: 2, column: 2,
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
};

const CHIPS = [50, 100, 500, 1_000, 5_000];

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
  }, []);

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
  /** Resolved by the wheel's own stop, so the readout can never run ahead. */
  const wheelStopped = useRef<(() => void) | null>(null);
  const scroller = useRef<ScrollView>(null);

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
    sounds.spinStart();
    // The ball running round the rim, under the wheel.
    playCue(ROULETTE_SOUNDS.ball, 0.5);
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
      // The ball into the pocket, over the mechanical stop the slots use.
      playCue(ROULETTE_SOUNDS.drop, 0.7);
      sounds.reelStop(0);

      // The felt is long, so by the time a player has placed bets they are
      // scrolled to the bottom — and the wheel, the number and the win amount
      // are all off-screen above them. Without this they never see the result
      // of the spin they just paid for.
      scroller.current?.scrollTo({ y: 0, animated: true });

      const payout = result.settlement?.payout ?? 0;
      setTimeout(() => {
        if (payout > total) sounds.bigWin();
        else if (payout > 0) sounds.win();
        else sounds.lose();
      }, 220);
    } catch (caught) {
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
        <Txt variant="bodySmall">{n}</Txt>
        {bet ? (
          <View style={styles.chipMark}>
            <Txt variant="caption" color={colors.text.inverse}>
              {bet.amount >= 1000 ? `${bet.amount / 1000}k` : bet.amount}
            </Txt>
          </View>
        ) : null}
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
    <ScrollView ref={scroller} style={styles.screen} contentContainerStyle={styles.content}>
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
      </View>

      {/* The result */}
      <Card style={styles.wheel}>
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
            two-digit number, and the payout depends on the number. */}
        <View
          style={[
            styles.ball,
            display !== null && colourOf(display) === 'red' && styles.red,
            display !== null && colourOf(display) === 'black' && styles.black,
            display !== null && colourOf(display) === 'green' && styles.green,
          ]}
        >
          <Txt variant="h1">{display ?? '—'}</Txt>
        </View>
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
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Pick a chip, then tap the table
            </Txt>
          )}
        </View>
      </Card>

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
          <Txt variant="bodySmall">0</Txt>
          {bets.get(keyOf('straight', [0])) ? (
            <View style={styles.chipMark}>
              <Txt variant="caption" color={colors.text.inverse}>
                ●
              </Txt>
            </View>
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

      <View style={styles.actions}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.base },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  wheel: { alignItems: 'center', gap: spacing.md, borderColor: colors.gold.dark },
  ball: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.overlay,
    borderWidth: 2,
    borderColor: colors.surface.border,
  },
  readout: { minHeight: 28, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  chipButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    minWidth: 56,
    alignItems: 'center',
  },
  chipButtonActive: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  felt: { backgroundColor: colors.table.felt, borderColor: colors.table.feltLight, gap: 3, padding: spacing.sm },
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
    right: 2,
    top: 2,
    minWidth: 18,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.gold.default,
    alignItems: 'center',
  },
  outsideGroup: { gap: 3 },
  outside: {
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  slip: { gap: spacing.xs, padding: spacing.md },
  slipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slipTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  clear: { flex: 1 },
  spin: { flex: 2, minHeight: 56 },
});
