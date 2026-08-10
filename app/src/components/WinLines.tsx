/**
 * The win-line overlay — the thing that tells a player *why* they won.
 *
 * A slot that lands three cherries, adds coins to the balance and moves on has
 * technically paid correctly and told the player nothing. On a real machine the
 * win is explained: the line is drawn, the symbols that paid light up, the rest
 * of the grid goes dark, and the amount counts up. Then, if several lines paid,
 * the machine walks through them one at a time and keeps walking until you
 * spin again.
 *
 * That last part is the bit most web slots skip, and it is the bit that makes
 * the difference. A player who looks up two seconds late has missed everything
 * unless the presentation loops.
 *
 * ## The sequence
 *
 *   1. TOTAL — every winning cell lights at once, the total counts up.
 *   2. Then, if more than one line paid, each line in turn: the grid dims to
 *      that line alone, its own value is shown next to it, and after a beat it
 *      moves on.
 *   3. Step 2 loops for as long as the player leaves it alone.
 *
 * A single winning line skips step 2 entirely — cycling through a list of one
 * is a flicker with no information in it.
 *
 * ## Why the geometry is measured rather than assumed
 *
 * Reels are laid out with `flex: 1`, so their width depends on the width of
 * the phone. Only the cell HEIGHT is a fixed constant. The overlay therefore
 * takes a measured width and derives the rest, which is what keeps the line
 * landing on the symbols on a 320px phone and a 900px tablet alike.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors, radius, spacing } from '@juwa/ui';
import type { LineWin } from '../api/client';
import { Txt } from './primitives';

/**
 * Default symbol height, matching `SYMBOL_SIZE` in Reel.tsx.
 *
 * Passed in rather than assumed, because the reels shrink on a short screen
 * and a line drawn at the old pitch would run above or below the symbols it
 * is meant to be connecting.
 */
export const CELL_HEIGHT = 58;
/** Must match the `gap` on the reels row in SlotsScreen. */
export const REEL_GAP = spacing.xs;

/** How long the combined total is shown before the per-line walk begins. */
const TOTAL_HOLD_MS = 1400;
/** How long each individual line is held during the walk. */
const LINE_HOLD_MS = 850;
/**
 * A hard ceiling on the whole walk, whatever the win looks like.
 *
 * The repeat count alone is not a bound, because the walk is repeats TIMES the
 * number of winning lines: three lines at three passes and 1.1 seconds a line
 * came to eleven and a half seconds of flashing, which a player reports — twice
 * — as "it loops until I spin again". They are right. It was technically
 * finite and that is not the same thing as ending.
 *
 * Bounding the TIME rather than the passes is what makes a five-line win and a
 * two-line win both stop while they are still saying something.
 */
const MAX_WALK_MS = 4_200;
/**
 * How many times the walk repeats before it settles.
 *
 * It used to loop until the next spin, which reads as a machine stuck in a
 * flashing state rather than one explaining a win — the flashing outlasts any
 * interest in it, and on a big win, which is when the player is looking
 * hardest, it is the thing that never stops. Three passes is long enough to
 * read a five-line win twice over and short enough to end while it is still
 * saying something.
 *
 * The final state is not blank: the walk ends back on the TOTAL, so the
 * winning symbols stay lit and the amount stays on screen until the next spin.
 * Nothing is lost, it just stops moving.
 */
const WALK_REPEATS = 2;

export type WinPhase =
  | { kind: 'idle' }
  /** Everything that paid, lit at once. */
  | { kind: 'total' }
  /** One line, by index into the win list. */
  | { kind: 'line'; index: number }
  /**
   * The presentation is over.
   *
   * Every winning cell is still lit and every line is still drawn — the player
   * can look up at any point before the next spin and see exactly what paid —
   * but NOTHING moves any more. That distinction is the whole fix: the machine
   * should end up holding a picture of the win, not performing it forever.
   */
  | { kind: 'settled' };

/**
 * Drives the phase sequence above.
 *
 * Returned as a hook rather than baked into the component because the reels
 * need the same answer: whichever cells are lit right now must be the cells the
 * reels leave undimmed, and two components computing that separately would
 * disagree for a frame every time the phase changed.
 */
export function useWinCycle(wins: LineWin[], enabled: boolean): WinPhase {
  const [phase, setPhase] = useState<WinPhase>({ kind: 'idle' });
  // A round counter, so a new spin cannot be resolved by a timer left running
  // from the previous one.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    if (!enabled || wins.length === 0) {
      setPhase({ kind: 'idle' });
      return;
    }

    setPhase({ kind: 'total' });

    let timer: ReturnType<typeof setTimeout>;
    /*
     * A single winning line needs no walk — it is already fully explained by
     * the total — but it DOES need to settle. The previous version returned
     * here and left the phase on `total` for good, which is the state the
     * symbols pulse and catch the light in. So the commonest win on the
     * machine, the one-line win, was also the one that never stopped moving.
     */
    if (wins.length < 2) {
      timer = setTimeout(() => {
        if (generation.current === mine) setPhase({ kind: 'settled' });
      }, TOTAL_HOLD_MS);
      return () => clearTimeout(timer);
    }

    let index = 0;
    // Whichever runs out first: the passes, or the clock. See MAX_WALK_MS.
    const steps = Math.min(wins.length * WALK_REPEATS, Math.floor(MAX_WALK_MS / LINE_HOLD_MS));
    const step = () => {
      if (generation.current !== mine) return;
      if (index >= steps) {
        setPhase({ kind: 'settled' });
        return;
      }
      setPhase({ kind: 'line', index: index % wins.length });
      index += 1;
      timer = setTimeout(step, LINE_HOLD_MS);
    };
    timer = setTimeout(step, TOTAL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [wins, enabled]);

  return phase;
}

/** `reel,row` keys for the cells lit in this phase. Empty means "light none". */
export function litCells(wins: LineWin[], phase: WinPhase): Set<string> {
  const keys = new Set<string>();
  if (phase.kind === 'idle') return keys;
  const shown =
    phase.kind === 'total' || phase.kind === 'settled'
      ? wins
      : [wins[phase.index]].filter(Boolean);
  for (const win of shown) {
    for (const [reel, row] of win?.cells ?? []) keys.add(`${reel},${row}`);
  }
  return keys;
}

export function cellKey(reel: number, row: number): string {
  return `${reel},${row}`;
}

interface WinLinesProps {
  wins: LineWin[];
  reels: number;
  phase: WinPhase;
  /** Measured width of the reels row, including the gaps between reels. */
  width: number;
  /** Symbol height in points. Must be whatever the reels are using. */
  cellHeight?: number;
  /**
   * Rows per reel.
   *
   * Needed because a ragged machine centres its reels on each other: row 0 of a
   * three-tall reel is not at the same height as row 0 of a five-tall one, and
   * an overlay that assumes it is draws every line on a diamond game through
   * empty space above the symbols it is meant to be connecting.
   */
  rows?: readonly number[];
  /**
   * This game pays by adjacency rather than along lines.
   *
   * Then there is no line to draw, and drawing one is a lie about the
   * mechanic: an "all ways pay" win counts a symbol wherever it lands on each
   * reel, so joining the cells asserts an order and a path that do not exist.
   * A ways win with one cell per reel looks exactly like a payline unless the
   * game says otherwise, which is why this is a flag rather than something
   * inferred from the shape of the win.
   */
  ways?: boolean;
}

/**
 * The drawn lines.
 *
 * Rendered as an SVG polyline through the centre of each winning cell, with a
 * wide soft stroke under a bright thin one — the standard way to make a line
 * read as lit rather than drawn, without a real glow filter.
 */
export function WinLines({
  wins,
  reels,
  phase,
  width,
  cellHeight = CELL_HEIGHT,
  rows,
  ways = false,
}: WinLinesProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const shown =
    phase.kind === 'idle'
      ? []
      : phase.kind === 'line'
        ? [wins[phase.index]!]
        : wins;

  // Re-pulse on every phase change so a walk between two lines that overlap is
  // still visibly a change rather than a static picture.
  const phaseKey = phase.kind === 'line' ? `line-${phase.index}` : phase.kind;
  useEffect(() => {
    if (phase.kind === 'idle') {
      fade.setValue(0);
      return;
    }
    if (phase.kind === 'settled') {
      // Arrive at full strength with no fade. A pulse here would be one last
      // flash after the presentation was supposed to have finished.
      fade.setValue(1);
      return;
    }
    fade.setValue(0.35);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [phaseKey, phase.kind, fade]);

  if (width <= 0 || shown.length === 0) return null;

  const reelWidth = (width - REEL_GAP * (reels - 1)) / reels;
  const centreX = (reel: number) => reel * (reelWidth + REEL_GAP) + reelWidth / 2;
  // Reels are centred on each other, so a short reel starts half the height
  // difference down the bay. On a rectangular machine every offset is zero.
  const tallest = rows ? Math.max(...rows) : 0;
  const centreY = (reel: number, row: number) => {
    const height = rows?.[reel] ?? tallest;
    const top = ((tallest - height) * cellHeight) / 2;
    return top + row * cellHeight + cellHeight / 2;
  };

  // During the walk the single line is the subject and gets the bright
  // treatment. In the total every line is on screen at once, so each is drawn
  // thinner — five bright ropes across a small grid is unreadable.
  const single = phase.kind === 'line';
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%">
        {shown.map((win) => {
          const cells = win.cells ?? [];
          if (cells.length < 2) return null;
          /*
           * A ways win is not a line and must not be drawn as one.
           *
           * "All ways pay" counts a symbol wherever it appears on each reel, so
           * a single win can hold three cells on reel one and two on reel two.
           * Joining those in order produces a scribble that doubles back on
           * itself and implies an order the mechanic does not have. What it
           * actually means is "these cells, all of them", so those get nodes
           * and a glow and no connecting line at all.
           *
           * The shape of the win is not enough to tell: a ways win that happens
           * to land one cell per reel is indistinguishable from a payline, and
           * the diamond games were drawing zig-zag lines across a machine that
           * has no paylines on it at all. The GAME has to say.
           */
          const perReel = new Set(cells.map(([reel]) => reel));
          const isLine = !ways && perReel.size === cells.length;
          const points = cells
            .map(([reel, row]) => `${centreX(reel)},${centreY(reel, row)}`)
            .join(' ');
          return (
            <React.Fragment key={win.line}>
              {isLine ? (
                <>
                  {/* The soft under-stroke that reads as glow. */}
                  <Polyline
                    points={points}
                    fill="none"
                    stroke={colors.gold.default}
                    strokeWidth={single ? 14 : 9}
                    strokeOpacity={0.28}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Polyline
                    points={points}
                    fill="none"
                    stroke={colors.feedback.winBright}
                    strokeWidth={single ? 3.5 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : null}
              {/* A node on each paying cell. On a line win, without these a
                  straight line through five cells gives no clue how many of
                  them paid. On a ways win they are the whole marking. */}
              {cells.map(([reel, row]) => (
                <React.Fragment key={`${reel}-${row}`}>
                  {isLine ? null : (
                    <Circle
                      cx={centreX(reel)}
                      cy={centreY(reel, row)}
                      r={single ? 15 : 11}
                      fill={colors.gold.default}
                      fillOpacity={0.22}
                    />
                  )}
                  <Circle
                    cx={centreX(reel)}
                    cy={centreY(reel, row)}
                    r={single ? 4.5 : 3}
                    fill={colors.feedback.winBright}
                  />
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        })}
      </Svg>
      {single ? (
        <LineBadge
          win={shown[0]!}
          reelWidth={reelWidth}
          cellHeight={cellHeight}
          centreY={centreY}
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * The value of the line currently being walked.
 *
 * Placed at the END of the line rather than the middle: the middle of a slot
 * grid is the busiest part of the screen and a label there covers the symbols
 * the player is being asked to look at.
 */
function LineBadge({
  win,
  reelWidth,
  cellHeight,
  centreY,
}: {
  win: LineWin;
  reelWidth: number;
  cellHeight: number;
  centreY: (reel: number, row: number) => number;
}) {
  const cells = win.cells ?? [];
  const last = cells[cells.length - 1];
  if (!last) return null;
  const [reel, row] = last;
  const x = reel * (reelWidth + REEL_GAP) + reelWidth / 2;
  const y = centreY(reel, row);

  return (
    <View
      style={[
        styles.badge,
        {
          left: Math.max(0, x - 34),
          // Sit above the cell, unless that is off the top of the grid.
          top: row === 0 ? y + cellHeight * 0.45 : y - cellHeight * 0.95,
        },
      ]}
    >
      <Txt variant="caption" color={colors.feedback.winBright}>
        {win.count}× {win.symbol}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(3, 6, 20, 0.88)',
    borderWidth: 1,
    borderColor: colors.gold.default,
  },
});
