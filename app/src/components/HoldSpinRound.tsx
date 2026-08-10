/**
 * Hold and spin — the round, drawn.
 *
 * The mechanic every player asks for by name, and the one this catalogue did
 * not have. Three symbols lock where they landed; everything else respins.
 * Three respins, and every coin that sticks puts the counter back to three, so
 * the round ends only after three consecutive nothings.
 *
 * ## What has to be on screen for it to work
 *
 * The whole feeling is the RESPIN COUNTER. A free-spin round tells you its
 * length at the start and then plays out; this one is being fought for a cell
 * at a time, and the counter dropping 3 → 2 → 1 is the tension. So the counter
 * is the largest thing here after the grid, and it visibly snaps back to three
 * every time a coin lands. A version of this that only animated the coins would
 * be free spins with extra steps.
 *
 * ## Why the outcome is already decided
 *
 * The server resolved the entire round before this component existed; it is
 * handed the list of steps and plays them back. Nothing here decides anything,
 * which is the same split free spins use and the reason a client cannot be
 * persuaded to award itself a better bonus.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';
import type { HeldCoin, HoldSpinStep } from '../api/client';

/** How long one respin is held on screen. */
const STEP_MS = 620;
/** A respin that landed something is held longer — there is more to read. */
const HIT_MS = 900;

export interface HoldSpinRoundProps {
  seed: HeldCoin[];
  steps: HoldSpinStep[];
  full: boolean;
  /** Cells per reel, so the panel matches the machine's own shape. */
  rows: number[];
  /** Stake in minor units, so a coin can be shown as money rather than a factor. */
  stake: number;
  onDone: () => void;
}

export function HoldSpinRound({
  seed,
  steps,
  full,
  rows,
  stake,
  onDone,
}: HoldSpinRoundProps) {
  const reduced = usePrefersReducedMotion();
  /** How many steps have been played. `-1` is the trigger, before any respin. */
  const [step, setStep] = useState(-1);
  const done = useRef(false);

  useEffect(() => {
    if (reduced) {
      // No sequence at all: the result, immediately. Someone who has asked the
      // operating system to stop animations is not asking for a shorter one.
      setStep(steps.length - 1);
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
    if (step >= steps.length - 1) {
      if (done.current) return undefined;
      done.current = true;
      const t = setTimeout(onDone, 1_400);
      return () => clearTimeout(t);
    }
    const next = steps[step + 1];
    const wait = step < 0 ? 700 : (next?.gained.length ?? 0) > 0 ? HIT_MS : STEP_MS;
    const t = setTimeout(() => setStep((s) => s + 1), wait);
    return () => clearTimeout(t);
  }, [step, steps, reduced, onDone]);

  // Everything locked up to and including the current step.
  const held = new Map<string, HeldCoin>();
  for (const coin of seed) held.set(`${coin.reel},${coin.row}`, coin);
  for (let i = 0; i <= step && i < steps.length; i++) {
    for (const coin of steps[i]?.gained ?? []) held.set(`${coin.reel},${coin.row}`, coin);
  }
  const justLanded = new Set(
    (step >= 0 ? steps[step]?.gained ?? [] : []).map((c) => `${c.reel},${c.row}`),
  );

  const respins = step < 0 ? 3 : (steps[step]?.respinsLeft ?? 0);
  const finished = step >= steps.length - 1;
  let won = 0;
  for (const coin of held.values()) won += coin.value;

  return (
    <View style={styles.wrap}>
      <Txt variant="caption" color={colors.gold.light} style={styles.title}>
        HOLD &amp; SPIN
      </Txt>

      {/*
        The counter. Deliberately the loudest thing here after the grid: it is
        the entire difference between this round and a free-spin round.
      */}
      <View style={styles.counter}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.pip, i < respins && styles.pipLit]} />
        ))}
        <Txt variant="h3" color={respins > 0 ? colors.gold.default : colors.text.muted}>
          {finished ? (full ? 'FULL GRID' : 'COMPLETE') : `${respins} RESPIN${respins === 1 ? '' : 'S'}`}
        </Txt>
      </View>

      <View style={styles.grid}>
        {rows.map((height, reel) => (
          <View key={reel} style={styles.reel}>
            {Array.from({ length: height }, (_, row) => {
              const coin = held.get(`${reel},${row}`);
              return (
                <Cell
                  key={row}
                  {...(coin ? { value: coin.value } : {})}
                  stake={stake}
                  fresh={justLanded.has(`${reel},${row}`)}
                  reduced={reduced}
                />
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.total}>
        <Txt variant="caption" color={colors.text.muted}>
          COLLECTED
        </Txt>
        <Txt variant="h3" color={colors.feedback.winBright}>
          {formatCoins(won * stake)} GC
        </Txt>
      </View>
    </View>
  );
}

/** One cell: an empty socket, or a coin with what it is worth. */
function Cell({
  value,
  stake,
  fresh,
  reduced,
}: {
  value?: number;
  stake: number;
  fresh: boolean;
  reduced: boolean;
}) {
  const pop = useRef(new Animated.Value(fresh && !reduced ? 0 : 1)).current;

  useEffect(() => {
    if (!fresh || reduced) return;
    pop.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [fresh, reduced, pop]);

  if (value === undefined) return <View style={[styles.cell, styles.cellEmpty]} />;

  return (
    <Animated.View
      style={[
        styles.cell,
        styles.cellCoin,
        fresh && styles.cellFresh,
        { transform: [{ scale: pop }] },
      ]}
    >
      <Txt variant="caption" color="#2A1A02" style={styles.coinText}>
        {formatCoins(value * stake)}
      </Txt>
    </Animated.View>
  );
}

/**
 * Coins, short.
 *
 * A hold-and-spin grid is fifteen numbers at once on a phone, so they have to
 * fit in a cell about forty points wide — "12,500" does not, and a coin whose
 * value is clipped is a coin the player cannot add up.
 *
 * NO division. GC is declared with zero decimals in @juwa/money, so a minor
 * unit IS a coin. The first version of this divided by 100 out of habit and
 * showed every prize at a hundredth of its value — a 4,000 GC coin read as
 * "40" while the win counter beside it said 36,000, which is the kind of
 * disagreement that makes a player think the machine is short-changing them.
 */
function formatCoins(coins: number): string {
  const n = Math.round(coins);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 4, 14, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    zIndex: 20,
  },
  title: { letterSpacing: 3, fontWeight: '900' },
  total: { alignItems: 'center', gap: 1 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pip: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pipLit: { backgroundColor: colors.gold.default },
  grid: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  reel: { gap: 4 },
  cell: {
    width: 46,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmpty: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cellCoin: {
    backgroundColor: colors.gold.default,
    borderWidth: 2,
    borderColor: colors.gold.light,
  },
  cellFresh: { borderColor: '#FFFFFF' },
  coinText: { fontWeight: '900' },
});
