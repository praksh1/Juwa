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

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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
import { InstantLayout, PlayButton, useInstantGame, styles as shell, type InstantGame } from './shell';

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

export function CrashScreen() {
  const game = GAMES['crash']!;
  const state = useInstantGame(game);
  const [target, setTarget] = useState(2);
  const result = state.round?.state as { crashPoint: number; cashedOut: boolean } | undefined;
  const won = result?.cashedOut ?? false;

  return (
    <InstantLayout game={game} state={state}>
      <View style={shell.board}>
        <Txt variant="caption" color={colors.text.muted}>
          CASH OUT AT
        </Txt>
        <Txt variant="h1" color={game.accent}>
          {target.toFixed(2)}×
        </Txt>
        <TargetPicker values={CRASH_TARGETS} value={target} onChange={setTarget} colour={game.accent} />
        <View style={shell.result}>
          {result ? (
            <>
              <Txt variant="h2" color={won ? colors.feedback.winBright : colors.feedback.error}>
                {result.crashPoint.toFixed(2)}×
              </Txt>
              <Txt variant="bodySmall" color={colors.text.muted}>
                {won
                  ? `Cashed out — ${format(minor(state.round!.settlement?.payout ?? 0), 'GC')}`
                  : 'Crashed before your target'}
              </Txt>
            </>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              The curve stops somewhere. Cash out before it does.
            </Txt>
          )}
        </View>
      </View>
      <PlayButton
        label={state.busy ? 'Playing…' : `Bet ${format(state.bet, 'GC')}`}
        onPress={() => state.play({ type: 'set-target', target })}
        disabled={state.busy}
        colour={game.accent}
      />
    </InstantLayout>
  );
}

// ------------------------------------------------------------------- limbo

const LIMBO_TARGETS = [1.5, 2, 5, 10, 50, 100];

export function LimboScreen() {
  const game = GAMES['limbo']!;
  const state = useInstantGame(game);
  const [target, setTarget] = useState(2);
  const result = state.round?.state as { result: number; won: boolean } | undefined;

  return (
    <InstantLayout game={game} state={state}>
      <View style={shell.board}>
        <Txt variant="caption" color={colors.text.muted}>
          TARGET
        </Txt>
        <Txt variant="h1" color={game.accent}>
          {target.toFixed(2)}×
        </Txt>
        <TargetPicker values={LIMBO_TARGETS} value={target} onChange={setTarget} colour={game.accent} />
        <View style={shell.result}>
          {result ? (
            <>
              <Txt
                variant="h1"
                color={result.won ? colors.feedback.winBright : colors.feedback.error}
              >
                {result.result.toFixed(2)}×
              </Txt>
              <Txt variant="bodySmall" color={colors.text.muted}>
                {result.won
                  ? format(minor(state.round!.settlement?.payout ?? 0), 'GC')
                  : `Needed ${target.toFixed(2)}×`}
              </Txt>
            </>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Win if the roll is at least your target.
            </Txt>
          )}
        </View>
      </View>
      <PlayButton
        label={state.busy ? 'Rolling…' : `Bet ${format(state.bet, 'GC')}`}
        onPress={() => state.play({ type: 'set-target', target })}
        disabled={state.busy}
        colour={game.accent}
      />
    </InstantLayout>
  );
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

  return (
    <InstantLayout game={game} state={state}>
      <View style={shell.board}>
        <View style={local.row}>
          {(['under', 'over'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setDirection(option)}
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
        <Txt variant="h1" color={game.accent}>
          {target.toFixed(2)}
        </Txt>
        <TargetPicker values={DICE_TARGETS} value={target} onChange={setTarget} colour={game.accent} suffix="" />
        <Txt variant="bodySmall" color={colors.text.secondary}>
          {quote.legal ? `Pays ${quote.multiplier}×` : 'That bet pays too little to place'}
        </Txt>
        <View style={shell.result}>
          {result ? (
            <>
              <Txt
                variant="h1"
                color={result.won ? colors.feedback.winBright : colors.feedback.error}
              >
                {result.roll.toFixed(2)}
              </Txt>
              <Txt variant="bodySmall" color={colors.text.muted}>
                {result.won
                  ? format(minor(state.round!.settlement?.payout ?? 0), 'GC')
                  : 'No win'}
              </Txt>
            </>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Rolls 0.00 to 99.99.
            </Txt>
          )}
        </View>
      </View>
      <PlayButton
        label={state.busy ? 'Rolling…' : `Bet ${format(state.bet, 'GC')}`}
        onPress={() => state.play({ type: 'roll', target, direction })}
        disabled={state.busy || !quote.legal}
        colour={game.accent}
      />
    </InstantLayout>
  );
}

// ------------------------------------------------------------------ plinko

const RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];

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

  return (
    <InstantLayout game={game} state={state}>
      <View style={shell.board}>
        <PlinkoBoard rows={rows} path={result?.path} accent={game.accent} />
        <View style={local.buckets}>
          {table.map((value, i) => (
            <View
              key={i}
              style={[
                local.bucket,
                result?.bucket === i && { backgroundColor: game.accent },
              ]}
            >
              <Txt
                variant="caption"
                color={result?.bucket === i ? colors.surface.base : colors.text.secondary}
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
              onPress={() => setRows(option)}
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
              onPress={() => setRisk(option)}
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
        <View style={shell.result}>
          {result ? (
            <Txt
              variant="h2"
              color={result.multiplier >= 1 ? colors.feedback.winBright : colors.text.muted}
            >
              {result.multiplier}× · {format(minor(state.round!.settlement?.payout ?? 0), 'GC')}
            </Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Every bucket pays something. The middle pays least.
            </Txt>
          )}
        </View>
      </View>
      <PlayButton
        label={state.busy ? 'Dropping…' : `Drop ${format(state.bet, 'GC')}`}
        onPress={() => state.play({ type: 'drop', rows, risk })}
        disabled={state.busy}
        colour={game.accent}
      />
    </InstantLayout>
  );
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
}: {
  rows: number;
  path?: ('L' | 'R')[];
  accent: string;
}) {
  const width = 300;
  const height = rows * 13 + 20;
  const gap = width / (rows + 2);

  const pegs: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      pegs.push({ x: width / 2 + (i - r / 2) * gap, y: 12 + r * 13 });
    }
  }

  let trail = '';
  if (path) {
    let x = width / 2;
    trail = `M ${x} 4`;
    for (let r = 0; r < path.length; r++) {
      x += (path[r] === 'R' ? 0.5 : -0.5) * gap;
      trail += ` L ${x} ${12 + r * 13}`;
    }
  }

  return (
    <Svg width={width} height={height}>
      {pegs.map((peg, i) => (
        <Circle key={i} cx={peg.x} cy={peg.y} r={1.8} fill={colors.text.muted} />
      ))}
      {trail ? <Path d={trail} stroke={accent} strokeWidth={2} fill="none" /> : null}
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

  return (
    <InstantLayout game={game} state={state} stakeLocked={open}>
      <View style={shell.board}>
        <View style={local.grid}>
          {Array.from({ length: MINES_TILES }, (_, tile) => {
            const status = tileState(tile);
            return (
              <Pressable
                key={tile}
                disabled={!open || state.busy || status !== 'hidden'}
                onPress={() => state.act({ type: 'reveal', tile })}
                accessibilityRole="button"
                accessibilityLabel={`Tile ${tile + 1}`}
                style={[
                  local.tile,
                  status === 'safe' && { backgroundColor: game.accent },
                  status === 'mine' && { backgroundColor: colors.feedback.error },
                ]}
              >
                <Txt variant="bodySmall" color={colors.surface.base}>
                  {status === 'safe' ? '◆' : status === 'mine' ? '✱' : ' '}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {open ? (
          <Txt variant="bodySmall" color={colors.text.secondary}>
            {board!.multiplier > 0
              ? `Cash out at ${board!.multiplier}× · next ${board!.nextMultiplier}×`
              : `First pick pays ${board!.nextMultiplier}×`}
          </Txt>
        ) : (
          <>
            <Txt variant="caption" color={colors.text.muted}>
              MINES
            </Txt>
            <TargetPicker
              values={MINE_COUNTS}
              value={mines}
              onChange={setMines}
              colour={game.accent}
              suffix=""
            />
            <Txt variant="bodySmall" color={colors.text.secondary}>
              First pick pays {minesMultiplier(mines, 1)}×
            </Txt>
          </>
        )}

        <View style={shell.result}>
          {settled ? (
            <Txt
              variant="h2"
              color={board?.bust ? colors.feedback.error : colors.feedback.winBright}
            >
              {board?.bust
                ? 'Hit a mine'
                : format(minor(state.round!.settlement?.payout ?? 0), 'GC')}
            </Txt>
          ) : null}
        </View>
      </View>

      {open ? (
        <PlayButton
          label={
            board!.multiplier > 0
              ? `Cash out ${board!.multiplier}×`
              : 'Pick a tile to start'
          }
          onPress={() => state.act({ type: 'cashout' })}
          disabled={state.busy || board!.multiplier === 0}
          colour={game.accent}
        />
      ) : (
        <PlayButton
          label={state.busy ? 'Dealing…' : `Bet ${format(state.bet, 'GC')}`}
          onPress={() => state.play({ type: 'configure', mines })}
          disabled={state.busy}
          colour={game.accent}
        />
      )}
    </InstantLayout>
  );
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  targets: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  target: {
    minHeight: 44,
    minWidth: 52,
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, width: 5 * 52, justifyContent: 'center' },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
