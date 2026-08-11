/**
 * The five instant games' play areas.
 *
 * One file because each is small — the shell in `shell.tsx` carries the
 * balance, the stake chips, the request and the error handling, so what is
 * left here is genuinely only what makes each game itself.
 *
 * Every quoted price comes from `@juwa/economy`, the module the server settles
 * with. Nothing here computes an outcome.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
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
  useSettlementSound,
  styles as shell,
  type InstantGame,
} from './shell';
import { sounds } from '../../sound';
import { usePrefersReducedMotion } from '../../motion';

const GAMES: Record<string, InstantGame> = {
  crash: { id: 'juwa-crash', name: 'Crash', minBet: 50, maxBet: 500_000, accent: '#F97316' },
  limbo: { id: 'juwa-limbo', name: 'Limbo', minBet: 50, maxBet: 500_000, accent: '#06B6D4' },
  dice: { id: 'juwa-dice', name: 'Dice', minBet: 50, maxBet: 500_000, accent: '#A3E635' },
  plinko: { id: 'juwa-plinko', name: 'Plinko', minBet: 50, maxBet: 500_000, accent: '#E879F9' },
  mines: { id: 'juwa-mines', name: 'Mines', minBet: 50, maxBet: 500_000, accent: '#38BDF8' },
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
  useSettlementSound(state.round);

  const result = state.round?.state as { crashPoint: number; cashedOut: boolean } | undefined;
  const won = result?.cashedOut ?? false;

  const { value: live, running, run } = useClimb();

  const play = async () => {
    const round = await state.play({ type: 'set-target', target });
    const crashAt = (round?.state as { crashPoint: number } | undefined)?.crashPoint;
    if (crashAt) run(crashAt, target);
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
      <Board accent={game.accent}>
        <CrashCurve
          progress={Math.min(1, (shown - 1) / Math.max(0.6, target * 1.6 - 1))}
          accent={game.accent}
          crashed={!running && !!result && !won}
          target={target}
          reached={shown}
        />
        <Txt
          variant="h1"
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
            <Txt variant="bodySmall" color={colors.text.muted}>
              {won
                ? `Cashed out at ${target.toFixed(2)}× — ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                : `Crashed at ${result.crashPoint.toFixed(2)}× — you needed ${target.toFixed(2)}×`}
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

  const run = (crashPoint: number, target: number) => {
    cancelAnimationFrame(frame.current);
    if (reduced) {
      setValue(crashPoint);
      setRunning(false);
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
    };

    setRunning(true);
    setValue(1);
    frame.current = requestAnimationFrame(tick);
  };

  return { value, running, run };
}

/**
 * The curve itself.
 *
 * A filled area under an exponential arc, with the cash-out line marked across
 * it. The fill is what makes it read as a chart of something growing rather
 * than as a stroke on a background, and the marked line is what turns the climb
 * into a question — you can see how far there is to go.
 */
function CrashCurve({
  progress,
  accent,
  crashed,
  target,
  reached,
}: {
  progress: number;
  accent: string;
  crashed: boolean;
  target: number;
  reached: number;
}) {
  const W = 260;
  const H = 96;
  const p = Math.max(0, Math.min(1, progress));

  // The visible arc, sampled. Twenty points is smooth at this size and cheap
  // enough to rebuild every frame.
  const points: string[] = [];
  for (let i = 0; i <= 20; i += 1) {
    const t = (i / 20) * p;
    points.push(`${(t * W).toFixed(1)},${(H - Math.pow(t, 1.7) * H).toFixed(1)}`);
  }
  const line = points.length > 1 ? `M${points.join(' L')}` : '';
  const area = line ? `${line} L${(p * W).toFixed(1)},${H} L0,${H} Z` : '';

  // Where the target sits on the same axis, so the line and the curve agree.
  const targetAt = Math.min(1, (target - 1) / Math.max(0.6, target * 1.6 - 1));
  const targetY = H - Math.pow(targetAt, 1.7) * H;
  const hit = reached >= target;

  return (
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={crashed ? '#FF6B6B' : accent} stopOpacity="0.42" />
          <Stop offset="1" stopColor={crashed ? '#FF6B6B' : accent} stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>

      {/* The cash-out line, drawn under the curve so the curve crosses it. */}
      <Path
        d={`M0,${targetY} L${W},${targetY}`}
        stroke={hit ? colors.feedback.winBright : 'rgba(255,255,255,0.28)'}
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {area ? <Path d={area} fill="url(#crash-fill)" /> : null}
      {line ? (
        <Path
          d={line}
          stroke={crashed ? '#FF6B6B' : accent}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
      ) : null}
      {/* The head of the curve — the thing the eye follows. */}
      {p > 0.01 ? (
        <Circle
          cx={p * W}
          cy={H - Math.pow(p, 1.7) * H}
          r={crashed ? 5 : 4}
          fill={crashed ? '#FF6B6B' : '#FFFFFF'}
        />
      ) : null}
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
  useSettlementSound(state.round);

  const result = state.round?.state as { result: number; won: boolean } | undefined;
  const { display, rolling, roll } = useNumberRoll(2);

  const play = async () => {
    const round = await state.play({ type: 'set-target', target });
    const drawn = (round?.state as { result: number } | undefined)?.result;
    if (drawn !== undefined) roll(drawn, 100);
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
      <Board accent={game.accent}>
        <Txt variant="caption" color={colors.text.muted}>
          YOU NEED
        </Txt>
        <Txt variant="h2" color={game.accent}>
          {target.toFixed(2)}× OR HIGHER
        </Txt>

        {/* The drawn number, at the largest size on the screen — it is the
            entire outcome, and it should be the entire focus. */}
        <View style={local.limboFace}>
          <Txt
            variant="display"
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

        <TargetPicker values={LIMBO_TARGETS} value={target} onChange={setTarget} colour={game.accent} />

        <View style={shell.result}>
          {rolling ? (
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Drawing…
            </Txt>
          ) : settled ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              {result!.won
                ? `Beat ${target.toFixed(2)}× — ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                : `Short of ${target.toFixed(2)}×`}
            </Txt>
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
function useNumberRoll(initial: number) {
  const [display, setDisplay] = useState(initial);
  const [rolling, setRolling] = useState(false);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const roll = (final: number, ceiling: number) => {
    cancelAnimationFrame(frame.current);
    if (reduced) {
      setDisplay(final);
      setRolling(false);
      return;
    }

    const started = performance.now();
    const DURATION = 900;
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

  useSettlementSound(state.round);
  const { display, rolling, roll } = useNumberRoll(50);

  const play = async () => {
    const round = await state.play({ type: 'roll', target, direction });
    const rolled = (round?.state as { roll: number } | undefined)?.roll;
    if (rolled !== undefined) roll(rolled, 100);
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
      <Board accent={game.accent}>
        {/*
          The track — the single most useful thing that was missing.

          UNDER 25 and OVER 90 are abstractions until you can see the winning
          band and where the roll landed relative to it. With the bar, the bet
          is legible at a glance: this much of the line wins, that much loses,
          and the marker is where it came in.
        */}
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
            <Txt variant="bodySmall" color={colors.text.muted}>
              {result!.won
                ? `Rolled ${result!.roll.toFixed(2)} — ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                : `Rolled ${result!.roll.toFixed(2)} — no win`}
            </Txt>
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

// ------------------------------------------------------------------ plinko

const RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];

/**
 * Vertical distance between peg rows.
 *
 * At 13 a sixteen-row board was 228 points tall on its own, which put the Drop
 * button below the fold. Ten still separates the rows clearly at a 4-point ball
 * and brings the whole game back onto one screen.
 */
const PEG_PITCH = 10;

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

  useSettlementSound(state.round);
  const { step, dropping, drop } = useDrop();

  const play = async () => {
    const round = await state.play({ type: 'drop', rows, risk });
    const path = (round?.state as { path: ('L' | 'R')[] } | undefined)?.path;
    if (path) drop(path.length);
  };

  // The bucket only lights up once the ball has arrived in it. Lighting it on
  // the response would answer the question the fall is asking.
  const landedBucket = !dropping && result ? result.bucket : null;

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
      <Board accent={game.accent}>
        <PlinkoBoard
          rows={rows}
          path={result?.path}
          accent={game.accent}
          step={dropping ? step : result ? rows : 0}
        />
        <View style={local.buckets}>
          {table.map((value, i) => (
            <View
              key={i}
              style={[
                local.bucket,
                landedBucket === i && { backgroundColor: game.accent },
              ]}
            >
              <Txt
                variant="caption"
                color={landedBucket === i ? colors.surface.base : colors.text.secondary}
              >
                {value}
              </Txt>
            </View>
          ))}
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

  const drop = (steps: number) => {
    if (timer.current) clearInterval(timer.current);
    if (reduced) {
      setStep(steps);
      setDropping(false);
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
          fill={ball && peg.row === shown.length - 1 ? accent : colors.text.muted}
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

  useSettlementSound(state.round);

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
      <Board accent={game.accent}>
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
            these five the readout carries a hint line and so reserving its
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

/**
 * One tile, which turns over rather than changing colour.
 *
 * A tile that simply recolours gives no sense of having been OPENED, and Mines
 * is a game of opening things. The flip is a fast scale-down and back, which is
 * what a card being turned looks like head-on and is legible at 48 points where
 * a real 3D rotation would just read as a flicker.
 *
 * A mine also shakes. Losing eight tiles of accumulated multiplier deserves
 * more than a colour change, and the shake is the only moment in these five
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
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
    }
  }, [status, reduced, flip, shake]);

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
          status === 'safe' && { backgroundColor: accent },
          status === 'mine' && { backgroundColor: colors.feedback.error },
          pressed && status === 'hidden' && local.tilePressed,
        ]}
      >
        {/* The lit face, so an unopened tile is a moulded object rather than a
            grey square — the same treatment the roulette felt cells get. */}
        <View style={local.tileGloss} pointerEvents="none" />
        <Txt variant="bodySmall" color={colors.surface.base}>
          {status === 'safe' ? '◆' : status === 'mine' ? '✱' : ' '}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
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
  buckets: { flexDirection: 'row', gap: 1, alignSelf: 'stretch' },
  bucket: {
    flex: 1,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.overlay,
    alignItems: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, width: 5 * 44, justifyContent: 'center' },
  tile: {
    // 40, not 48: five rows of tiles is the tallest single element in these
    // five games, and every point a row buys back five overall — which is what
    // brings the Bet button back onto a 700-point screen.
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
  /** The drawn number in Limbo, given fixed height so the panel cannot jump. */
  limboFace: { minHeight: 62, justifyContent: 'center' },
});
