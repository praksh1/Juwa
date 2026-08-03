/**
 * The Juwa wordmark.
 *
 * Previously this was the string "JUWA" in whatever font the browser defaulted
 * to, which is the single loudest signal a product has not been designed. A
 * wordmark drawn as vector paths is always the same shape on every device, and
 * needs no webfont download before the first screen can render.
 *
 * The letters are built from straight strokes and hard diagonals — a slab
 * treatment that survives being shrunk to a favicon and does not fight the
 * curved shapes everywhere else in the app.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, G } from 'react-native-svg';
import { colors, radius, spacing } from '@juwa/ui';
import { APP_NAME, APP_VERSION_LABEL } from '../brand';
import { Txt } from './primitives';

/**
 * Glyph outlines on a 100-unit em, drawn left to right. Each letter is a single
 * closed path so the gradient runs across the whole word rather than restarting
 * per letter.
 */
const GLYPHS = [
  // Each glyph owns a slot on the x axis and must not run into its neighbour:
  // J 56–128, U 148–228, W 248–364, A 380–460, with a ~20-unit gap between.
  // Getting this wrong is not subtle — an earlier A started at 328 and merged
  // with the W into a single unreadable blob.

  // J — stem with a hook at the foot.
  'M96,8 H128 V56 A28,28 0 0 1 100,84 H84 A28,28 0 0 1 56,56 V48 H88 V54 A8,8 0 0 0 96,62 V8 Z',
  // U — two stems joined by a bowl.
  'M148,8 H180 V54 A8,8 0 0 0 196,54 V8 H228 V56 A44,44 0 0 1 148,56 Z',
  // W — four diagonals.
  'M248,8 H280 L288,50 L296,20 H316 L324,50 L332,8 H364 L344,84 H312 L306,58 L300,84 H268 Z',
  // A — apex, legs, and a counter cut out of the middle. The second subpath is
  // the counter and relies on the even-odd fill rule to punch through.
  'M380,84 H408 L412,66 H428 L432,84 H460 L434,8 H406 Z M420,30 L430,58 H410 Z',
];

/**
 * The version lockup.
 *
 * Drawn as a badge beside the wordmark rather than as two more glyph paths.
 * Digits and a full stop would need three new outlines that have to sit
 * convincingly next to hand-drawn letterforms, and a small type badge is both
 * more legible at nav size and trivially editable when the number changes —
 * which, being a version number in a product name, it eventually will.
 */
export function Logo({
  height = 40,
  showVersion = true,
}: {
  height?: number;
  showVersion?: boolean;
}) {
  // The glyph box runs 56 → 460 on the x axis with an 8 → 84 cap height; the
  // viewBox adds 4 units of bleed each side for the offset shadow copy.
  const width = height * (412 / 92);

  return (
    <View style={styles.lockup} accessibilityRole="header" accessibilityLabel={APP_NAME}>
      <Svg width={width} height={height} viewBox="52 0 412 92">
        <Defs>
          <LinearGradient id="juwa-wordmark" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.gold.light} />
            <Stop offset="0.5" stopColor={colors.gold.default} />
            <Stop offset="1" stopColor="#E08A00" />
          </LinearGradient>
        </Defs>

        {/* Offset copy behind the word, so the mark has weight against the
            navy rather than floating on it. */}
        <G transform="translate(0,5)" opacity={0.55}>
          {GLYPHS.map((d, i) => (
            <Path key={i} d={d} fill={colors.neon.magenta} fillRule="evenodd" />
          ))}
        </G>
        {GLYPHS.map((d, i) => (
          <Path key={i} d={d} fill="url(#juwa-wordmark)" fillRule="evenodd" />
        ))}
      </Svg>

      {showVersion ? (
        <View style={[styles.badge, { paddingVertical: Math.max(2, height * 0.06) }]}>
          <Txt
            variant="caption"
            color={colors.gold.default}
            style={[styles.badgeText, { fontSize: Math.max(9, height * 0.28) }]}
          >
            {APP_VERSION_LABEL}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    backgroundColor: colors.gold.wash,
  },
  badgeText: { letterSpacing: 0.6, fontVariant: ['tabular-nums'] },
});
