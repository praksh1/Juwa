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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Mask,
  Path,
  Polygon,
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
import { isIos } from '../../pwa';

const GAMES: Record<string, InstantGame> = {
  crash: { id: 'juwa-crash', name: 'Crash', minBet: 50, maxBet: 500_000, accent: '#F59E0B', cabinet: 'crash' },
  limbo: { id: 'juwa-limbo', name: 'Limbo', minBet: 50, maxBet: 500_000, accent: '#2DD4BF', cabinet: 'limbo' },
  dice: { id: 'juwa-dice', name: 'Dice', minBet: 50, maxBet: 500_000, accent: '#A3E635', cabinet: 'dice' },
  plinko: { id: 'juwa-plinko', name: 'Plinko', minBet: 50, maxBet: 500_000, accent: '#E879F9', cabinet: 'plinko' },
  mines: { id: 'juwa-mines', name: 'Mines', minBet: 50, maxBet: 500_000, accent: '#38BDF8', cabinet: 'mines' },
  scratch: { id: 'juwa-scratch', name: 'Golden Scratch', minBet: 100, maxBet: 10_000, accent: '#F6C84C', cabinet: 'scratch' },
};

/**
 * Safari's smaller-page control fixes these tall stages by changing the whole
 * CSS viewport, not merely their lettering. Reproduce only the small amount of
 * vertical density it buys on an iPhone at Safari's default scale.
 */
function useTightIphoneStage(): boolean {
  const { width } = useWindowDimensions();
  return isIos() && width <= 410;
}

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
  const tightIphoneStage = useTightIphoneStage();
  // Sound and sparks together, on the frame the picture says so.
  const reveal = (round: RoundResponse | null) => {
    state.reveal(round);
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
    <InstantLayout game={game} state={state} pinHeader
      dockControl={<DockChoices choices={CRASH_TARGETS.map((option) => ({ key: `${option}`, label: `${option}×`, selected: option === target, onPress: () => setTarget(option), colour: game.accent }))} />}
      action={
          <PlayButton
            label={state.busy || running
              ? 'Climbing…'
              : result
                ? won
                  ? `${result.crashPoint.toFixed(2)}× · WON ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                  : `${result.crashPoint.toFixed(2)}× · BET AGAIN`
                : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || running}
            colour={game.accent}
          />
      }
    >
      <Board
        accent={game.accent}
        celebrate={handle}
        cabinet={game.cabinet}
        bodyStyle={tightIphoneStage && local.tightIphoneGameBody}
      >
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
          running={running}
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

        <View style={[shell.result, tightIphoneStage && local.tightIphoneCrashResult]}>
          {running ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Climbing…
            </Txt>
          ) : result ? (
            won ? tightIphoneStage ? <Txt variant="bodySmall" color={colors.feedback.winBright} numberOfLines={1}>
              WON {format(minor(state.round!.settlement?.payout ?? 0), 'GC')} · CASHED OUT AT {target.toFixed(2)}×
            </Txt> : <View style={local.winReadout}>
              <Txt variant="caption" color="#B9FFD9">AUTO CASH OUT · {target.toFixed(2)}×</Txt>
              <Txt variant="display" color={colors.feedback.winBright}>WON {format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
              <Txt variant="bodySmall" color={colors.text.secondary}>The flight reached {result.crashPoint.toFixed(2)}×</Txt>
            </View> : <Txt variant="bodySmall" color={colors.text.muted} numberOfLines={tightIphoneStage ? 1 : undefined}>
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
 * the player follows the same polished craft shown in Crash's lobby tile over
 * a live telemetry graph. The graph is a record of WHERE the craft has flown,
 * not a decorative line floating without a job.
 */
function CrashFlight({
  progress,
  accent,
  crashed,
  running,
}: {
  progress: number;
  accent: string;
  crashed: boolean;
  running: boolean;
}) {
  const W = 292;
  const H = 126;
  const p = Math.max(0, Math.min(1, progress));
  const x = 30 + p * (W - 60);
  const y = H - 24 - Math.pow(p, 1.55) * (H - 52);
  const trailStart = Math.max(8, x - 78);
  const glow = crashed ? '#FF5C67' : accent;

  return (
    <View style={local.crashFlightStage}>
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id="crash-thrust" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={glow} stopOpacity="0" />
          <Stop offset="0.78" stopColor={glow} stopOpacity="0.26" />
          <Stop offset="1" stopColor="#FFF5C8" stopOpacity="0.9" />
        </SvgLinearGradient>
      </Defs>
      {[30, 58, 86, 114].map((line) => <Path key={line} d={`M10,${line} L${W - 10},${line}`} stroke="rgba(255,230,170,0.10)" strokeWidth={1} />)}
      {[42, 94, 146, 198, 250].map((line) => <Path key={line} d={`M${line},14 L${line},${H - 12}`} stroke="rgba(255,230,170,0.07)" strokeWidth={1} />)}
      {p > 0.01 ? <Path d={`M14,${H - 24} Q${x * 0.62},${H - 22} ${x - 10},${y + 7}`} stroke="url(#crash-thrust)" strokeWidth={crashed ? 16 : 12} strokeLinecap="round" /> : null}
      <Circle cx={x} cy={y} r={crashed ? 24 : 18} fill={glow} opacity={crashed ? 0.44 : 0.2} />
    </Svg>
    <Image
      source={{ uri: '/art/overlays/crash-aircraft-stage-v1.png' }}
      resizeMode="contain"
      style={[local.crashAircraft, { left: x - 67, top: y - 47, opacity: crashed ? 0.42 : 1 }]}
      accessibilityElementsHidden
    />
    {running ? <CrashExhaust x={x} y={y} /> : null}
    </View>
  );
}

/** Layered blue-core/orange-tail exhaust that keeps burning at the ceiling. */
function CrashExhaust({ x, y }: { x: number; y: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 95, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const stretch = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.28] });
  return <Animated.View pointerEvents="none" style={[local.crashExhaust, { left: x - 69, top: y + 12, transform: [{ rotate: '-22deg' }, { scaleX: stretch }] }]}>
    <LinearGradient colors={['#E9FFFF', '#56D9FF', '#FFB137', 'rgba(255,65,24,0)']} start={{ x: 1, y: .5 }} end={{ x: 0, y: .5 }} style={StyleSheet.absoluteFill} />
    <View style={local.crashExhaustCore} />
  </Animated.View>;
}

/** One-height choice rail that remains pinned beside the stake/action dock. */
function DockChoices({
  choices,
}: {
  choices: { key: string; label: string; selected: boolean; onPress: () => void; colour: string }[];
}) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.dockChoices}>
    {choices.map((choice) => <Pressable
      key={choice.key}
      onPress={() => { sounds.tap(); choice.onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ selected: choice.selected }}
      style={[local.dockChoice, choice.selected && { backgroundColor: choice.colour, borderColor: choice.colour }]}
    >
      <Txt variant="caption" color={choice.selected ? colors.surface.base : colors.text.secondary}>{choice.label}</Txt>
    </Pressable>)}
  </ScrollView>;
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
    state.reveal(round);
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
      dockControl={<DockChoices choices={LIMBO_TARGETS.map((option) => ({ key: `${option}`, label: `${option}×`, selected: option === target, onPress: () => setTarget(option), colour: game.accent }))} />}
      action={
          <PlayButton
            label={state.busy || rolling
              ? 'Drawing…'
              : settled
                ? result!.won
                  ? `${result!.result.toFixed(2)}× · WON ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                  : `${result!.result.toFixed(2)}× · BET AGAIN`
                : `Bet ${format(state.bet, 'GC')}`}
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

        <View style={shell.result}>
          {rolling ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Drawing…
            </Txt>
          ) : settled ? (
            result!.won ? <View style={local.winReadout}>
              <Txt variant="caption" color="#A8FFF5">TARGET CLEARED · {target.toFixed(2)}×</Txt>
              <Txt variant="h2" color={colors.feedback.winBright}>WON {format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
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
  const { width: viewportWidth } = useWindowDimensions();
  const wideStage = viewportWidth >= 760;
  const diceDialSize = wideStage
    ? 168
    : Math.min(168, Math.max(144, (viewportWidth - 60) * 0.52));
  const diceVaultWidth = wideStage
    ? 280
    : Math.min(132, Math.max(106, viewportWidth - 60 - diceDialSize - spacing.xs));
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
    state.reveal(round);
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
      dockControl={<DockChoices choices={[
        ...(['under', 'over'] as const).map((option) => ({ key: option, label: option.toUpperCase(), selected: option === direction, onPress: () => setDirection(option), colour: game.accent })),
        ...DICE_TARGETS.map((option) => ({ key: `${option}`, label: `${option}`, selected: option === target, onPress: () => setTarget(option), colour: game.accent })),
      ]} />}
      action={
          <PlayButton
            label={state.busy || rolling
              ? 'Rolling…'
              : settled
                ? result!.won
                  ? `${result!.roll.toFixed(2)} · WON ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                  : `${result!.roll.toFixed(2)} · BET AGAIN`
                : `Bet ${format(state.bet, 'GC')}`}
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
        {/* The risk is now a dimensional dial: the active arc says exactly
            which part of the 0–100 space wins without reverting to an old
            spreadsheet-like progress bar. */}
        <View style={local.diceStage}>
          <DiceVault
            accent={game.accent}
            rolling={rolling}
            value={result || rolling ? display : null}
            wide={wideStage}
            compact={!wideStage}
            width={diceVaultWidth}
          />
          <DiceDial
            target={target}
            direction={direction}
            accent={game.accent}
            roll={result || rolling ? display : null}
            won={settled ? result!.won : null}
            size={diceDialSize}
          />
        </View>
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
              <Txt variant="h2" color={colors.feedback.winBright}>WON {format(minor(state.round!.settlement?.payout ?? 0), 'GC')}</Txt>
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
 * The target instrument.
 *
 * A physical game needs a physical-looking control.  This deliberately uses
 * one thick lit arc and an exact moving needle instead of the former flat
 * horizontal progress bar, while still making the win region auditable.
 */
function DiceDial({
  target,
  direction,
  accent,
  roll,
  won,
  size = 168,
}: {
  target: number;
  direction: 'over' | 'under';
  accent: string;
  roll: number | null;
  won: boolean | null;
  size?: number;
}) {
  const c = size / 2;
  const r = size * 0.351;
  const point = (value: number, radius = r) => {
    const degrees = 135 + (value / 100) * 270;
    const angle = (degrees * Math.PI) / 180;
    return { x: c + Math.cos(angle) * radius, y: c + Math.sin(angle) * radius };
  };
  const arc = (from: number, to: number) => {
    const start = point(from);
    const end = point(to);
    const large = to - from > 50 ? 1 : 0;
    return `M${start.x},${start.y} A${r},${r} 0 ${large} 1 ${end.x},${end.y}`;
  };
  const winningFrom = direction === 'under' ? 0 : target;
  const winningTo = direction === 'under' ? target : 100;
  const targetPoint = point(target);
  const rollPoint = roll === null ? null : point(roll, r - 10);

  return (
    <View style={[local.diceDialShell, { width: size, height: size, borderRadius: size / 2 }]}>
    <Svg width={size} height={size}>
      <Defs>
        <SvgLinearGradient id="dice-band" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity="0.85" />
          <Stop offset="1" stopColor="#ECFCCB" stopOpacity="0.98" />
        </SvgLinearGradient>
      </Defs>
      <Circle cx={c} cy={c} r={r} fill="rgba(2,13,8,0.55)" stroke="rgba(221,255,165,0.13)" strokeWidth={18} />
      <Path d={arc(0, 100)} fill="none" stroke="rgba(8,22,12,0.86)" strokeWidth={12} strokeLinecap="round" />
      <Path d={arc(winningFrom, winningTo)} fill="none" stroke="url(#dice-band)" strokeWidth={12} strokeLinecap="round" />
      <Circle cx={c} cy={c} r={size * 0.238} fill="rgba(4,23,10,0.88)" stroke="rgba(224,255,185,0.3)" strokeWidth={1} />
      <Circle cx={targetPoint.x} cy={targetPoint.y} r={5} fill="#FFFBD2" stroke={accent} strokeWidth={2} />
      {rollPoint ? <>
        <Path d={`M${c},${c} L${rollPoint.x},${rollPoint.y}`} stroke={won === null ? '#FFFFFF' : won ? colors.feedback.winBright : colors.feedback.error} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={rollPoint.x} cy={rollPoint.y} r={5} fill={won === null ? '#FFFFFF' : won ? colors.feedback.winBright : colors.feedback.error} stroke="#07140A" strokeWidth={2} />
      </> : null}
    </Svg>
    <View pointerEvents="none" style={local.diceDialReadout}>
      <Txt variant="caption" color="#D8F7B6">{direction.toUpperCase()}</Txt>
      <Txt variant="h2" color="#F3FFE2">{target}</Txt>
      <Txt variant="caption" color="#BBD19F">TARGET</Txt>
    </View>
    </View>
  );
}

/** A glass vault that brings the lobby tile's cut-crystal dice into the game. */
function DiceVault({
  accent,
  rolling,
  value,
  wide = false,
  compact = false,
  width,
}: {
  accent: string;
  rolling: boolean;
  value: number | null;
  wide?: boolean;
  compact?: boolean;
  width?: number;
}) {
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
  return <View style={[local.diceVault, wide && local.diceVaultWide, compact && local.diceVaultCompact, width ? { width } : null]}>
    <Image source={{ uri: '/art/tiles/juwa-dice.png' }} resizeMode="cover" style={StyleSheet.absoluteFill} />
    <LinearGradient colors={['rgba(1,13,2,0.18)', 'rgba(1,8,2,0.54)']} style={StyleSheet.absoluteFill} />
    <View style={local.diceVaultLabel}><Txt variant="caption" color="#E8FFC4">{compact ? 'CRYSTAL DICE' : 'CRYSTAL ROLL CHAMBER'}</Txt></View>
    <Animated.View style={[local.diceCrystal, compact ? local.diceCrystalCompactFirst : local.diceCrystalRear, compact && local.diceCrystalCompact, { borderColor: accent, transform: [{ rotate: rotate }, { rotateX: '16deg' }] }]}>
      <LinearGradient colors={['rgba(210,255,137,0.92)', 'rgba(16,111,44,0.78)', 'rgba(2,27,11,0.94)']} style={StyleSheet.absoluteFill} />
      <View style={local.dicePips} pointerEvents="none">{[0, 1, 2, 3].map((pip) => <View key={pip} style={local.dicePip} />)}</View>
    </Animated.View>
    <Animated.View style={[local.diceCrystal, compact && local.diceCrystalCompact, compact && local.diceCrystalCompactSecond, { borderColor: '#E8FFC4', transform: [{ rotate: rotate }, { rotateY: '18deg' }] }]}>
      <LinearGradient colors={['#F4FFD7', '#42C76B', '#073E1A']} style={StyleSheet.absoluteFill} />
      <View style={local.dicePips} pointerEvents="none">{[0, 1, 2, 3, 4].map((pip) => <View key={pip} style={local.dicePip} />)}</View>
    </Animated.View>
    <View style={[local.diceRollReadout, compact && local.diceRollReadoutCompact]}>
      <Txt variant={compact ? 'body' : 'h2'} color="#F4FFD7">{value === null ? 'READY' : value.toFixed(2)}</Txt>
      {!compact ? <Txt variant="caption" color="#C3F78E">ROLL INDEX</Txt> : null}
    </View>
  </View>;
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
  const { width: viewportWidth } = useWindowDimensions();
  const tightIphoneStage = useTightIphoneStage();
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [revealedRoundId, setRevealedRoundId] = useState<string | null>(null);
  const result = state.round?.state as
    | { path: ('L' | 'R')[]; bucket: number; multiplier: number }
    | undefined;

  const announce = useSettlementAnnouncer();
  const { handle, celebrate } = useCelebration();
  const reveal = (round: RoundResponse | null) => {
    state.reveal(round);
    announce(round);
    celebrate(round);
  };
  const { step, dropping, drop } = useDrop();

  const play = async () => {
    setRevealedRoundId(null);
    const round = await state.play({ type: 'drop', rows, risk });
    const path = (round?.state as { path: ('L' | 'R')[] } | undefined)?.path;
    if (path) drop(path.length, () => {
      setRevealedRoundId(round?.roundId ?? null);
      reveal(round);
    });
    else reveal(round);
  };

  // The bucket only lights up once the ball has arrived in it. Lighting it on
  // the response would answer the question the fall is asking.
  const presentationComplete = !!state.round && state.round.roundId === revealedRoundId;
  const landedBucket = presentationComplete && result ? result.bucket : null;
  // Plinko is the game, not decoration around the game. Its panel alone uses
  // the wider Board body below, so the chamber can grow without changing the
  // other instant cabinets or overflowing a narrow iPhone.
  const boardWidth = viewportWidth >= 760
    ? 470
    : Math.min(tightIphoneStage ? 318 : 330, viewportWidth - (tightIphoneStage ? 72 : 60));

  return (
    <InstantLayout game={game} state={state} pinHeader
      dockControl={<DockChoices choices={[
        ...PLINKO_ROWS.map((option) => ({ key: `rows-${option}`, label: `${option} ROWS`, selected: rows === option, onPress: () => setRows(option), colour: game.accent })),
        ...RISKS.map((option) => ({ key: option, label: option.toUpperCase(), selected: risk === option, onPress: () => setRisk(option), colour: game.accent })),
      ]} />}
      action={
          <PlayButton
            label={state.busy || dropping
              ? 'Dropping…'
              : presentationComplete && result
                ? `${result.multiplier}× · WON ${format(minor(state.round?.settlement?.payout ?? 0), 'GC')}`
                : `Drop ${format(state.bet, 'GC')}`}
            onPress={() => void play()}
            disabled={state.busy || dropping}
            colour={game.accent}
          />
      }
    >
      <Board
        accent={game.accent}
        celebrate={handle}
        cabinet={game.cabinet}
        bodyStyle={[local.expandedGameBody, tightIphoneStage && local.tightIphoneGameBody]}
      >
        <View style={local.plinkoHeader}>
          <Txt variant="caption" color="#FFE4FF">LUMEN PEG ARRAY</Txt>
          <Txt variant="caption" color="#F4A9FF">PATH RECORDER</Txt>
        </View>
        <PlinkoVault
          rows={rows}
          path={result?.path}
          accent={game.accent}
          step={dropping ? step : presentationComplete ? rows : 0}
          landedBucket={landedBucket}
          outcome={presentationComplete && result ? { multiplier: result.multiplier, payout: state.round?.settlement?.payout ?? 0 } : undefined}
          width={boardWidth}
          condensed={tightIphoneStage}
        />
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
 * The lobby's glass peg chamber is the actual drop board. The ball follows the
 * server-returned path over that cabinet art; it is not a generic dot pyramid.
 *
 * The path is drawn from the server's own left/right list rather than
 * simulated, so what the player watches is the round that was settled — which
 * is the whole reason the engine returns each bounce rather than just the
 * bucket.
 */
function PlinkoVault({
  rows,
  path,
  accent,
  step,
  landedBucket,
  outcome,
  width,
  condensed,
}: {
  rows: number;
  path?: ('L' | 'R')[];
  accent: string;
  /** How many bounces have happened. The trail is drawn only this far. */
  step: number;
  landedBucket: number | null;
  outcome?: { multiplier: number; payout: number };
  width: number;
  condensed?: boolean;
}) {
  // A phone has spare height below the chamber, so use it for the soul of the
  // game. Wide/Surface layouts keep the shallower ratio to protect their much
  // scarcer vertical space.
  const height = Math.round(width * (condensed ? 0.74 : width < 400 ? 0.82 : 0.68));
  const gap = width / 18.75;
  // The path is truncated to the bounces the player has actually seen.
  const shown = path ? path.slice(0, Math.max(0, step)) : [];
  let x = width / 2;
  if (path && step > 0) {
    for (let r = 0; r < shown.length; r++) {
      x += (shown[r] === 'R' ? 0.5 : -0.5) * gap;
    }
  }
  const y = height * 0.14 + Math.min(rows, shown.length) * ((height * 0.72) / Math.max(rows, 1));

  return <View style={[local.plinkoVault, { width, height }]}>
    {/* A painted chamber is present on the first frame. `fadeDuration={0}`
        prevents the web image element's default arrival flash on iOS. */}
    <LinearGradient colors={['#34103E', '#16051F', '#07020C']} style={StyleSheet.absoluteFill} />
    <Image source={{ uri: '/art/tiles/juwa-plinko.png' }} resizeMode="cover" fadeDuration={0} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={['rgba(19,2,26,0.08)', 'rgba(12,0,20,0.38)']} style={StyleSheet.absoluteFill} />
    <View style={local.plinkoGlass} pointerEvents="none" />
    {path && step > 0 ? <><View style={[local.plinkoOrbGlow, { left: x - 17, top: y - 17, backgroundColor: accent }]} /><View style={[local.plinkoOrb, { left: x - 7, top: y - 7 }]} /></> : null}
    <Txt variant="caption" color="#FFE4FF" style={local.plinkoVaultLabel}>{droppingLabel(step, rows)}</Txt>
    <View style={local.plinkoBuckets} pointerEvents="none">
      {Array.from({ length: rows + 1 }, (_, index) => <View key={index} style={[local.plinkoBucket, landedBucket === index && { backgroundColor: accent }]} />)}
    </View>
    {outcome ? <View style={local.plinkoOutcome}>
      <Txt variant="caption" color="#FFF0FF">LANDED {outcome.multiplier}×</Txt>
      <Txt variant="bodySmall" color={outcome.multiplier >= 1 ? colors.feedback.winBright : '#FFB6CC'}>WON {format(minor(outcome.payout), 'GC')}</Txt>
    </View> : null}
  </View>;
}

function droppingLabel(step: number, rows: number): string {
  return step > 0 && step < rows ? `BOUNCE ${step} OF ${rows}` : step >= rows ? 'PATH LOCKED' : 'READY TO DROP';
}

// ------------------------------------------------------------------- mines

const MINE_COUNTS = [1, 3, 5, 10, 24];

/**
 * The illustrated vault is drawn in perspective, so its five rows are not a
 * uniform CSS grid. These measurements follow the actual painted cell faces
 * in the 282-point reference image from the narrow back row to the wider front
 * row. Keeping interaction and reveal geometry on the same map prevents a
 * selected tile from appearing beside the cell the player touched.
 */
const MINE_ART_SIZE = 1254;
const MINE_TILE_POINTS = [
  [[306, 501], [425, 498], [421, 568], [293, 573]],
  [[433, 498], [554, 496], [553, 567], [429, 568]],
  [[563, 496], [680, 495], [686, 567], [560, 567]],
  [[689, 496], [807, 497], [816, 569], [694, 567]],
  [[817, 499], [934, 505], [950, 575], [825, 570]],
  [[291, 577], [423, 571], [414, 658], [277, 662]],
  [[429, 572], [555, 570], [553, 655], [422, 657]],
  [[561, 570], [686, 571], [693, 656], [560, 655]],
  [[694, 571], [817, 573], [829, 660], [701, 656]],
  [[824, 575], [951, 580], [968, 665], [836, 660]],
  [[277, 665], [413, 661], [402, 751], [260, 755]],
  [[421, 661], [553, 659], [551, 750], [410, 751]],
  [[559, 659], [693, 660], [701, 750], [559, 750]],
  [[701, 661], [830, 664], [844, 754], [710, 751]],
  [[836, 666], [968, 670], [988, 760], [851, 754]],
  [[258, 759], [400, 755], [390, 855], [241, 860]],
  [[410, 755], [551, 754], [549, 854], [399, 855]],
  [[559, 754], [701, 754], [710, 855], [558, 854]],
  [[710, 756], [844, 759], [861, 859], [720, 855]],
  [[851, 759], [988, 765], [1008, 866], [868, 861]],
  [[241, 865], [389, 860], [373, 974], [219, 977]],
  [[399, 860], [549, 859], [547, 975], [382, 974]],
  [[557, 859], [710, 859], [722, 976], [557, 975]],
  [[720, 861], [862, 865], [881, 978], [730, 976]],
  [[869, 867], [1008, 872], [1030, 978], [890, 980]],
] as const;

function mineTileShape(index: number) {
  const scale = 282 / MINE_ART_SIZE;
  const corners = MINE_TILE_POINTS[index]!.map(([x, y]) => ({ x: x * scale, y: y * scale }));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    centerX: corners.reduce((total, point) => total + point.x, 0) / corners.length,
    centerY: corners.reduce((total, point) => total + point.y, 0) / corners.length,
    points: corners.map(({ x, y }) => `${x},${y}`).join(' '),
  };
}

function mineTileGeometry(index: number, scale: number) {
  const shape = mineTileShape(index);
  return {
    position: 'absolute' as const,
    left: shape.left * scale,
    top: shape.top * scale,
    width: shape.width * scale,
    height: shape.height * scale,
  };
}

function MinePerspectiveFaces({ tileState }: { tileState: (tile: number) => 'hidden' | 'safe' | 'mine' }) {
  return (
    <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 282 282" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id="mine-safe-face" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E9FFFF" stopOpacity="0.98" />
          <Stop offset="0.46" stopColor="#66E8FF" stopOpacity="0.94" />
          <Stop offset="1" stopColor="#087AA4" stopOpacity="0.9" />
        </SvgLinearGradient>
        <SvgLinearGradient id="mine-danger-face" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD5A1" stopOpacity="0.98" />
          <Stop offset="0.42" stopColor="#FF5A35" stopOpacity="0.96" />
          <Stop offset="1" stopColor="#6D0716" stopOpacity="0.94" />
        </SvgLinearGradient>
      </Defs>
      {Array.from({ length: MINES_TILES }, (_, tile) => {
        const status = tileState(tile);
        if (status === 'hidden') return null;
        const shape = mineTileShape(tile);
        const marker = 2.8 + Math.floor(tile / 5) * 0.18;
        return (
          <React.Fragment key={tile}>
            <Polygon
              points={shape.points}
              fill={status === 'safe' ? 'url(#mine-safe-face)' : 'url(#mine-danger-face)'}
              stroke={status === 'safe' ? '#DFFFFF' : '#FFD29C'}
              strokeWidth={0.85}
              strokeLinejoin="round"
            />
            {status === 'safe' ? (
              <Polygon
                points={`${shape.centerX},${shape.centerY - marker} ${shape.centerX + marker},${shape.centerY} ${shape.centerX},${shape.centerY + marker} ${shape.centerX - marker},${shape.centerY}`}
                fill="#042033"
                stroke="#CFFFFF"
                strokeWidth={0.45}
              />
            ) : (
              <>
                <Circle cx={shape.centerX} cy={shape.centerY} r={marker + 0.8} fill="#2A0710" stroke="#FFE7A5" strokeWidth={0.5} />
                <Path d={`M${shape.centerX - marker},${shape.centerY} L${shape.centerX + marker},${shape.centerY} M${shape.centerX},${shape.centerY - marker} L${shape.centerX},${shape.centerY + marker} M${shape.centerX - marker * 0.72},${shape.centerY - marker * 0.72} L${shape.centerX + marker * 0.72},${shape.centerY + marker * 0.72} M${shape.centerX + marker * 0.72},${shape.centerY - marker * 0.72} L${shape.centerX - marker * 0.72},${shape.centerY + marker * 0.72}`} stroke="#FFF2AF" strokeWidth={0.75} strokeLinecap="round" />
              </>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/** A settled Mines round announces over the vault instead of below the fold. */
function MineResultBanner({ roundId, payout, bust }: { roundId: string; payout: number; bust: boolean }) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 6, tension: 96, useNativeDriver: true }).start();
  }, [entrance, roundId]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        local.mineResultBanner,
        bust ? local.mineResultBannerBust : local.mineResultBannerWin,
        {
          opacity: entrance,
          transform: [
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      <Txt variant="caption" color={bust ? '#FFD4B0' : '#CFFFFF'}>{bust ? 'VAULT BREACHED' : 'VAULT CLEARED'}</Txt>
      <Txt variant="h2" color={bust ? '#FFF0D2' : '#E9FFFF'}>
        {bust ? 'MINE HIT' : `WON ${format(minor(payout), 'GC')}`}
      </Txt>
    </Animated.View>
  );
}

export function MinesScreen() {
  const game = GAMES['mines']!;
  const state = useInstantGame(game);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const tightIphoneStage = useTightIphoneStage();
  const [mines, setMines] = useState(3);
  // The square can reach 440 on a tall desktop. Phones keep a substantial
  // 298-point vault so the playfield remains the visual focus of the screen.
  // Narrow iPhones need only twelve points reclaimed; reducing every phone
  // made the cabinet unnecessarily small on Pixel devices that already fit.
  const mineSize = viewportWidth >= 760
    ? Math.min(440, Math.max(288, viewportHeight - 478))
    : Math.min(tightIphoneStage ? 270 : 298, viewportWidth - (tightIphoneStage ? 72 : 60));
  const mineScale = mineSize / 282;

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
    state.reveal(state.round);
    announce(state.round);
    celebrate(state.round);
  }, [state.round, state.reveal, announce, celebrate]);

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
    if (revealCount > lastReveal.current) sounds.mineSafe();
    lastReveal.current = revealCount;
  }, [revealCount]);

  const bust = board?.bust ?? false;
  const bustedOnce = useRef(false);
  useEffect(() => {
    if (bust && !bustedOnce.current) {
      bustedOnce.current = true;
      sounds.mineBlast();
    }
    if (!bust) bustedOnce.current = false;
  }, [bust]);

  return (
    <InstantLayout game={game} state={state} stakeLocked={open}
      dockControl={!open ? <DockChoices choices={MINE_COUNTS.map((option) => ({
        key: String(option),
        label: `${option} ${option === 1 ? 'MINE' : 'MINES'}`,
        selected: mines === option,
        onPress: () => setMines(option),
        colour: game.accent,
      }))} /> : undefined}
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
            label={state.busy
              ? 'Dealing…'
              : settled
                ? board?.bust
                  ? `MINE HIT · BET ${format(state.bet, 'GC')}`
                  : `WON ${format(minor(state.round?.settlement?.payout ?? 0), 'GC')} · BET AGAIN`
                : `Bet ${format(state.bet, 'GC')}`}
            onPress={() => void state.play({ type: 'configure', mines })}
            disabled={state.busy}
            colour={game.accent}
          />
        )
      }
    >
      <Board
        accent={game.accent}
        celebrate={handle}
        cabinet={game.cabinet}
        bodyStyle={[local.expandedGameBody, tightIphoneStage && local.tightIphoneGameBody]}
      >
        <View style={[local.mineVault, { width: mineSize, height: mineSize }]}>
          <Image source={{ uri: '/art/tiles/juwa-mines.png' }} resizeMode="contain" style={StyleSheet.absoluteFill} />
          {/* The illustrated twenty-five-cell vault is the actual playfield.
              The hit targets are visually absent until the server opens one;
              drawing a second glass grid over this art made every cell look
              doubled and clouded. */}
          <LinearGradient colors={['rgba(1,10,19,0.02)', 'rgba(1,8,17,0.18)']} style={StyleSheet.absoluteFill} />
          <View style={[local.minesHeader, local.minesHeaderOverlay]} pointerEvents="none">
            <View style={local.minesIndicator} />
            <Txt variant="caption" color="#C6F7FF">DEEP VAULT</Txt>
            <Txt variant="caption" color="#71DFFF">{open ? 'ARMED' : 'STANDBY'}</Txt>
          </View>
          <MinePerspectiveFaces tileState={tileState} />
          <View style={local.mineBoard} pointerEvents="box-none">
          {Array.from({ length: MINES_TILES }, (_, tile) => (
            <MineTile
              key={tile}
              index={tile}
              status={tileState(tile)}
              disabled={!open || state.busy || tileState(tile) !== 'hidden'}
              onPress={() => state.act({ type: 'reveal', tile })}
              geometry={mineTileGeometry(tile, mineScale)}
            />
          ))}
          </View>
          {bust ? <MineDetonation key={state.round?.roundId} /> : null}
          {settled ? (
            <MineResultBanner
              key={state.round!.roundId}
              roundId={state.round!.roundId}
              payout={state.round!.settlement?.payout ?? 0}
              bust={board?.bust ?? false}
            />
          ) : null}
          {!settled ? <View style={local.minesStatusOverlay} pointerEvents="none">
            <Txt
              variant="bodySmall"
              color={settled && board?.bust ? colors.feedback.error : settled ? colors.feedback.winBright : colors.text.secondary}
              numberOfLines={1}
            >
              {open
                ? board!.multiplier > 0
                  ? `Cash out ${board!.multiplier}× · next ${board!.nextMultiplier}×`
                  : `First pick pays ${board!.nextMultiplier}×`
                : `${mines} ${mines === 1 ? 'mine' : 'mines'} · first pick ${minesMultiplier(mines, 1)}×`}
            </Txt>
          </View> : null}
        </View>
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
  const { handle, celebrate } = useCelebration();
  const ticket = state.round?.state as { multiplier: number; prizes: readonly number[] } | undefined;
  const needsReveal = !!ticket && !revealed;

  const buy = async () => {
    const round = await state.play({ type: 'buy-card' });
    // Keep the old, completed card intact while the next card is being minted.
    // The new round id keys ScratchCard below, so its foil is pristine on the
    // very first frame rather than being reset one effect later.
    if (round) setRevealed(false);
  };
  const reveal = () => {
    if (!ticket || revealed) return;
    state.reveal();
    setRevealed(true);
    if (ticket.multiplier > 0) {
      sounds.cardFlip();
      setTimeout(() => {
        if (ticket.multiplier >= 25) sounds.megaWin();
        else if (ticket.multiplier >= 10) sounds.bigWin();
        else sounds.win();
        sounds.coins(ticket.multiplier >= 10 ? 7 : 4);
      }, 90);
      celebrate(state.round);
    } else {
      sounds.cardFlip();
      // A quiet, short resolve after the foil lift. This is intentionally not
      // the harsh error cue that used to make an ordinary no-match punitive.
      setTimeout(() => sounds.lose(), 110);
    }
  };

  return (
    <InstantLayout
      game={game}
      state={state}
      action={
        !needsReveal ? <PlayButton
          label={state.busy ? 'Minting card…' : revealed && ticket ? `Play another · ${format(state.bet, 'GC')}` : `Buy card · ${format(state.bet, 'GC')}`}
          onPress={() => void buy()}
          disabled={state.busy}
          colour={game.accent}
        /> : undefined
      }
    >
      <Board accent={game.accent} celebrate={handle} cabinet={game.cabinet}>
        <Txt variant="caption" color="#FFE8A6">GOLDEN SCRATCH</Txt>
        <ScratchCard key={state.round?.roundId ?? 'empty-card'} ticket={ticket} ticketId={state.round?.roundId} revealed={revealed} onReveal={reveal} />
        <View style={shell.result}>
          {!ticket ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>Buy a card, then drag across the foil to reveal it.</Txt>
          ) : !revealed ? (
            <Txt variant="bodySmall" color="#FFE8A6">Match all 3 prize windows to win. Drag across the gold foil.</Txt>
          ) : (
            <Txt variant="h2" color={ticket.multiplier > 0 ? colors.feedback.winBright : '#F3D58A'}>
              {ticket.multiplier > 0 ? `WON ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')} · ${ticket.multiplier}×` : 'THE NEXT CARD COULD SHINE'}
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
  // A scratch card is a physical surface. Keep every real finger point, then
  // punch those circles out of a gold SVG mask. The underlying prizes therefore
  // appear exactly where the finger travelled — not in pre-counted strips.
  const [scratched, setScratched] = useState(0);
  const [points, setPoints] = useState<{ id: number; x: number; y: number }[]>([]);
  const [dust, setDust] = useState<{ id: number; x: number; y: number }[]>([]);
  const announced = useRef(false);
  const marks = useRef(new Set<number>());
  const previous = useRef<{ x: number; y: number } | null>(null);
  const serial = useRef(0);
  const surface = useRef<View | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setScratched(0);
    setPoints([]);
    setDust([]);
    announced.current = false;
    marks.current.clear();
    previous.current = null;
  }, [ticketId]);

  useEffect(() => {
    // The foil lifts only after most of its AREA has genuinely been scraped.
    // A single swipe across the three prize columns used to count as complete,
    // which exposed the whole ticket after only a tiny reveal and killed the
    // suspense of scratching it by hand.
    const coverage = scratched / (18 * 6);
    if (coverage < 0.62 || points.length < 24 || announced.current) return;
    announced.current = true;
    onReveal();
  }, [scratched, points.length, onReveal]);

  const scratchAt = (x: number, y: number) => {
    if (!ticket || revealed) return;
    // The prize windows occupy this in-card foil plate; let gestures outside
    // it pass without creating invisible progress.
    if (x < 12 || x > 270 || y < 24 || y > 109) return;
    const last = previous.current;
    if (last && Math.hypot(last.x - x, last.y - y) < 7) return;
    previous.current = { x, y };
    const point = { id: ++serial.current, x, y };
    setPoints((current) => [...current.slice(-150), point]);
    setDust((current) => [...current.slice(-22), point]);
    // Coverage is sampled on a fine grid behind the foil. Mark every sample
    // touched by the same circular scraper that punches the SVG mask, so the
    // visual hole and the completion meter cannot disagree.
    const columns = 18;
    const rows = 6;
    const cellWidth = 258 / columns;
    const cellHeight = 85 / rows;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const cx = 12 + (column + 0.5) * cellWidth;
        const cy = 24 + (row + 0.5) * cellHeight;
        if (Math.hypot(cx - x, cy - y) <= 14) marks.current.add(row * columns + column);
      }
    }
    setScratched(marks.current.size);
    if (point.id % 3 === 1) sounds.scratch();
  };

  const measureSurface = useCallback(() => {
    surface.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  }, []);

  const scratchEvent = useCallback((event: { nativeEvent: { pageX?: number; pageY?: number; locationX: number; locationY: number } }) => {
    const native = event.nativeEvent;
    let x = typeof native.pageX === 'number' ? native.pageX - origin.current.x : native.locationX;
    let y = typeof native.pageY === 'number' ? native.pageY - origin.current.y : native.locationY;
    // Browser page coordinates and measureInWindow coordinates differ when a
    // document has already scrolled. In that case the root-local coordinates
    // are the reliable pair (all visual children ignore pointer events).
    if ((x < 0 || x > 282 || y < 0 || y > 138) && native.locationX >= 0 && native.locationX <= 282) {
      x = native.locationX;
      y = native.locationY;
    }
    scratchAt(x, y);
  }, [ticket, revealed]);

  const scratchPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!ticket && !revealed,
        onStartShouldSetPanResponderCapture: () => !!ticket && !revealed,
        onMoveShouldSetPanResponder: () => !!ticket && !revealed,
        onMoveShouldSetPanResponderCapture: () => !!ticket && !revealed,
        onPanResponderGrant: scratchEvent,
        onPanResponderMove: scratchEvent,
        onPanResponderRelease: () => { previous.current = null; },
        onPanResponderTerminate: () => { previous.current = null; },
        // The scratch surface owns the drag. Without this, Safari hands a
        // vertical stroke to the page and the player scrolls instead of
        // scraping the foil.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [ticket, revealed, scratchEvent],
  );

  const prizes = ticket?.prizes ?? [0, 0, 0];
  return (
    <View
      ref={surface}
      collapsable={false}
      onLayout={measureSurface}
      style={[local.scratchCard, { touchAction: 'none', userSelect: 'none' } as any]}
      {...scratchPan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Prize revealed' : 'Rub across the gold foil to scratch the prize windows'}
    >
      <LinearGradient pointerEvents="none" colors={['#FFF4BE', '#C98B16', '#4A1607']} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={local.scratchInner}>
        {prizes.map((prize, index) => <View key={index} style={local.scratchPrize}>
          <Txt variant="h2" color="#2B1605">{prize > 0 ? `${prize}×` : '—'}</Txt>
        </View>)}
      </View>
      {!revealed ? <Svg width={282} height={138} style={local.scratchFoilCanvas} pointerEvents="none">
        <Defs>
          <SvgLinearGradient id="scratch-foil" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFF7BF" />
            <Stop offset="0.38" stopColor="#E7AE31" />
            <Stop offset="0.74" stopColor="#9C4A08" />
            <Stop offset="1" stopColor="#FFD95A" />
          </SvgLinearGradient>
          <Mask id="scratched-foil" x="0" y="0" width="282" height="138">
            <Rect x="12" y="24" width="258" height="85" rx="14" fill="#FFFFFF" />
            {points.map((point) => <Circle key={point.id} cx={point.x} cy={point.y} r="13" fill="#000000" />)}
          </Mask>
        </Defs>
        <Rect x="12" y="24" width="258" height="85" rx="14" fill="url(#scratch-foil)" mask="url(#scratched-foil)" />
        <Path d="M20,37 L255,37 M20,101 L255,101" stroke="rgba(255,255,235,0.6)" strokeWidth="1" />
      </Svg> : null}
      {!revealed ? dust.map((flake) => <ScratchFlake key={flake.id} x={flake.x} y={flake.y} id={flake.id} />) : null}
      {!revealed ? <Txt variant="caption" color="#FFF6CF" style={local.scratchInstruction}>RUB THE GOLD FOIL TO REVEAL</Txt> : null}
    </View>
  );
}

function MineDetonation() {
  const blast = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(blast, { toValue: 1, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [blast]);
  return <View pointerEvents="none" style={local.detonationLayer}>
    <Animated.View style={[local.detonationFlash, { opacity: blast.interpolate({ inputRange: [0, 0.08, 0.35, 1], outputRange: [0, 1, 0.45, 0] }), transform: [{ scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.15, 3.5] }) }] }]} />
    {[0, 1, 2, 3, 4].map((index) => <Animated.View key={index} style={[local.detonationSmoke, {
      left: `${34 + index * 8}%`,
      opacity: blast.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 0.78, 0.58, 0] }),
      transform: [
        { translateX: (index - 2) * 13 },
        { translateY: blast.interpolate({ inputRange: [0, 1], outputRange: [18, -92 - index * 7] }) },
        { scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.9 + index * 0.12] }) },
      ],
    }]} />)}
    <Animated.View style={[local.detonationRing, { opacity: blast.interpolate({ inputRange: [0, 0.18, 0.65], outputRange: [0, 1, 0] }), transform: [{ scale: blast.interpolate({ inputRange: [0, 0.7], outputRange: [0.1, 3.8] }) }] }]} />
  </View>;
}

/** Small foil flakes trail away from every actual scratch point. */
function ScratchFlake({ x, y, id }: { x: number; y: number; id: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fall.setValue(0);
    Animated.timing(fall, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [fall, id]);
  const dx = ((id % 5) - 2) * 5;
  return <Animated.View pointerEvents="none" style={[local.scratchDust, {
    left: x - 2,
    top: y - 2,
    opacity: fall.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.95, 0.7, 0] }),
    transform: [{ translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }, { rotate: `${(id % 4) * 27}deg` }],
  }]} />;
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
  disabled,
  onPress,
  geometry,
}: {
  index: number;
  status: 'hidden' | 'safe' | 'mine';
  disabled: boolean;
  onPress: () => void;
  geometry: ReturnType<typeof mineTileGeometry>;
}) {
  const flip = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const blast = useRef(new Animated.Value(0)).current;
  const safe = useRef(new Animated.Value(0)).current;
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
    if (status === 'safe') {
      safe.setValue(0);
      Animated.sequence([
        Animated.timing(safe, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(safe, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start();
    }
  }, [status, reduced, flip, shake, blast, safe]);

  // Squashes towards zero width at the midpoint — the read of a card turning.
  const scaleX = flip.interpolate({ inputRange: [0, 1], outputRange: [1, 0.08] });
  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] });

  return (
    <Animated.View style={{ transform: [{ scaleX }, { translateX }] }}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Tile ${index + 1}`}
        style={({ pressed }) => [
          local.tile,
          geometry as never,
          pressed && status === 'hidden' && local.tilePressed,
        ]}
      >
        {status === 'safe' ? <>
          <Animated.View pointerEvents="none" style={[local.mineSafeHalo, { opacity: safe.interpolate({ inputRange: [0, 0.24, 1], outputRange: [0, 0.85, 0] }), transform: [{ scale: safe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 2.4] }) }] }]} />
        </> : null}
        {status === 'mine' ? <>
          <Animated.View pointerEvents="none" style={[local.mineBlast, { opacity: blast, transform: [{ scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.25, 2.8] }) }] }]} />
          <Animated.View pointerEvents="none" style={[local.mineShockwave, { opacity: blast.interpolate({ inputRange: [0, 0.32, 1], outputRange: [0, 0.96, 0] }), transform: [{ scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.25, 4.8] }) }] }]} />
          {[-1, 1].flatMap((y) => [-1, 1].map((x) => ({ x, y }))).map((spark) => <Animated.View key={`${spark.x}-${spark.y}`} pointerEvents="none" style={[local.mineSpark, { opacity: blast.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }), transform: [{ translateX: blast.interpolate({ inputRange: [0, 1], outputRange: [0, spark.x * 27] }) }, { translateY: blast.interpolate({ inputRange: [0, 1], outputRange: [0, spark.y * 27] }) }, { scale: blast.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.25] }) }] }]} />)}
          <View pointerEvents="none" style={local.mineCore} />
        </> : null}
      </Pressable>
    </Animated.View>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  expandedGameBody: { paddingHorizontal: 6 },
  tightIphoneGameBody: { paddingVertical: 9, gap: 4 },
  tightIphoneResult: { minHeight: 34 },
  /** Ready, win and loss occupy exactly the same space, so Crash cannot grow after settlement. */
  tightIphoneCrashResult: { height: 34, minHeight: 34, overflow: 'hidden', paddingHorizontal: 2 },
  winReadout: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  dockChoices: { flexDirection: 'row', gap: 6, paddingHorizontal: 2, alignItems: 'center' },
  dockChoice: { minHeight: 32, minWidth: 64, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: '#3A3446', backgroundColor: '#15131D', alignItems: 'center', justifyContent: 'center' },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, width: 5 * 44, justifyContent: 'center' },
  mineVault: { width: 282, height: 282, alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,211,252,0.62)', backgroundColor: '#04090E', shadowColor: '#38BDF8', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  mineBoard: { ...StyleSheet.absoluteFillObject },
  tile: {
    // Interaction only. Visible reveals are SVG quadrilaterals fitted to the
    // perspective in the cabinet art; keeping this face transparent prevents
    // web browsers from substituting upright rounded rectangles.
    width: 33,
    height: 21,
    backgroundColor: 'transparent',
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  tilePressed: { backgroundColor: 'rgba(100,225,255,0.12)' },
  mineSafeHalo: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#95F7FF', shadowColor: '#52E8FF', shadowOpacity: 1, shadowRadius: 14 },
  mineBlast: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF4A8', shadowColor: '#FF4D21', shadowOpacity: 1, shadowRadius: 24 },
  mineShockwave: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#FFB15B', shadowColor: '#FF4D21', shadowOpacity: 0.9, shadowRadius: 18 },
  mineSpark: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFE27A', shadowColor: '#FF5C28', shadowOpacity: 1, shadowRadius: 7 },
  mineCore: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFEF88', shadowColor: '#FF4D21', shadowOpacity: 1, shadowRadius: 10 },
  detonationLayer: { ...StyleSheet.absoluteFillObject, zIndex: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  detonationFlash: { position: 'absolute', width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFF5B8', shadowColor: '#FF451A', shadowOpacity: 1, shadowRadius: 38 },
  detonationSmoke: { position: 'absolute', bottom: '30%', width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(46,44,48,0.9)', borderWidth: 5, borderColor: 'rgba(255,91,31,0.42)', shadowColor: '#FF531F', shadowOpacity: 0.72, shadowRadius: 18 },
  detonationRing: { position: 'absolute', width: 68, height: 68, borderRadius: 34, borderWidth: 5, borderColor: '#FFB348', shadowColor: '#FF381C', shadowOpacity: 1, shadowRadius: 24 },
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
  diceVault: { width: '100%', height: 172, borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(190,255,120,0.5)', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#76EF42', shadowOpacity: 0.45, shadowRadius: 17, shadowOffset: { width: 0, height: 6 } },
  diceStage: { width: '100%', flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', alignItems: 'center' },
  diceVaultWide: { width: 280, height: 168 },
  diceVaultCompact: { height: 168 },
  diceVaultLabel: { position: 'absolute', top: 8, alignSelf: 'center', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(232,255,196,0.6)', backgroundColor: 'rgba(3,16,4,0.68)' },
  diceDialShell: { width: 168, height: 168, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderRadius: 84, borderWidth: 1, borderColor: 'rgba(202,255,146,0.32)', backgroundColor: 'rgba(3,19,8,0.74)', shadowColor: '#A3E635', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 5 } },
  diceDialReadout: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  diceCrystal: { width: 72, height: 72, borderRadius: 18, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#C8FF8F', shadowOpacity: 0.62, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } },
  diceCrystalRear: { position: 'absolute', left: 55, top: 66, opacity: 0.8, transform: [{ rotate: '-18deg' }] },
  diceCrystalCompact: { width: 46, height: 46, borderRadius: 12 },
  diceCrystalCompactFirst: { position: 'absolute', left: 10, top: 38, opacity: 0.9 },
  diceCrystalCompactSecond: { position: 'absolute', right: 10, top: 78 },
  dicePips: { width: 31, height: 31, flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center', alignItems: 'center' },
  dicePip: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#271709' },
  diceRollReadout: { position: 'absolute', right: spacing.md, bottom: spacing.sm, alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(226,255,177,0.62)', backgroundColor: 'rgba(2,17,5,0.72)' },
  diceRollReadoutCompact: { left: 5, right: 5, bottom: 4, alignItems: 'center', paddingHorizontal: 3, paddingVertical: 2 },
  crashDeck: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: 'rgba(244,190,78,0.28)' },
  crashStatus: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(248,201,90,0.52)', backgroundColor: 'rgba(19,8,3,0.56)' },
  crashFlightStage: { width: 292, height: 126, alignSelf: 'center', overflow: 'hidden' },
  crashAircraft: { position: 'absolute', width: 134, height: 94 },
  crashExhaust: { position: 'absolute', width: 54, height: 18, borderRadius: 9, overflow: 'hidden', shadowColor: '#FF672D', shadowOpacity: 1, shadowRadius: 15 },
  crashExhaustCore: { position: 'absolute', right: 2, top: 5, width: 23, height: 8, borderRadius: 4, backgroundColor: '#F4FFFF', shadowColor: '#FFF4B6', shadowOpacity: 1, shadowRadius: 8 },
  limboHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(111,240,244,0.65)', backgroundColor: 'rgba(1,19,29,0.72)' },
  limboSeal: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#67E8F9' },
  limboPulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EEAD4', shadowColor: '#5EEAD4', shadowOpacity: 1, shadowRadius: 7 },
  diceHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(215,249,157,0.3)', paddingBottom: 5 },
  plinkoHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(245,183,255,0.34)', paddingBottom: 5 },
  plinkoVault: { alignSelf: 'center', overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(245,183,255,0.64)', backgroundColor: '#16051F', shadowColor: '#E879F9', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  plinkoBuckets: { position: 'absolute', left: 9, right: 9, bottom: 8, flexDirection: 'row', gap: 2 },
  plinkoBucket: { flex: 1, height: 10, borderRadius: 4, backgroundColor: 'rgba(255,240,255,0.22)' },
  plinkoOutcome: { position: 'absolute', right: 9, top: 8, alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(255,220,255,0.54)', backgroundColor: 'rgba(23,3,34,0.8)' },
  plinkoGlass: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: 'rgba(255,230,255,0.28)', borderRadius: radius.lg },
  plinkoOrbGlow: { position: 'absolute', width: 34, height: 34, borderRadius: 17, opacity: 0.42, shadowColor: '#FFFFFF', shadowOpacity: 0.92, shadowRadius: 13 },
  plinkoOrb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFF5FF', borderWidth: 2, borderColor: '#F7A2FF', shadowColor: '#FFFFFF', shadowOpacity: 1, shadowRadius: 8 },
  plinkoVaultLabel: { position: 'absolute', top: 8, left: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: 'rgba(24,4,32,0.72)' },
  minesHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  minesHeaderOverlay: { position: 'absolute', left: 4, right: 4, top: 4, zIndex: 6, width: undefined, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: 'rgba(1,10,18,0.72)' },
  minesIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#79E7FF', shadowColor: '#79E7FF', shadowOpacity: 1, shadowRadius: 8 },
  minesStatusOverlay: { position: 'absolute', left: 8, right: 8, bottom: 5, zIndex: 6, minHeight: 24, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: 'rgba(1,8,17,0.78)' },
  mineResultBanner: { position: 'absolute', left: 22, right: 22, bottom: 28, zIndex: 12, minHeight: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 2, shadowOpacity: 0.95, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, overflow: 'hidden' },
  mineResultBannerWin: { borderColor: '#B9FFFF', backgroundColor: 'rgba(0,45,62,0.94)', shadowColor: '#50E8FF' },
  mineResultBannerBust: { borderColor: '#FFD18A', backgroundColor: 'rgba(72,14,3,0.95)', shadowColor: '#FF5A24' },
  scratchCard: {
    width: 282,
    height: 138,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: '#FFE7A1',
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    shadowColor: '#F6C84C',
    shadowOpacity: 0.62,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  scratchInner: { position: 'absolute', left: 12, right: 12, top: 24, height: 85, flexDirection: 'row', gap: spacing.xs },
  scratchPrize: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(82,35,4,0.58)',
    backgroundColor: 'rgba(255,247,209,0.72)',
    overflow: 'hidden',
  },
  scratchFoilCanvas: { position: 'absolute', left: 0, top: 0 },
  scratchInstruction: { position: 'absolute', top: 7, alignSelf: 'center', textShadowColor: 'rgba(66,24,1,0.9)', textShadowRadius: 3 },
  scratchDust: { position: 'absolute', width: 4, height: 7, borderRadius: 1, backgroundColor: '#FFE178', borderWidth: 1, borderColor: '#8D4F08', shadowColor: '#FFF4B0', shadowOpacity: 0.9, shadowRadius: 4 },
});
