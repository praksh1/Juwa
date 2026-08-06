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

/** Must match `SYMBOL_SIZE` in Reel.tsx — the one fixed dimension. */
export const CELL_HEIGHT = 58;
/** Must match the `gap` on the reels row in SlotsScreen. */
export const REEL_GAP = spacing.xs;

/** How long the combined total is shown before the per-line walk begins. */
const TOTAL_HOLD_MS = 1500;
/** How long each individual line is held during the walk. */
const LINE_HOLD_MS = 1100;

export type WinPhase =
  | { kind: 'idle' }
  /** Everything that paid, lit at once. */
  | { kind: 'total' }
  /** One line, by index into the win list. */
  | { kind: 'line'; index: number };

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
    // One line needs no walk: it is already fully explained by the total.
    if (wins.length < 2) return;

    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (generation.current !== mine) return;
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
  const shown = phase.kind === 'total' ? wins : [wins[phase.index]].filter(Boolean);
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
}

/**
 * The drawn lines.
 *
 * Rendered as an SVG polyline through the centre of each winning cell, with a
 * wide soft stroke under a bright thin one — the standard way to make a line
 * read as lit rather than drawn, without a real glow filter.
 */
export function WinLines({ wins, reels, phase, width }: WinLinesProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const shown = phase.kind === 'idle' ? [] : phase.kind === 'total' ? wins : [wins[phase.index]!];

  // Re-pulse on every phase change so a walk between two lines that overlap is
  // still visibly a change rather than a static picture.
  const phaseKey = phase.kind === 'line' ? `line-${phase.index}` : phase.kind;
  useEffect(() => {
    if (phase.kind === 'idle') {
      fade.setValue(0);
      return;
    }
    fade.setValue(0.35);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [phaseKey, phase.kind, fade]);

  if (width <= 0 || shown.length === 0) return null;

  const reelWidth = (width - REEL_GAP * (reels - 1)) / reels;
  const centreX = (reel: number) => reel * (reelWidth + REEL_GAP) + reelWidth / 2;
  const centreY = (row: number) => row * CELL_HEIGHT + CELL_HEIGHT / 2;

  // During the walk the single line is the subject and gets the bright
  // treatment. In the total every line is on screen at once, so each is drawn
  // thinner — five bright ropes across a small grid is unreadable.
  const single = phase.kind === 'line';
  const height = Math.max(...shown.flatMap((w) => (w.cells ?? []).map(([, r]) => r + 1)), 1);

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
          const points = cells.map(([reel, row]) => `${centreX(reel)},${centreY(row)}`).join(' ');
          return (
            <React.Fragment key={win.line}>
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
              {/* A node on each paying cell. Without these a straight line
                  through five cells gives no clue how many of them paid. */}
              {cells.map(([reel, row]) => (
                <Circle
                  key={`${reel}-${row}`}
                  cx={centreX(reel)}
                  cy={centreY(row)}
                  r={single ? 4.5 : 3}
                  fill={colors.feedback.winBright}
                />
              ))}
            </React.Fragment>
          );
        })}
      </Svg>
      {single ? <LineBadge win={shown[0]!} reelWidth={reelWidth} gridHeight={height} /> : null}
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
  gridHeight,
}: {
  win: LineWin;
  reelWidth: number;
  gridHeight: number;
}) {
  const cells = win.cells ?? [];
  const last = cells[cells.length - 1];
  if (!last) return null;
  const [reel, row] = last;
  const x = reel * (reelWidth + REEL_GAP) + reelWidth / 2;
  const y = row * CELL_HEIGHT + CELL_HEIGHT / 2;

  return (
    <View
      style={[
        styles.badge,
        {
          left: Math.max(0, x - 34),
          // Sit above the cell, unless that is off the top of the grid.
          top: row === 0 ? y + CELL_HEIGHT * 0.45 : y - CELL_HEIGHT * 0.95,
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
