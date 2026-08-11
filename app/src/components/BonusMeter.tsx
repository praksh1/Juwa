/**
 * The bonus, explained on the machine itself.
 *
 * ## Two failed attempts, and what they taught
 *
 * The first version was a small spinning wheel with "0/3" under it. The founder
 * asked, correctly, "why is the wheel there, what is the point" — a progress
 * bar towards an unnamed prize explains nothing.
 *
 * The second added the prize: "0/3 SCATTER" over "BONUS WHEEL". Better, and
 * still wrong, and the video of it is worth describing exactly. The counter
 * read 0/3, then 1/3, then back to 0/3, then "ONE MORE!", then 0/3 again — a
 * number changing every few seconds with no visible cause, because it counts
 * the CURRENT spin and resets on the next one. To the player it looked like a
 * score that kept being taken away.
 *
 * The real defect underneath: a player cannot tell WHICH symbol a scatter is.
 * Triple Bar's reels carry a five-pointed star AND a star-in-a-circle. Only one
 * of them is the scatter, they are the same colour, and nothing on screen ever
 * said which. So the counter was reporting on an event the player could not see
 * happening. No amount of labelling a number fixes that.
 *
 * ## What this does instead
 *
 * It is an INSTRUCTION, not a scoreboard. At rest it always says the same
 * thing, and the thing it says is the rule:
 *
 *      LAND 3        [the actual scatter symbol, drawn]        BONUS WHEEL
 *
 * That text does not change, does not count, and does not reset. It is the
 * machine's glass — the panel above the reels on a real cabinet that tells you
 * what the game does before you have played it once.
 *
 * The lamps only appear when a scatter is ACTUALLY ON THE REELS in front of the
 * player. Zero scatters shows no lamps at all, so there is nothing to watch go
 * up and come back down. One or two lights up and says so, which is a near miss
 * and reads as one. That is the only state that changes, and it changes because
 * something visible happened.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { SlotSymbol } from './SlotSymbol';
import { usePrefersReducedMotion } from '../motion';

/** What landing the scatters actually gets you. */
export type BonusReward =
  | { kind: 'wheel'; segments: number[] }
  | { kind: 'free-spins'; spins: number; multiplier: number };

export interface BonusMeterProps {
  reward: BonusReward;
  /** Scatters visible on the reels right now, 0 upward. */
  scatters: number;
  /** How many are needed. Three, for every game in the catalogue today. */
  trigger: number;
  /** True while the bonus is actually running — the panel says so. */
  active: boolean;
  /** The art family, so the symbol drawn matches the one on these reels. */
  family?: string;
}

export function BonusMeter({ reward, scatters, trigger, active, family }: BonusMeterProps) {
  const reduced = usePrefersReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const armed = scatters >= trigger - 1 && !active;

  /**
   * The wheel turns, at a speed you can actually see.
   *
   * It was fourteen seconds a revolution, which is about eight degrees a second
   * — slow enough that the founder reported the wheel had stopped spinning. It
   * had not; it was moving too slowly to read as movement, which is worse than
   * being still because it looks like something that has broken. Five seconds
   * is unmistakably turning and still slow enough to stay scenery beside the
   * reels, which are the thing being watched.
   */
  useEffect(() => {
    if (reduced || reward.kind !== 'wheel') return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 5_000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, spin, reward.kind]);

  /** One scatter short: the panel pulses, because it is nearly happening. */
  useEffect(() => {
    if (!armed || reduced) {
      glow.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [armed, reduced, glow]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  // The free-spins badge already draws the count, so the words underneath must
  // not repeat it — "8 / 8 FREE SPINS" reads as a fraction.
  const rewardLabel = reward.kind === 'wheel' ? 'BONUS\nWHEEL' : 'FREE\nSPINS';

  return (
    <View
      style={[styles.wrap, armed && styles.wrapArmed]}
      accessibilityRole="text"
      accessibilityLabel={
        `Bonus: land ${trigger} scatter symbols to win ` +
        (reward.kind === 'wheel' ? 'the bonus wheel' : `${reward.spins} free spins`) +
        (scatters > 0 ? `. ${scatters} on the reels now.` : '.')
      }
    >
      {/*
        THE RULE. Never changes, never counts, never resets.

        "LAND 3" over the symbol you have to land three OF — which is the fact
        that was missing, and the reason a counter could not help. Two symbols
        on these reels look like stars; this says which one matters.
      */}
      <Txt variant="caption" color={colors.text.muted} style={styles.rule}>
        LAND {trigger}
      </Txt>
      <Animated.View style={[styles.symbol, { transform: [{ scale }] }]}>
        <SlotSymbol name="SCATTER" size={34} {...(family ? { family } : {})} />
      </Animated.View>

      <Txt variant="caption" color={colors.text.muted} style={styles.rule}>
        TO WIN
      </Txt>

      <Animated.View style={{ transform: [{ scale }] }}>
        {reward.kind === 'wheel' ? (
          <Animated.View style={{ transform: [{ rotate }] }}>
            <MiniWheel segments={reward.segments} />
          </Animated.View>
        ) : (
          <FreeSpinsBadge spins={reward.spins} />
        )}
      </Animated.View>

      <Txt
        variant="caption"
        color={armed ? colors.gold.light : colors.text.secondary}
        style={styles.reward}
      >
        {rewardLabel}
      </Txt>

      {/*
        The only part that moves, and it appears only when something the player
        can SEE has happened. No scatters on the reels means no lamps at all —
        there is nothing to watch go up and come back down.
      */}
      {active ? (
        <Txt variant="caption" color={colors.gold.light} style={styles.state}>
          RUNNING
        </Txt>
      ) : scatters > 0 ? (
        <View style={styles.lampRow}>
          <View style={styles.lamps}>
            {Array.from({ length: trigger }, (_, i) => (
              <View key={i} style={[styles.lamp, i < scatters && styles.lampLit]} />
            ))}
          </View>
          <Txt variant="caption" color={colors.gold.light} style={styles.state}>
            {armed ? 'ONE MORE!' : `${scatters} ON REELS`}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The prize for a free-spins game, drawn rather than written twice.
 *
 * The wheel games have a picture of the thing you win; the free-spins games had
 * only words, which made them the plainer half of the catalogue for no reason
 * other than that a wheel is easier to draw than a spin.
 */
function FreeSpinsBadge({ spins }: { spins: number }) {
  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="bm-fs" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#FFF3CE" />
          <Stop offset="0.45" stopColor="#F0C44E" />
          <Stop offset="1" stopColor="#7A5210" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={22} fill="#1A1330" stroke="url(#bm-fs)" strokeWidth={2} />
      {/* A circular arrow: the universal mark for "again, for nothing". */}
      <Path
        d="M24 10 A14 14 0 1 1 12.5 16.5"
        fill="none"
        stroke="url(#bm-fs)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Path d="M24 5.5 L24 14.5 L30 10 Z" fill="url(#bm-fs)" />
      {/* The count sits inside the loop, on its own disc so it stays legible
          against the arrow behind it. */}
      <Circle cx={24} cy={27} r={10} fill="#0E0A1C" opacity={0.88} />
      <SvgText
        x={24}
        y={31}
        fontSize={13}
        fontWeight="900"
        fill="#F5D06A"
        textAnchor="middle"
      >
        {spins}
      </SvgText>
    </Svg>
  );
}

/**
 * The wheel's face, drawn from the real segments.
 *
 * Small enough that the numbers would be unreadable, so it does not try: what
 * carries at this size is the alternating wedges and the gold rim, which is
 * what makes it recognisable as the same object that fills the screen when it
 * fires.
 */
function MiniWheel({ segments }: { segments: number[] }) {
  const count = Math.max(4, segments.length);
  const R = 21;
  const best = Math.max(...segments);
  const wedges = Array.from({ length: count }, (_, i) => {
    const from = (i / count) * Math.PI * 2 - Math.PI / 2;
    const to = ((i + 1) / count) * Math.PI * 2 - Math.PI / 2;
    const x1 = 24 + R * Math.cos(from);
    const y1 = 24 + R * Math.sin(from);
    const x2 = 24 + R * Math.cos(to);
    const y2 = 24 + R * Math.sin(to);
    return (
      <Path
        key={i}
        d={`M24 24 L${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} Z`}
        fill={segments[i] === best ? '#F5D06A' : i % 2 === 0 ? '#7A1428' : '#4A0C1A'}
        stroke="#2A0409"
        strokeWidth={0.6}
      />
    );
  });

  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="bm-rim" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#F7E6A8" />
          <Stop offset="0.5" stopColor="#C8A44D" />
          <Stop offset="1" stopColor="#6E5210" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={23} fill="url(#bm-rim)" />
      <G>{wedges}</G>
      <Circle cx={24} cy={24} r={4.5} fill="url(#bm-rim)" stroke="#2A0409" strokeWidth={0.8} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    maxWidth: 84,
  },
  wrapArmed: {
    borderColor: colors.gold.default,
    backgroundColor: 'rgba(200,164,77,0.14)',
  },
  symbol: { marginVertical: 1 },
  rule: { fontWeight: '800', letterSpacing: 0.6, fontSize: 9, lineHeight: 11 },
  reward: {
    fontWeight: '900',
    letterSpacing: 0.3,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  lampRow: { alignItems: 'center', gap: 2, marginTop: 2 },
  lamps: { flexDirection: 'row', gap: 3 },
  lamp: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  lampLit: { backgroundColor: colors.gold.default, borderColor: colors.gold.light },
  state: { fontWeight: '900', letterSpacing: 0.3, fontSize: 9, lineHeight: 11 },
});
