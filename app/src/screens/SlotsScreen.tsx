import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, motion, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Button, Card, Txt } from '../components/primitives';
import { Reel, type ReelPhase } from '../components/Reel';
import { sounds, unlock } from '../sound';
import {
  PlayApiError,
  createPlayApi,
  type PlayApi,
  type RoundResponse,
  type SlotsState,
  USE_DEMO_API,
} from '../api/client';

const GAME_ID = 'juwa-classic-slots';
const MIN_BET = minor(20);
const MAX_BET = minor(50_000);
const REELS = 5;
/** Free spins run at this fraction of the base spin duration. */
const FS_SPEED = 0.45;

const IDLE_GRID: string[][] = Array.from({ length: REELS }, () => [
  'CHERRY',
  'BAR',
  'LEMON',
]);

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

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(2_000));
  const [reelPhase, setReelPhase] = useState<ReelPhase>('idle');
  const spinning = reelPhase !== 'idle';
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [grid, setGrid] = useState<string[][]>(IDLE_GRID);
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
  // Increments per spin so each reel run is a distinct animation.
  const [reelRound, setReelRound] = useState(0);
  const [reelSpeed, setReelSpeed] = useState(1);
  /**
   * Resolved by the LAST reel's own stop callback. This is the handshake that
   * keeps the sound and the readout tied to what is actually on screen.
   */
  const landingResolver = useRef<(() => void) | null>(null);

  const handleReelLanded = useCallback((index: number) => {
    sounds.reelStop(index);
    if (index === REELS - 1) {
      landingResolver.current?.();
      landingResolver.current = null;
    }
  }, []);

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
  const winningRows = useMemo(() => {
    if (spinning && phase !== 'fs' && phase !== 'fs-total') return [];
    if (!slots) return [];
    // During the bonus round the highlight follows whichever free spin is on
    // screen, not the base spin that triggered it.
    const source =
      phase === 'fs' || phase === 'fs-total'
        ? (slots.freeSpins[freeSpinIndex] ?? slots.baseSpin)
        : slots.baseSpin;
    // The payline index doubles as a row index for the three straight lines;
    // richer zig-zag highlighting arrives with the win-line overlay.
    return source.lineWins.map((win) => win.line).filter((line) => line < 3);
  }, [slots, spinning, phase, freeSpinIndex]);

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
    setFreeSpinsTotal(0);
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
        setGrid(next);
        setReelSpeed(speedScale);
        setReelRound((n) => n + 1);
        setReelPhase('landing');
      });

    try {
      const result = await api.placeBet({
        gameId: GAME_ID,
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
      setRunningWin(spinWin(state.baseSpin.totalMultiplier));

      const baseWin = spinWin(state.baseSpin.totalMultiplier);
      if (baseWin >= bet * 10) sounds.bigWin();
      else if (baseWin > 0) sounds.win();

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
          setRunningWin((won) => won + spinWin(spinResult.totalMultiplier));
          if (spinResult.totalMultiplier > 0) sounds.win();
          await wait(500);
          if (superseded()) return;
        }

        setPhase('fs-total');
        sounds.bigWin();
        sounds.coins(8);
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
  }, [api, balance, bet, spinning]);

  return (
    <View style={styles.screen}>
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
            RTP 96.25%
          </Txt>
        </View>
      </View>

      <Card style={[styles.machine, inFreeSpins && styles.machineBonus]}>
        <View style={styles.reelBay}>
        <View style={styles.reels}>
          {Array.from({ length: REELS }, (_, i) => (
            <Reel
              key={i}
              index={i}
              phase={reelPhase}
              round={reelRound}
              speed={reelSpeed}
              result={grid[i] ?? IDLE_GRID[i]!}
              winningRows={winningRows}
              onLanded={() => handleReelLanded(i)}
            />
          ))}
        </View>
        </View>

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
            <Txt variant="h3" color={colors.feedback.winBright}>
              WIN {format(minor(settlement.payout), 'GC')}
              {settlement.multiplier >= 10 ? '  🔥' : ''}
            </Txt>
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
    borderColor: colors.gold.dark,
    borderWidth: 2,
    backgroundColor: '#0B1330',
  },
  machineBonus: { borderColor: colors.neon.magenta },
  /**
   * The reel bay is recessed: darker than the cabinet, with a gold inner rule.
   * A slot machine's reels sit BEHIND glass, and that inset is most of what
   * separates a machine from five rectangles in a row.
   */
  reelBay: {
    backgroundColor: '#05091A',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.gold.dark,
    padding: spacing.sm,
  },
  fsRow: { alignItems: 'center', gap: 2 },
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
