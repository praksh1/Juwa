/**
 * The instant games' play areas.
 *
 * One file because each is small — the shell in `shell.tsx` carries the
 * balance, the stake chips, the request and the error handling, so what is
 * left here is genuinely only what makes each game itself.
 *
 * Every quoted price comes from `@juwa/economy`, the module the server settles
 * with. Nothing here computes an outcome.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { format, minor } from '@juwa/money';
import {
  DICE_MIN_MULTIPLIER,
  MINES_TILES,
  PLINKO_ROWS,
  diceMultiplier,
  minesMultiplier,
  plinkoTable,
  type PlinkoRisk,
  type PlinkoRows,
} from '@juwa/economy';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from '../../components/primitives';
import {
  Board,
  InstantLayout,
  PlayButton,
  useInstantGame,
  useCelebration,
  useSettlementAnnouncer,
  styles as shell,
  type InstantGame,
} from './shell';
import { sounds } from '../../sound';
import type { RoundResponse } from '../../api/client';
import { usePrefersReducedMotion } from '../../motion';

const GAMES: Record<string, InstantGame> = {
  crash: { id: 'juwa-crash', name: 'Crash', minBet: 50, maxBet: 500_000, accent: '#F59E0B', cabinet: 'crash' },
  limbo: { id: 'juwa-limbo', name: 'Limbo', minBet: 50, maxBet: 500_000, accent: '#2DD4BF', cabinet: 'limbo' },
  dice: { id: 'juwa-dice', name: 'Dice', minBet: 50, maxBet: 500_000, accent: '#A3E635', cabinet: 'dice' },
  plinko: { id: 'juwa-plinko', name: 'Plinko', minBet: 50, maxBet: 500_000, accent: '#E879F9', cabinet: 'plinko' },
  mines: { id: 'juwa-mines', name: 'Mines', minBet: 50, maxBet: 500_000, accent: '#38BDF8', cabinet: 'mines' },
  scratch: { id: 'juwa-scratch', name: 'Golden Scratch', minBet: 100, maxBet: 10_000, accent: '#F6C84C', cabinet: 'scratch' },
};

/** A row of preset targets. Typing 2.47 on a phone is nobody's idea of fun. */
function TargetPicker({
  values,
  value,
  onChange,
  colour,
  suffix = '×',
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  colour: string;
  suffix?: string;
}) {
  return (
    <View style={local.targets}>
      {values.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[local.target, selected && { backgroundColor: colour }]}
          >
            <Txt variant="bodySmall" color={selected ? colors.surface.base : colors.text.secondary}>
              {option}
              {suffix}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------- crash

const CRASH_TARGETS = [1.5, 2, 3, 5, 10, 25];

/**
 * Crash.
 *
 * ## The game was a number that appeared
 *
 * Crash is a game ABOUT a rising number. The whole experience is watching it
 * climb past the point you could have taken and deciding, too late, that you
 * should have. The first version sent a bet and printed the crash point, which
 * is the result of a game of Crash without any of the game — the tension is
 * the animation, and there was no animation.
 *
 * So the curve is drawn and it climbs, in real time, from 1.00× to wherever
 * the server said it stopped. The player's cash-out is marked on the way up,
 * and the moment the curve crosses it is the moment they are paid.
 *
 * ## Nothing here decides anything
 *
 * The crash point arrives from the server before the first frame is drawn.
 * This is a replay of a settled round, not a simulation of a live one — which
 * is what makes it safe to animate at all. A client that computed the curve
 * would be a client that could choose where it stopped.
 */
export function CrashScreen() {
  const game = GAMES['crash']!;
  const state = useInstantGame(game);
  const [target, setTarget] = useState(2);
  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  // Sound and sparks together, on the frame the picture says so.
  const reveal = (round: RoundResponse | null) => {
    announce(round);
    celebrate(round);
  };

  const result = state.round?.state as { crashPoint: number; cashedOut: boolean } | undefined;
  const won = result?.cashedOut ?? false;

  const { value: live, running, run } = useClimb();

  const play = async () => {
    const round = await state.play({ type: 'set-target', target });
    const crashAt = (round?.state as { crashPoint: number } | undefined)?.crashPoint;
    // The fanfare fires when the curve STOPS, not when the answer arrives —
    // which on a 25x round is four seconds later. See useSettlementAnnouncer.
    if (crashAt) run(crashAt, target, () => reveal(round));
    else reveal(round);
  };

  // While it is climbing, the big number is the LIVE one; once it has stopped,
  // it is the crash point. They are the same number at rest, and the
  // distinction matters only for the instant the animation is catching up.
  const shown = running ? live : (result?.crashPoint ?? 1);

  return (
    <InstantLayout game={game} state={state}
      action={
          <PlayButton
            label={state.busy || running ? 'Climbing…' : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || running}
            colour={game.accent}
          />
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <View style={local.crashDeck}>
          <View>
            <Txt variant="caption" color="#D6B76B">AUTO CASH OUT</Txt>
            <Txt variant="bodySmall" color="#FFF0B4">{target.toFixed(2)}×</Txt>
          </View>
          <View style={local.crashStatus}>
            <Txt variant="caption" color={running ? '#A6FFD0' : result ? (won ? '#A6FFD0' : '#FFAAA1') : '#FFE6A0'}>
              {running ? 'ASCENDING' : result ? (won ? 'CASHED OUT' : 'FLIGHT LOST') : 'READY'}
            </Txt>
          </View>
        </View>
        <CrashFlight
          progress={Math.min(1, (shown - 1) / Math.max(0.6, target * 1.6 - 1))}
          accent={game.accent}
          crashed={!running && !!result && !won}
        />
        <Txt
          variant="h2"
          color={
            running
              ? game.accent
              : result
                ? won
                  ? colors.feedback.winBright
                  : colors.feedback.error
                : game.accent
          }
        >
          {shown.toFixed(2)}×
        </Txt>

        <Txt variant="caption" color={colors.text.muted}>
          CASH OUT AT
        </Txt>
        <TargetPicker values={CRASH_TARGETS} value={target} onChange={setTarget} colour={game.accent} />

        <View style={shell.result}>
          {running ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Climbing…
            </Txt>
          ) : result ? (
            won ? <View style={local.winReadout}>
              <Txt variant="caption" color="#B9FFD9">AUTO CASH OUT · {target.toFixed(2)}×</Txt>
              <Txt variant="display" color={colors.feedback.winBright}>{format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
              <Txt variant="bodySmall" color={colors.text.secondary}>The flight reached {result.crashPoint.toFixed(2)}×</Txt>
            </View> : <Txt variant="bodySmall" color={colors.text.muted}>
              Crashed at {result.crashPoint.toFixed(2)}× — you needed {target.toFixed(2)}×
            </Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              The curve stops somewhere. Cash out before it does.
            </Txt>
          )}
        </View>
      </Board>
    </InstantLayout>
  );
}

/**
 * The climb, on a clock rather than in one step.
 *
 * Multiplier growth is exponential in every version of this game, so the
 * animation is too: a linear ramp to 12× would crawl for four seconds and then
 * jump, which reads as a stutter rather than as acceleration. Time is capped
 * so a 300× round does not take a minute — past a point the player has the
 * message and is waiting for the payout.
 */
function useClimb() {
  const [value, setValue] = useState(1);
  const [running, setRunning] = useState(false);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const run = (crashPoint: number, target: number, onDone: () => void) => {
    cancelAnimationFrame(frame.current);
    if (reduced) {
      setValue(crashPoint);
      setRunning(false);
      onDone();
      return;
    }

    /*
     * Long enough to be watchable, short enough not to be a wait. A round that
     * crashes at 1.02× must still take a moment — an instant loss reads as the
     * button not having worked.
     */
    const seconds = Math.min(4.2, 0.9 + Math.log(crashPoint) * 1.15);
    const started = performance.now();
    // The tick fires as the number passes each whole multiple, so the climb is
    // audible as well as visible.
    let lastTick = 1;
    let cashed = false;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / (seconds * 1000));
      const current = 1 + (crashPoint - 1) * (t * t);
      setValue(current);

      if (Math.floor(current) > lastTick) {
        lastTick = Math.floor(current);
        sounds.tick();
      }
      // The payout lands as the curve crosses the line, not when it stops.
      if (!cashed && current >= target && crashPoint >= target) {
        cashed = true;
        sounds.coinLock();
      }

      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      setValue(crashPoint);
      setRunning(false);
      onDone();
    };

    setRunning(true);
    setValue(1);
    frame.current = requestAnimationFrame(tick);
  };

  return { value, running, run };
}

/**
 * The flight itself. The multiplier still climbs on the same honest clock, but
 * the player follows a physical craft through a light tunnel instead of a chart
 * line. That makes the moment read as a flight rather than a spreadsheet.
 */
function CrashFlight({
  progress,
  accent,
  crashed,
}: {
  progress: number;
  accent: string;
  crashed: boolean;
}) {
  const W = 292;
  const H = 126;
  const p = Math.max(0, Math.min(1, progress));
  const x = 30 + p * (W - 60);
  const y = H - 24 - Math.pow(p, 1.55) * (H - 52);
  const trailStart = Math.max(8, x - 78);
  const glow = crashed ? '#FF5C67' : accent;

  return (
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id="crash-thrust" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={glow} stopOpacity="0" />
          <Stop offset="0.78" stopColor={glow} stopOpacity="0.26" />
          <Stop offset="1" stopColor="#FFF5C8" stopOpacity="0.9" />
        </SvgLinearGradient>
      </Defs>
      {[22, 50, 78, 106].map((line) => <Path key={line} d={`M10,${line} L${W - 10},${line - 19}`} stroke="rgba(255,255,255,0.11)" strokeWidth={1} />)}
      {[46, 106, 166, 226].map((line) => <Circle key={line} cx={line} cy={25 + ((line / 9) % 30)} r={1.5} fill="rgba(255,242,190,0.56)" />)}
      {p > 0.01 ? <Path d={`M${trailStart},${y + 7} L${x - 7},${y + 3}`} stroke="url(#crash-thrust)" strokeWidth={13} strokeLinecap="round" /> : null}
      <Circle cx={x} cy={y} r={crashed ? 20 : 15} fill={glow} opacity={crashed ? 0.42 : 0.2} />
      <G transform={`translate(${x} ${y}) rotate(-23)`}>
        <Path d="M-24,0 L2,-12 L25,0 L2,12 Z" fill="#101D2D" stroke={glow} strokeWidth={2} />
        <Path d="M-12,0 L4,-6 L15,0 L4,6 Z" fill="#EAF9FF" opacity={crashed ? 0.45 : 0.92} />
        <Path d="M-2,-4 L-10,-16 L8,-6 Z M-2,4 L-10,16 L8,6 Z" fill={glow} opacity="0.9" />
        <Circle cx="16" cy="0" r="3" fill="#FFF6CA" />
      </G>
    </Svg>
  );
}

// ------------------------------------------------------------------- limbo

const LIMBO_TARGETS = [1.5, 2, 5, 10, 50, 100];

/**
 * Limbo.
 *
 * One number, drawn once. There is no journey to animate the way Crash has —
 * the result simply IS — so what is animated instead is the reveal: the digits
 * churn for a beat and settle, which is what a mechanical counter does and what
 * makes the number feel drawn rather than fetched.
 *
 * The churn is deliberately not a countdown to the answer. It scrambles, then
 * lands. A reel that visibly approaches its result tells the player the answer
 * before it arrives, and once they notice, every subsequent round is spoiled.
 */
export function LimboScreen() {
  const game = GAMES['limbo']!;
  const state = useInstantGame(game);
  const [target, setTarget] = useState(2);
  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  const reveal = (round: RoundResponse | null) => {
    announce(round);
    celebrate(round);
  };

  const result = state.round?.state as { result: number; won: boolean } | undefined;
  const { display, rolling, roll } = useNumberRoll(2, 1_450);

  const play = async () => {
    const round = await state.play({ type: 'set-target', target });
    const drawn = (round?.state as { result: number } | undefined)?.result;
    if (drawn !== undefined) roll(drawn, 100, () => reveal(round));
    else reveal(round);
  };

  const settled = !rolling && result;

  return (
    <InstantLayout game={game} state={state}
      action={
          <PlayButton
            label={state.busy || rolling ? 'Drawing…' : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || rolling}
            colour={game.accent}
          />
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <View style={local.limboHeader}>
          <View style={local.limboSeal}><Txt variant="caption" color="#B8FFFF">∞</Txt></View>
          <Txt variant="caption" color="#B8FFFF">QUANTUM VAULT DRAW</Txt>
          <View style={local.limboPulse} />
        </View>
        <Txt variant="caption" color={colors.text.muted}>
          YOU NEED
        </Txt>
        <Txt variant="h2" color={game.accent}>
          {target.toFixed(2)}× OR HIGHER
        </Txt>

        {/* The drawn number, at the largest size on the screen — it is the
            entire outcome, and it should be the entire focus. */}
        <View style={local.limboChamber}>
          <View style={local.limboOrbit} pointerEvents="none" />
          <View style={local.limboFace}>
            <View style={local.limboCut} pointerEvents="none" />
            <Txt
              variant="display"
              style={local.limboNumber}
              color={
                rolling
                  ? colors.text.primary
                  : settled
                    ? result!.won
                      ? colors.feedback.winBright
                      : colors.feedback.error
                    : colors.text.muted
              }
            >
              {result || rolling ? `${display.toFixed(2)}×` : '—'}
            </Txt>
          </View>
        </View>

        <TargetPicker values={LIMBO_TARGETS} value={target} onChange={setTarget} colour={game.accent} />

        <View style={shell.result}>
          {rolling ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Drawing…
            </Txt>
          ) : settled ? (
            result!.won ? <View style={local.winReadout}>
              <Txt variant="caption" color="#A8FFF5">TARGET CLEARED · {target.toFixed(2)}×</Txt>
              <Txt variant="h2" color={colors.feedback.winBright}>{format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
            </View> : <Txt variant="bodySmall" color={colors.text.muted}>Short of {target.toFixed(2)}×</Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Win if the number drawn is at least your target.
            </Txt>
          )}
        </View>
      </Board>
    </InstantLayout>
  );
}

/**
 * A number that churns and lands, like a mechanical counter.
 *
 * Shared by Limbo and Dice, which both have exactly one number as their whole
 * outcome. `ceiling` bounds the scramble so the digits look plausible for the
 * game: Limbo can draw anything upward, Dice only 0 to 99.99.
 */
function useNumberRoll(initial: number, duration = 900) {
  const [display, setDisplay] = useState(initial);
  const [rolling, setRolling] = useState(false);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const roll = (final: number, ceiling: number, onDone: () => void) => {
    cancelAnimationFrame(frame.current);
    if (reduced) {
      setDisplay(final);
      setRolling(false);
      onDone();
      return;
    }

    const started = performance.now();
    const DURATION = duration;
    let lastTick = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      if (t < 1) {
        /*
         * Random each frame, with the range narrowing as it slows. The
         * narrowing is what makes it feel like it is settling; the randomness
         * is what stops it from telegraphing the answer.
         */
        setDisplay(Math.random() * ceiling * (1 - t * 0.72) + final * t * 0.28);
        if (now - lastTick > 70) {
          lastTick = now;
          sounds.tick();
        }
        frame.current = requestAnimationFrame(tick);
        return;
      }
      setDisplay(final);
      setRolling(false);
      onDone();
    };

    setRolling(true);
    frame.current = requestAnimationFrame(tick);
  };

  return { display, rolling, roll };
}

// -------------------------------------------------------------------- dice

const DICE_TARGETS = [10, 25, 50, 75, 90];

export function DiceScreen() {
  const game = GAMES['dice']!;
  const state = useInstantGame(game);
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<'over' | 'under'>('over');
  const result = state.round?.state as
    | { roll: number; won: boolean; multiplier: number }
    | undefined;

  /**
   * The price of the bet, quoted before it is placed.
   *
   * Computed here rather than fetched because a player changing the target has
   * to see the payout move with it — a round trip per tap is not an option.
   * It is the same function the server settles with, so the number shown and
   * the number paid cannot disagree.
   *
   * Degenerate targets throw rather than returning a bad number, so the button
   * is disabled instead of quoting a bet that will be rejected.
   */
  const quote = useMemo(() => {
    try {
      return { multiplier: diceMultiplier(target, direction), legal: true };
    } catch {
      return { multiplier: DICE_MIN_MULTIPLIER, legal: false };
    }
  }, [target, direction]);

  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  const reveal = (round: RoundResponse | null) => {
    announce(round);
    celebrate(round);
  };
  const { display, rolling, roll } = useNumberRoll(50);

  const play = async () => {
    const round = await state.play({ type: 'roll', target, direction });
    const rolled = (round?.state as { roll: number } | undefined)?.roll;
    if (rolled !== undefined) roll(rolled, 100, () => reveal(round));
    else reveal(round);
  };

  const settled = !rolling && result;

  return (
    <InstantLayout game={game} state={state}
      action={
          <PlayButton
            label={state.busy || rolling ? 'Rolling…' : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || rolling || !quote.legal}
            colour={game.accent}
          />
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <View style={local.diceHeader}>
          <Txt variant="caption" color="#EEFFC3">CUT-GLASS DICE VAULT</Txt>
          <Txt variant="caption" color="#B7D95A">RISK INSTRUMENT</Txt>
        </View>
        {/*
          The track — the single most useful thing that was missing.

          UNDER 25 and OVER 90 are abstractions until you can see the winning
          band and where the roll landed relative to it. With the bar, the bet
          is legible at a glance: this much of the line wins, that much loses,
          and the marker is where it came in.
        */}
        <DiceTumbler accent={game.accent} rolling={rolling} />
        <DiceTrack
          target={target}
          direction={direction}
          accent={game.accent}
          roll={result || rolling ? display : null}
          won={settled ? result!.won : null}
        />

        <View style={local.row}>
          {(['under', 'over'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                sounds.tap();
                setDirection(option);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: direction === option }}
              style={[local.toggle, direction === option && { backgroundColor: game.accent }]}
            >
              <Txt
                variant="bodySmall"
                color={direction === option ? colors.surface.base : colors.text.secondary}
              >
                {option.toUpperCase()}
              </Txt>
            </Pressable>
          ))}
        </View>
        <TargetPicker values={DICE_TARGETS} value={target} onChange={setTarget} colour={game.accent} suffix="" />
        <Txt variant="bodySmall" color={colors.text.secondary}>
          {quote.legal
            ? `${direction.toUpperCase()} ${target} · pays ${quote.multiplier}×`
            : 'That bet pays too little to place'}
        </Txt>
        <View style={shell.result}>
          {rolling ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Rolling…
            </Txt>
          ) : settled ? (
            result!.won ? <View style={local.winReadout}>
              <Txt variant="caption" color="#E8FFC4">WINNING ROLL · {result!.roll.toFixed(2)}</Txt>
              <Txt variant="h2" color={colors.feedback.winBright}>{format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
            </View> : <Txt variant="bodySmall" color={colors.text.muted}>Rolled {result!.roll.toFixed(2)} — no win</Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Rolls 0.00 to 99.99.
            </Txt>
          )}
        </View>
      </Board>
    </InstantLayout>
  );
}

/**
 * The line, the winning band, and where the roll landed.
 *
 * The band is drawn in the accent and the losing side is left dark, so the
 * shape of the bet is the shape of the picture: choosing OVER 90 visibly
 * leaves you a sliver, which is the point that the payout figure alone does
 * not make.
 */
function DiceTrack({
  target,
  direction,
  accent,
  roll,
  won,
}: {
  target: number;
  direction: 'over' | 'under';
  accent: string;
  roll: number | null;
  won: boolean | null;
}) {
  const W = 264;
  const H = 34;
  const x = (value: number) => (value / 100) * W;
  const bandX = direction === 'under' ? 0 : x(target);
  const bandW = direction === 'under' ? x(target) : W - x(target);

  return (
    <Svg width={W} height={H + 18}>
      <Defs>
        <SvgLinearGradient id="dice-band" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity="0.85" />
          <Stop offset="1" stopColor={accent} stopOpacity="0.42" />
        </SvgLinearGradient>
      </Defs>

      <Rect x={0} y={0} width={W} height={H} rx={8} fill="rgba(255,255,255,0.06)" />
      <Rect x={bandX} y={0} width={bandW} height={H} rx={8} fill="url(#dice-band)" />
      {/* The line itself, so the boundary is exact rather than implied by the
          edge of a rounded rectangle. */}
      <Path d={`M${x(target)},0 L${x(target)},${H}`} stroke="#FFFFFF" strokeWidth={1.5} />

      {roll !== null ? (
        <>
          <Path
            d={`M${x(roll)},${H + 2} L${x(roll) - 5},${H + 14} L${x(roll) + 5},${H + 14} Z`}
            fill={won === null ? '#FFFFFF' : won ? colors.feedback.winBright : colors.feedback.error}
          />
          <Circle
            cx={x(roll)}
            cy={H / 2}
            r={5}
            fill={won === null ? '#FFFFFF' : won ? colors.feedback.winBright : colors.feedback.error}
            stroke="#05091A"
            strokeWidth={1.5}
          />
        </>
      ) : null}
    </Svg>
  );
}

/** A small cut-glass die makes Dice read as a table game before a number lands. */
function DiceTumbler({ accent, rolling }: { accent: string; rolling: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!rolling || reduced) {
      turn.setValue(0);
      return undefined;
    }
    // A slow, heavy tumble has anticipation. A 500ms spinner read as a loading
    // icon; this deliberately gives the die the movie-style hang time.
    const spin = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1280, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    spin.start();
    return () => spin.stop();
  }, [rolling, reduced, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={[local.diceTumbler, { borderColor: accent, transform: [{ rotate }] }]}>
      <LinearGradient colors={['#F9F5D5', '#D5B35B', '#60410D']} style={StyleSheet.absoluteFill} />
      <View style={local.dicePips} pointerEvents="none">
        {[0, 1, 2, 3, 4].map((pip) => <View key={pip} style={local.dicePip} />)}
      </View>
    </Animated.View>
  );
}

// ------------------------------------------------------------------ plinko

const RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];

/**
 * Vertical distance between peg rows.
 *
 * At 13 a sixteen-row board was 228 points tall on its own, which put the Drop
 * button below the fold. Ten still separates the rows clearly at a 4-point ball
 * and brings the whole game back onto one screen.
 */
const PEG_PITCH = 8;

export function PlinkoScreen() {
  const game = GAMES['plinko']!;
  const state = useInstantGame(game);
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  // The bucket values, known before the ball drops because they are a
  // property of the board rather than of the outcome.
  const table = useMemo(() => plinkoTable(rows, risk), [rows, risk]);
  const result = state.round?.state as
    | { path: ('L' | 'R')[]; bucket: number; multiplier: number }
    | undefined;

  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  const reveal = (round: RoundResponse | null) => {
    announce(round);
    celebrate(round);
  };
  const { step, dropping, drop } = useDrop();

  const play = async () => {
    const round = await state.play({ type: 'drop', rows, risk });
    const path = (round?.state as { path: ('L' | 'R')[] } | undefined)?.path;
    if (path) drop(path.length, () => reveal(round));
    else reveal(round);
  };

  // The bucket only lights up once the ball has arrived in it. Lighting it on
  // the response would answer the question the fall is asking.
  const landedBucket = !dropping && result ? result.bucket : null;
  const centrePayout = table[Math.floor(table.length / 2)] ?? 0;
  const edgePayout = Math.max(table[0] ?? 0, table[table.length - 1] ?? 0);

  return (
    <InstantLayout game={game} state={state}
      action={
          <PlayButton
            label={state.busy || dropping ? 'Dropping…' : `Drop ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || dropping}
            colour={game.accent}
          />
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <View style={local.plinkoHeader}>
          <Txt variant="caption" color="#FFE4FF">LUMEN PEG ARRAY</Txt>
          <Txt variant="caption" color="#F4A9FF">PATH RECORDER</Txt>
        </View>
        <PlinkoBoard
          rows={rows}
          path={result?.path}
          accent={game.accent}
          step={dropping ? step : result ? rows : 0}
        />
        <View style={local.buckets}>
          {table.map((_value, i) => (
            <View
              key={i}
              style={[
                local.bucket,
                landedBucket === i && { backgroundColor: game.accent },
              ]}
            >
              {landedBucket === i ? <View style={local.bucketLanded} /> : null}
            </View>
          ))}
        </View>
        <View style={local.payoutLegend}>
          <Txt variant="caption" color="#F3B6FF">EDGE {edgePayout}×</Txt>
          <Txt variant="caption" color="#E7D5EA">CENTER {centrePayout}×</Txt>
          <Txt variant="caption" color="#F3B6FF">EDGE {edgePayout}×</Txt>
        </View>
        <View style={local.row}>
          {PLINKO_ROWS.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                sounds.tap();
                setRows(option);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: rows === option }}
              style={[local.target, rows === option && { backgroundColor: game.accent }]}
            >
              <Txt
                variant="caption"
                color={rows === option ? colors.surface.base : colors.text.secondary}
              >
                {option}
              </Txt>
            </Pressable>
          ))}
        </View>
        <View style={local.row}>
          {RISKS.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                sounds.tap();
                setRisk(option);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: risk === option }}
              style={[local.toggle, risk === option && { backgroundColor: game.accent }]}
            >
              <Txt
                variant="caption"
                color={risk === option ? colors.surface.base : colors.text.secondary}
              >
                {option.toUpperCase()}
              </Txt>
            </Pressable>
          ))}
        </View>
        {dropping || result ? (
          <View style={shell.result}>
            {dropping ? (
              <Txt variant="bodySmall" color={colors.text.secondary}>
                Falling…
              </Txt>
            ) : (
              <Txt
                variant="h2"
                color={result!.multiplier >= 1 ? colors.feedback.winBright : colors.text.muted}
              >
                {result!.multiplier}× · {format(minor(state.round!.settlement?.payout ?? 0), 'GC')}
              </Txt>
            )}
          </View>
        ) : null}
      </Board>
    </InstantLayout>
  );
}

/**
 * The ball's fall, one peg at a time.
 *
 * Plinko is the only one of the five whose outcome has a SHAPE — a sequence of
 * bounces the engine already returns, bounce by bounce, precisely so it can be
 * watched. Drawing the whole polyline at once threw that away and showed the
 * player a diagram of a fall that never happened in front of them.
 *
 * Each step is a fixed 105ms rather than a smooth tween, because a real ball
 * hitting a peg is discrete: it is the tick-tick-tick that makes it Plinko,
 * and every step fires the peg sound.
 */
function useDrop() {
  const [step, setStep] = useState(0);
  const [dropping, setDropping] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const drop = (steps: number, onDone: () => void) => {
    if (timer.current) clearInterval(timer.current);
    if (reduced) {
      setStep(steps);
      setDropping(false);
      onDone();
      return;
    }
    setStep(0);
    setDropping(true);
    let at = 0;
    timer.current = setInterval(() => {
      at += 1;
      setStep(at);
      sounds.tick();
      if (at >= steps) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setDropping(false);
        onDone();
      }
    }, 105);
  };

  return { step, dropping, drop };
}

/**
 * The pegs, and the path the ball actually took.
 *
 * The path is drawn from the server's own left/right list rather than
 * simulated, so what the player watches is the round that was settled — which
 * is the whole reason the engine returns each bounce rather than just the
 * bucket.
 */
function PlinkoBoard({
  rows,
  path,
  accent,
  step,
}: {
  rows: number;
  path?: ('L' | 'R')[];
  accent: string;
  /** How many bounces have happened. The trail is drawn only this far. */
  step: number;
}) {
  const width = 300;
  const height = rows * PEG_PITCH + 20;
  const gap = width / (rows + 2);

  const pegs: { x: number; y: number; row: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      pegs.push({ x: width / 2 + (i - r / 2) * gap, y: 12 + r * PEG_PITCH, row: r });
    }
  }

  // The trail, truncated to where the ball has actually got to.
  const shown = path ? path.slice(0, Math.max(0, step)) : [];
  let trail = '';
  let ball: { x: number; y: number } | null = null;
  if (path && step > 0) {
    let x = width / 2;
    trail = `M ${x} 4`;
    for (let r = 0; r < shown.length; r++) {
      x += (shown[r] === 'R' ? 0.5 : -0.5) * gap;
      trail += ` L ${x} ${12 + r * PEG_PITCH}`;
    }
    ball = { x, y: 12 + (shown.length - 1) * PEG_PITCH };
  }

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="plinko-trail" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity="0.15" />
          <Stop offset="1" stopColor={accent} stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>

      {pegs.map((peg, i) => (
        <Circle
          key={i}
          cx={peg.x}
          cy={peg.y}
          // The row the ball is passing through lights up, so the eye has
          // somewhere to be during the fall rather than hunting for the ball.
          r={ball && peg.row === shown.length - 1 ? 2.6 : 1.8}
          fill={ball && peg.row === shown.length - 1 ? '#FFF5C2' : '#C99A37'}
          opacity={ball && peg.row === shown.length - 1 ? 1 : 0.78}
        />
      ))}
      {trail ? (
        <Path d={trail} stroke="url(#plinko-trail)" strokeWidth={2} fill="none" strokeLinecap="round" />
      ) : null}
      {ball ? (
        <>
          <Circle cx={ball.x} cy={ball.y} r={7} fill={accent} opacity={0.28} />
          <Circle cx={ball.x} cy={ball.y} r={4} fill="#FFFFFF" />
        </>
      ) : null}
    </Svg>
  );
}

// ------------------------------------------------------------------- mines

const MINE_COUNTS = [1, 3, 5, 10, 24];

export function MinesScreen() {
  const game = GAMES['mines']!;
  const state = useInstantGame(game);
  const [mines, setMines] = useState(3);

  const board = state.round?.state as
    | {
        revealed: number[];
        multiplier: number;
        nextMultiplier: number;
        minePositions: number[];
        bust: boolean;
      }
    | undefined;
  const open = state.round?.status === 'awaiting-action';
  const settled = state.round?.status === 'settled';

  const tileState = (tile: number): 'hidden' | 'safe' | 'mine' => {
    if (!board) return 'hidden';
    if (board.revealed.includes(tile)) return 'safe';
    if (board.minePositions.includes(tile)) return 'mine';
    return 'hidden';
  };

  /*
   * Mines is the one game that can announce immediately: the tile turns over in
   * the same frame the response lands, so there is no gap for a sound to fall
   * into ahead of the picture.
   */
  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  useEffect(() => {
    if (state.round?.status !== 'settled') return;
    announce(state.round);
    celebrate(state.round);
  }, [state.round, announce, celebrate]);

  /**
   * A safe tile and a mine must not sound the same.
   *
   * The settlement sound covers the END of the round, but the tension in Mines
   * is per TILE — each pick is its own small moment, and eight of them in a row
   * with no feedback is the game's whole middle happening in silence.
   */
  const revealCount = board?.revealed.length ?? 0;
  const lastReveal = useRef(0);
  useEffect(() => {
    if (revealCount > lastReveal.current) sounds.coinLock();
    lastReveal.current = revealCount;
  }, [revealCount]);

  const bust = board?.bust ?? false;
  const bustedOnce = useRef(false);
  useEffect(() => {
    if (bust && !bustedOnce.current) {
      bustedOnce.current = true;
      sounds.error();
    }
    if (!bust) bustedOnce.current = false;
  }, [bust]);

  return (
    <InstantLayout game={game} state={state} stakeLocked={open}
      action={
        open ? (
          <PlayButton
            label={
              board!.multiplier > 0
                ? `Cash out ${board!.multiplier}×`
                : 'Pick a tile to start'
            }
            onPress={() => void state.act({ type: 'cashout' })}
            disabled={state.busy || board!.multiplier === 0}
            colour={game.accent}
          />
        ) : (
          <PlayButton
            label={state.busy ? 'Dealing…' : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void state.play({ type: 'configure', mines })}
            disabled={state.busy}
            colour={game.accent}
          />
        )
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <View style={local.minesHeader}>
          <View style={local.minesIndicator} />
          <Txt variant="caption" color="#C6F7FF">DEEP VAULT · CLEAR THE GRID</Txt>
          <Txt variant="caption" color="#71DFFF">{open ? 'ARMED' : 'STANDBY'}</Txt>
        </View>
        <View style={local.grid}>
          {Array.from({ length: MINES_TILES }, (_, tile) => (
            <MineTile
              key={tile}
              index={tile}
              status={tileState(tile)}
              accent={game.accent}
              disabled={!open || state.busy || tileState(tile) !== 'hidden'}
              onPress={() => state.act({ type: 'reveal', tile })}
            />
          ))}
        </View>

        {open ? (
          <Txt variant="bodySmall" color={colors.text.secondary}>
            {board!.multiplier > 0
              ? `Cash out at ${board!.multiplier}× · next ${board!.nextMultiplier}×`
              : `First pick pays ${board!.nextMultiplier}×`}
          </Txt>
        ) : (
          <>
            {/*
              No "MINES" caption above the picker.

              The line underneath already names what the number means, and on
              the tallest board in the app a redundant label costs twenty
              points that the Bet button needs. A caption that repeats the
              sentence below it is the first thing to go.
            */}
            <TargetPicker
              values={MINE_COUNTS}
              value={mines}
              onChange={setMines}
              colour={game.accent}
              suffix=""
            />
            <Txt variant="bodySmall" color={colors.text.secondary}>
              {mines} {mines === 1 ? 'mine' : 'mines'} · first pick pays{' '}
              {minesMultiplier(mines, 1)}×
            </Txt>
          </>
        )}

        {/* Rendered only when there is something to say. Everywhere else in
            the other instant games the readout carries a hint line and so reserving its
            height prevents a jump; here it is empty until the round ends, so
            reserving it was fifty points of nothing on the tallest board in
            the app. */}
        {settled ? (
          <View style={shell.result}>
            <Txt
              variant="h2"
              color={board?.bust ? colors.feedback.error : colors.feedback.winBright}
            >
              {board?.bust
                ? 'Hit a mine'
                : format(minor(state.round!.settlement?.payout ?? 0), 'GC')}
            </Txt>
          </View>
        ) : null}
      </Board>
    </InstantLayout>
  );
}

// ------------------------------------------------------------- golden scratch

/** A real card game, not the old disabled lobby tile. Outcome is server-settled; tapping only reveals it. */
export function GoldenScratchScreen() {
  const game = GAMES['scratch']!;
  const state = useInstantGame(game);
  const [revealed, setRevealed] = useState(false);
  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  const ticket = state.round?.state as { multiplier: number; prizes: readonly number[] } | undefined;
  const needsReveal = !!ticket && !revealed;

  const buy = async () => {
    setRevealed(false);
    await state.play({ type: 'buy-card' });
  };
  const reveal = () => {
    if (!ticket || revealed) return;
    setRevealed(true);
    sounds.coinLock();
    announce(state.round);
    celebrate(state.round);
  };

  return (
    <InstantLayout
      game={game}
      state={state}
      action={
        !needsReveal ? <PlayButton
          label={state.busy ? 'Minting card…' : `Buy card · ${format(state.bet, 'GC')}`}
          onPress={() => void buy()}
          disabled={state.busy}
          colour={game.accent}
        /> : undefined
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <Txt variant="caption" color="#FFE8A6">GOLDEN SCRATCH</Txt>
        <ScratchCard ticket={ticket} ticketId={state.round?.roundId} revealed={revealed} onReveal={reveal} />
        <View style={shell.result}>
          {!ticket ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>Buy a card, then drag across the foil to reveal it.</Txt>
          ) : !revealed ? (
            <Txt variant="bodySmall" color="#FFE8A6">Match all 3 prize windows to win. Drag across the gold foil.</Txt>
          ) : (
            <Txt variant="h2" color={ticket.multiplier > 0 ? colors.feedback.winBright : colors.feedback.error}>
              {ticket.multiplier > 0 ? `${ticket.multiplier}× · ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}` : 'No prize this card'}
            </Txt>
          )}
        </View>
      </Board>
    </InstantLayout>
  );
}

function ScratchCard({
  ticket,
  ticketId,
  revealed,
  onReveal,
}: {
  ticket?: { multiplier: number; prizes: readonly number[] };
  ticketId?: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  // This is deliberately stroke based instead of a sequence of taps. Safari
  // synthesises a click late, which made the former ticket feel like a button
  // that happened to be labelled "scratch". Here finger travel progressively
  // tears away visible foil strips; a short press still starts the reveal for
  // keyboard and mouse users.
  const [scratched, setScratched] = useState(0);
  const announced = useRef(false);
  const lastScrubDistance = useRef(0);
  const lastScratchAt = useRef(0);

  useEffect(() => {
    setScratched(0);
    announced.current = false;
    lastScrubDistance.current = 0;
  }, [ticketId]);

  useEffect(() => {
    if (scratched < 6 || announced.current) return;
    announced.current = true;
    onReveal();
  }, [scratched, onReveal]);

  const scratchNext = () => {
    if (!ticket || revealed) return;
    const now = Date.now();
    // Pressable and PanResponder both receive a touch-down on web. Treat that
    // as one scrape, not two, while still accepting successive motion strokes.
    if (now - lastScratchAt.current < 70) return;
    lastScratchAt.current = now;
    sounds.coinLock();
    setScratched((current) => Math.min(6, current + 1));
  };

  const scratchPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!ticket && !revealed,
        onStartShouldSetPanResponderCapture: () => !!ticket && !revealed,
        onMoveShouldSetPanResponder: () => !!ticket && !revealed,
        onMoveShouldSetPanResponderCapture: () => !!ticket && !revealed,
        onPanResponderGrant: () => {
          lastScrubDistance.current = 0;
        },
        onPanResponderMove: (_event, gesture) => {
          const distance = Math.abs(gesture.dx) + Math.abs(gesture.dy);
          // Each 34pt of finger travel removes another physical foil strip.
          // That makes a long drag materially different from tapping.
          if (distance - lastScrubDistance.current >= 34) {
            lastScrubDistance.current = distance;
            scratchNext();
          }
        },
        // The scratch surface owns the drag. Without this, Safari hands a
        // vertical stroke to the page and the player scrolls instead of
        // scraping the foil.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [ticket, revealed],
  );

  const prizes = ticket?.prizes ?? [0, 0, 0];
  return (
    <Pressable
      style={local.scratchCard}
      disabled={!ticket || revealed}
      {...scratchPan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Prize revealed' : `Scratch gold foil, ${Math.max(0, 6 - scratched)} rubs remaining`}
    >
      <LinearGradient colors={['#FFF4BE', '#C98B16', '#4A1607']} style={StyleSheet.absoluteFill} />
      <View style={local.scratchInner}>
        {prizes.map((prize, index) => {
          const stripStart = index * 2;
          const uncovered = revealed || scratched >= stripStart + 2;
          const foilRemaining = Math.max(0, Math.min(2, stripStart + 2 - scratched));
          return (
            <View key={index} style={local.scratchPrize}>
              <Txt variant="h2" color="#2B1605">{uncovered ? (prize > 0 ? `${prize}×` : '—') : '✦'}</Txt>
              {!uncovered ? (
                <View pointerEvents="none" style={local.scratchFoil}>
                  <LinearGradient colors={['#FFF4B5', '#D7961A', '#7A3007']} style={StyleSheet.absoluteFill} />
                  <View style={local.scratchGrain}>
                    {Array.from({ length: foilRemaining * 4 }, (_, grain) => (
                      <View key={grain} style={[local.scratchFlake, { transform: [{ rotate: `${grain % 2 ? -18 : 22}deg` }] }]} />
                    ))}
                  </View>
                  <Txt variant="caption" color="#FFF8D9">SCRATCH</Txt>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {!revealed ? <Txt variant="caption" color="#FFF6CF">DRAG ACROSS THE FOIL · {Math.max(0, 6 - scratched)} SCRAPES LEFT</Txt> : null}
    </Pressable>
  );
}

/**
 * One tile, which turns over rather than changing colour.
 *
 * A tile that simply recolours gives no sense of having been OPENED, and Mines
 * is a game of opening things. The flip is a fast scale-down and back, which is
 * what a card being turned looks like head-on and is legible at 48 points where
 * a real 3D rotation would just read as a flicker.
 *
 * A mine also shakes. Losing eight tiles of accumulated multiplier deserves
 * more than a colour change, and the shake is the only moment in these
 * games where the screen itself reacts.
 */
function MineTile({
  index,
  status,
  accent,
  disabled,
  onPress,
}: {
  index: number;
  status: 'hidden' | 'safe' | 'mine';
  accent: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const flip = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const blast = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === 'hidden' || reduced) {
      flip.setValue(0);
      return;
    }
    flip.setValue(0);
    Animated.sequence([
      Animated.timing(flip, { toValue: 1, duration: 110, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(flip, { toValue: 0, duration: 170, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
    ]).start();

    if (status === 'mine') {
      blast.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
      Animated.sequence([
        Animated.timing(blast, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(blast, { toValue: 0, duration: 650, useNativeDriver: true }),
      ]).start();
    }
  }, [status, reduced, flip, shake, blast]);

  // Squashes towards zero width at the midpoint — the read of a card turning.
  const scaleX = flip.interpolate({ inputRange: [0, 1], outputRange: [1, 0.08] });
  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] });

  return (
    <Animated.View style={{ transform: [{ scaleX }, { translateX }] }}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Tile ${index + 1}`}
        style={({ pressed }) => [
          local.tile,
          status === 'safe' && { borderColor: '#E9FBFF' },
          status === 'mine' && { borderColor: '#FFD0D0' },
          pressed && status === 'hidden' && local.tilePressed,
        ]}
      >
        <LinearGradient
          colors={
            status === 'safe'
              ? ['#E7FFFF', accent, '#075A70']
              : status === 'mine'
                ? ['#FFB2A8', '#D63838', '#560812']
                : ['#18374A', '#0B1B28', '#040A10']
          }
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* The lit face, so an unopened tile is a moulded object rather than a
            grey square — the same treatment the roulette felt cells get. */}
        <View style={local.tileGloss} pointerEvents="none" />
        {status === 'mine' ? <>
          <Animated.View pointerEvents="none" style={[local.mineBlast, { opacity: blast, transform: [{ scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.25, 2.5] }) }] }]} />
          <View pointerEvents="none" style={local.mineCore} />
        </> : null}
        <Txt variant="bodySmall" color={colors.surface.base}>
          {status === 'safe' ? '◆' : status === 'mine' ? '✱' : ' '}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  winReadout: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  targets: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  target: {
    minHeight: 44,
    minWidth: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  toggle: {
    minHeight: 44,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  // Seventeen buckets have to fit the width of a phone at sixteen rows, so
  // they share it rather than each claiming a minimum. With a minimum they
  // wrapped onto a second line, which put the left half of the board's payouts
  // underneath the right half.
  buckets: { flexDirection: 'row', gap: 2, alignSelf: 'stretch', paddingHorizontal: 3 },
  bucket: {
    flex: 1,
    height: 16,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.11)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bucketLanded: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFF6D0', shadowColor: '#FFF6D0', shadowOpacity: 1, shadowRadius: 6 },
  payoutLegend: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, width: 5 * 44, justifyContent: 'center' },
  tile: {
    // 40, not 48: five rows of tiles is the tallest single element in these
    // games, and every point a row buys back five overall — which is what
    // brings the Bet button back onto a 700-point screen.
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: '#081522',
    borderWidth: 1,
    borderColor: '#497184',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tilePressed: { backgroundColor: colors.surface.raised },
  tileGloss: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '48%',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  mineBlast: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFEF88', shadowColor: '#FF4D21', shadowOpacity: 1, shadowRadius: 16 },
  mineCore: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFEF88', shadowColor: '#FF4D21', shadowOpacity: 1, shadowRadius: 10 },
  /** The drawn number in Limbo, given fixed height so the panel cannot jump. */
  limboFace: {
    minHeight: 112,
    minWidth: 264,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#4EDDE2',
    backgroundColor: 'rgba(2, 18, 24, 0.72)',
    overflow: 'hidden',
  },
  limboChamber: { width: '100%', minHeight: 134, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(78,221,226,0.28)', backgroundColor: 'rgba(0,11,20,0.38)', overflow: 'hidden' },
  limboOrbit: { position: 'absolute', width: 244, height: 74, borderRadius: 122, borderWidth: 1, borderColor: 'rgba(94,234,212,0.38)', transform: [{ rotate: '-12deg' }] },
  limboNumber: { fontSize: 52, lineHeight: 60, textShadowColor: 'rgba(78,221,226,0.5)', textShadowRadius: 18 },
  limboCut: {
    position: 'absolute',
    left: -48,
    top: -14,
    width: 108,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    transform: [{ rotate: '-20deg' }],
  },
  diceTumbler: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dicePips: { width: 31, height: 31, flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center', alignItems: 'center' },
  dicePip: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#271709' },
  crashDeck: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: 'rgba(244,190,78,0.28)' },
  crashStatus: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(248,201,90,0.52)', backgroundColor: 'rgba(19,8,3,0.56)' },
  limboHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(111,240,244,0.65)', backgroundColor: 'rgba(1,19,29,0.72)' },
  limboSeal: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#67E8F9' },
  limboPulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EEAD4', shadowColor: '#5EEAD4', shadowOpacity: 1, shadowRadius: 7 },
  diceHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(215,249,157,0.3)', paddingBottom: 5 },
  plinkoHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(245,183,255,0.34)', paddingBottom: 5 },
  minesHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  minesIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#79E7FF', shadowColor: '#79E7FF', shadowOpacity: 1, shadowRadius: 8 },
  scratchCard: {
    width: 282,
    height: 138,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: '#FFE7A1',
    overflow: 'hidden',
    justifyContent: 'center',
    shadowColor: '#F6C84C',
    shadowOpacity: 0.62,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  scratchInner: { flexDirection: 'row', gap: spacing.xs, padding: spacing.md },
  scratchPrize: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(82,35,4,0.58)',
    backgroundColor: 'rgba(255,247,209,0.72)',
    overflow: 'hidden',
  },
  scratchFoil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFF0A0',
  },
  scratchGrain: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    padding: 8,
    opacity: 0.72,
  },
  scratchFlake: { width: 24, height: 2, borderRadius: 2, backgroundColor: 'rgba(76, 28, 4, 0.58)' },
});
