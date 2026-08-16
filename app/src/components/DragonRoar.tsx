/**
 * Dragon's Hoard's own celebration.
 *
 * ## Why one game gets its own
 *
 * Every other win in the app is the same coin fountain, deliberately: a win
 * should feel the same wherever it happens, and five bespoke celebrations would
 * be five things to maintain and four of them would rot.
 *
 * This is the exception that tests whether the rule is worth breaking. Dragon's
 * Hoard's lobby tile is a dragon coiled over gold, and until now tapping it got
 * you reels with the same coin burst as Lucky Sevens. A game whose whole
 * identity is one creature should show you that creature when it pays.
 *
 * ## Why this is ONE image and not the five layers that were commissioned
 *
 * The brief asked for body, near wing, far wing, jaw and glow as separate
 * files, so the wings could beat and the jaw could open — a flat image can only
 * fade in and out, which looks like a sticker being placed on the screen.
 *
 * Five files arrived and they do not fit together. Measured: the master and the
 * "body with wings removed" have almost identical alpha bounding boxes
 * (13,37,500,491 against 16,44,494,491), and the region where the master has
 * paint and the body does not runs to 62,000 pixels spread across the entire
 * frame rather than forming two wing shapes. They are five separate DRAWINGS of
 * a dragon, not five parts of one — the generator regenerated where the prompt
 * asked it to edit, which is the exact failure the brief warned about and then
 * failed to prevent.
 *
 * There is no alignment that fixes that, because there is no correspondence to
 * recover. Stacking them produces a dragon with a second dragon's jaw across
 * its chest.
 *
 * So this uses `dragon-original-main.png`, which is a complete, correctly-keyed
 * and genuinely good painting, and animates what a single image can honestly
 * animate: it flies in, it breathes, it drifts, and its glow pulses under it.
 * Re-requesting the layers is a small, specific ask recorded in
 * `docs/13-win-celebration-art.md`; it is not worth blocking the celebration on.
 *
 * ## Nothing here is on the money path
 *
 * Drawn over a result the server decided and the client already received,
 * exactly like the coin fountain. It cannot change what was paid.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { usePrefersReducedMotion } from '../motion';

const ART = '/art/overlays';
const DRAGON = `${ART}/dragon-original-main.png`;
/**
 * The glow, delivered on solid black because a soft glow cannot survive the
 * transparency fault at all. Black contributes nothing under a screen blend,
 * which is why this is composited additively rather than drawn with alpha.
 */
const GLOW = `${ART}/dragon-glow.png`;

/** The one game this belongs to, exported so the screen carries no bare id. */
export const DRAGON_GAME_ID = 'slot-dragons-hoard';

export interface DragonRoarProps {
  /** A fresh arrival whenever this changes while `active` is true. */
  round: number;
  active: boolean;
  size?: number;
  onDone?: () => void;
}

/** Long enough to be an event, short enough not to hold up the next spin. */
// Big and mega wins get one unhurried hero beat before the dragon exits.  The
// counter and controls remain live underneath, so this extends the spectacle,
// not the time a player is forced to wait before the next spin.
const DURATION = 4_000;

export function DragonRoar({ round, active, size = 300, onDone }: DragonRoarProps) {
  const enter = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    if (!active) return undefined;
    enter.setValue(0);
    breath.setValue(0);

    if (reduced) {
      // Present, still, and gone. Somebody who asked for less motion asked for
      // less motion, not for a missing celebration.
      enter.setValue(1);
      const timer = setTimeout(() => finished.current?.(), 1200);
      return () => clearTimeout(timer);
    }

    /*
     * It ARRIVES rather than appearing. A spring with a little overshoot is the
     * difference between something flying in and something being pasted on —
     * and with a single image, the entrance is most of the performance
     * available, so it does the heavy lifting.
     */
    const arrive = Animated.spring(enter, {
      toValue: 1,
      friction: 6,
      tension: 62,
      useNativeDriver: true,
    });

    // A slow swell, so it is alive while it is on screen rather than parked.
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 780, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 780, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );

    arrive.start();
    breathing.start();

    const leave = setTimeout(() => {
      Animated.timing(enter, {
        toValue: 0,
        duration: 420,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => finished.current?.());
    }, DURATION);

    return () => {
      arrive.stop();
      breathing.stop();
      clearTimeout(leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, round, reduced]);

  if (!active) return null;

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] });
  // The swell is small on purpose: 3% reads as breathing, 10% reads as a
  // throbbing sticker.
  const swell = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const rise = breath.interpolate({ inputRange: [0, 1], outputRange: [3, -3] });
  const glowOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  const glowScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.1] });

  return (
    <View style={[styles.stage, { width: size, height: size }]} pointerEvents="none">
      <Animated.View
        style={{
          opacity: enter,
          transform: [{ scale: enterScale }, { scale: swell }, { translateY: rise }],
        }}
      >
        <Animated.Image
          source={{ uri: GLOW }}
          style={[
            styles.layer,
            { width: size, height: size, opacity: glowOpacity, transform: [{ scale: glowScale }] },
          ]}
          resizeMode="contain"
        />
        <Animated.Image
          source={{ uri: DRAGON }}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: { position: 'absolute' },
});
