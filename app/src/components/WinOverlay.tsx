/**
 * The full-screen BIG WIN / MEGA WIN moment.
 *
 * This is the payoff the rest of the machine exists to set up, and it is the
 * one place where being loud is correct. It only appears at the model's own big
 * threshold and above, which is roughly once in ninety spins — rarity is what
 * makes it land. An overlay a player sees every few spins is an interruption.
 *
 * It never blocks the SPIN button. A celebration a player has to wait out is a
 * celebration they resent by the third time, so this sits above the reels,
 * ignores touches, and dismisses itself.
 *
 * ## Why it was reported as "very brief" — measured, not guessed
 *
 * The banner held for `rollUpDuration(tier) + 1200`, which on a big win is 3.4
 * seconds. Decoded, the fanfare it plays under is 3.79s or 7.03s depending on
 * the game — so the banner was gone before its own music on **all 23 games**,
 * and by nearly four seconds on twelve of them. The player hears a celebration
 * for something that is no longer on the screen.
 *
 * Two changes, together. `api/sound-sets` now puts the four SHORT recordings in
 * the big-win pool and the four seven-second ones in the mega pool, which is
 * what its own comment always claimed it did; and the holds below outlast what
 * is left. Measured after both: 3.79s of fanfare under a 5.2s big-win banner,
 * 7.03s under a 7.2s mega.
 *
 * Length alone is not the fix, though — a still picture held for five seconds
 * is not five seconds of celebration, it is a four-second pause after a
 * one-second one. So the card now does something for the whole time it is up:
 * rays turning behind it, a shine crossing the banner, and a slow breath.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing } from '@juwa/ui';
import { ChaseLights } from './ChaseLights';
import { ShellBurst } from './ShellBurst';
import { WinMeter } from './WinMeter';
import { usePrefersReducedMotion, celebrationDuration, type WinTier } from '../motion';

/**
 * The painted banners, by tier.
 *
 * Served from `art/`, which the web build copies verbatim — the same route the
 * symbols and tiles take.
 */
const BANNER_BIG = '/art/overlays/banner-big-win.png';
const BANNER_MEGA = '/art/overlays/banner-mega-win.png';
const BANNER_JACKPOT = '/art/overlays/banner-jackpot.png';

/**
 * The banners' own shape, measured off the files: 512 × 253 on all three.
 *
 * THIS NUMBER IS THE FIX for "the banner became elongated".
 *
 * The style was `{ width: '100%', height: 138 }` with `resizeMode="contain"`,
 * and contain fits the art INSIDE that box without distorting it. A 2.02:1
 * picture in a 138-point-tall box is 279 points wide — no matter how wide the
 * box is. So widening the card from 260 points to 96% of the screen did not
 * enlarge the banner by a single pixel; it added empty gold gradient around a
 * banner that stayed exactly where it was, which is precisely what "elongated"
 * describes. The lettering inside the art stayed the size it had always been,
 * which is "so so tiny".
 *
 * An aspect ratio has no such ceiling: the banner is now as wide as the card
 * and as tall as that width requires, so making the card bigger makes the
 * words bigger, which was the intention all along.
 */
const BANNER_ASPECT = 512 / 253;

export function WinOverlay({
  tier,
  amount,
  round,
  onDone,
}: {
  tier: WinTier;
  amount: number;
  round: number;
  onDone?: () => void;
}) {
  const visible = tier === 'big' || tier === 'mega' || tier === 'jackpot';
  const reducedMotion = usePrefersReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  /** The slow breath under the whole card, so it is alive while it is held. */
  const breathe = useRef(new Animated.Value(0)).current;
  /** The rays turning behind it. */
  const turn = useRef(new Animated.Value(0)).current;
  /** The shine crossing the banner. */
  const shine = useRef(new Animated.Value(0)).current;
  /**
   * The area the fireworks have to play in.
   *
   * Measured rather than taken from the window: this layer fills the live game
   * stage. The celebration is intentionally allowed over the cabinet, header
   * and console, but stays inside the app instead of escaping into browser UI.
   */
  const [stage, setStage] = React.useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!visible) return;

    enter.setValue(0);
    breathe.setValue(0);
    turn.setValue(0);
    shine.setValue(0);

    /*
     * It SLAMS in, over-large, and settles.
     *
     * The old entrance grew from 55% to 100%, which reads as something being
     * placed on the screen. Arriving oversized and shrinking to fit reads as
     * something landing on it — and the cabinet shake below fires at the same
     * instant, so the two are one impact rather than two effects.
     */
    const arrive = reducedMotion
      ? Animated.timing(enter, { toValue: 1, duration: 1, useNativeDriver: true })
      : Animated.spring(enter, {
          toValue: 1,
          friction: 5.5,
          tension: 110,
          useNativeDriver: true,
        });

    const loops: Animated.CompositeAnimation[] = [];
    if (!reducedMotion) {
      loops.push(
        Animated.loop(
          Animated.timing(turn, {
            toValue: 1,
            duration: tier === 'jackpot' ? 9_000 : 12_000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(breathe, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(breathe, { toValue: 0, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        ),
        // A sweep, then a pause, then another. Back to back it reads as a
        // strobe; spaced out it reads as light moving over metal.
        Animated.loop(
          Animated.sequence([
            Animated.delay(420),
            Animated.timing(shine, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.delay(700),
            Animated.timing(shine, { toValue: 0, duration: 1, useNativeDriver: true }),
          ]),
        ),
      );
    }

    arrive.start();
    for (const loop of loops) loop.start();

    // Long enough for the roll-up to finish, then long enough to read the
    // number and hear the fanfare out. See `celebrationHold` in ../motion —
    // the round and the auto-spin gap read the same function, so none of the
    // three can drift out from under the other two.
    const timer = setTimeout(() => onDone?.(), celebrationDuration(tier));
    return () => {
      arrive.stop();
      for (const loop of loops) loop.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, round, tier, reducedMotion]);

  if (!visible) return null;

  const jackpot = tier === 'jackpot';
  const mega = tier === 'mega';
  const banner = jackpot ? BANNER_JACKPOT : mega ? BANNER_MEGA : BANNER_BIG;

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [1.45, 1] });
  // Deliberately small. 3% reads as a held breath; 10% reads as a throbbing
  // sticker, which is what a celebration must never look like.
  const swell = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.028] });
  const rayTurn = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rayFade = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] });
  const sweep = shine.interpolate({ inputRange: [0, 1], outputRange: [-260, 260] });

  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setStage((current) =>
          Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
            ? current
            : { width, height },
        );
      }}
    >
      {/*
        Fireworks, behind everything.

        The rays below read as "lit from behind", which is a static property of
        the moment. These are EVENTS — six shells that rise, break and fall
        across the banner's life — and an eye is caught by each one. That is the
        difference between a held picture and a celebration.

        Only on the two loudest tiers. A big win every ninety spins can afford
        rays and a shine; fireworks belong to the ones worth interrupting for.
      */}
      <ShellBurst
        width={stage.width}
        height={stage.height}
        round={round}
        active={mega || jackpot}
      />

      {/*
        The rays, BEHIND the card and larger than it.

        A rectangle that appears and sits there is a dialog. The turning
        starburst is what makes the same rectangle read as lit from behind, and
        it costs one rotating transform on a single path.
      */}
      <Animated.View
        style={[
          styles.rays,
          { opacity: rayFade, transform: [{ scale: enter }, { rotate: rayTurn }] },
        ]}
      >
        <Svg width={RAY_SIZE} height={RAY_SIZE} viewBox="0 0 100 100">
          <Path
            d={starburst(50, 50, 50, jackpot ? 20 : 16)}
            fill={jackpot ? '#FFF3CE' : mega ? '#FF7ABA' : colors.gold.default}
            opacity={0.2}
          />
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          { opacity: enter, transform: [{ scale: enterScale }, { scale: swell }] },
        ]}
      >
        <LinearGradient
          colors={
            jackpot
              ? // White-gold, so the top tier is not simply "the pink one
                // again" — a jackpot has to be visibly its own event.
                ['#FFF3CE', '#E8BC4E', '#3A2A05']
              : mega
                ? ['#FF3D8A', '#7C3AED', '#08070E']
                : [colors.gold.default, '#7A6425', '#08070E']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/*
          The painted banner, in place of the words.

          "Big Win" set in the app's UI face is a label; the banner is a prop —
          gold scrollwork, set gems, dimensional lettering — and it is the same
          object a player has seen on the lobby tiles. It carries the tier by
          being a different banner rather than by different text, so the two
          moments are told apart at a glance rather than by reading.

          The text stays as the accessible name: the image has no words as far
          as a screen reader is concerned.
        */}
        <Image
          source={{ uri: banner }}
          style={styles.banner}
          resizeMode="contain"
          accessibilityLabel={jackpot ? 'Jackpot' : mega ? 'Mega win' : 'Big win'}
        />
        {/*
          The amount, on a plaque.

          It used to be the same number set in the UI's own face, which is a
          caption — and it lost every contest with the painted banner above it.
          The banner says what KIND of win this was; the meter says HOW MUCH,
          which is the part the player is waiting for.
        */}
        <WinMeter amount={amount} tier={tier} />

        {/*
          The bulbs set into the frame.

          Inside the card rather than around its edge, because the card clips
          its own overflow for the shine below — lamps hung outside would be cut
          in half. Set just in from the border, which is where a cabinet puts
          them anyway.

          This is the cheapest thing in the founder's reference video and one of
          the loudest: a rainbow of bulbs running around the win frame. No
          artwork, one animated value, twenty-eight interpolations of it.
        */}
        <ChaseLights
          count={jackpot ? 36 : 28}
          size={jackpot ? 8 : 7}
          duration={jackpot ? 1_300 : mega ? 1_500 : 1_800}
          inset={6}
        />

        {/*
          The shine, over everything and clipped by the card.

          A tilted bar of light dragged across the face. It is the cheapest
          effect here and the one that does most for "this looks expensive",
          because it is what a real gold prop does under a moving spotlight.
        */}
        <Animated.View
          style={[styles.shine, { transform: [{ translateX: sweep }, { rotate: '18deg' }] }]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** The size of the ray fan, in points. Bigger than the card, on purpose. */
const RAY_SIZE = 460;

/**
 * A starburst: `points` triangular rays meeting at the centre.
 *
 * Drawn rather than assembled from rotated views because a dozen absolutely
 * positioned rectangles is a dozen layers to composite, and this is one path.
 */
function starburst(cx: number, cy: number, r: number, points: number): string {
  const parts: string[] = [];
  const step = (Math.PI * 2) / points;
  for (let i = 0; i < points; i += 1) {
    const a = step * i;
    // A third of the gap, so the rays are separated by twice their own width.
    const half = step / 6;
    const x1 = cx + r * Math.cos(a - half);
    const y1 = cy + r * Math.sin(a - half);
    const x2 = cx + r * Math.cos(a + half);
    const y2 = cy + r * Math.sin(a + half);
    parts.push(`M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} Z`);
  }
  return parts.join(' ');
}

/**
 * The cabinet shake.
 *
 * Wraps the reels rather than the whole screen: shaking the bet controls and
 * the balance makes the app feel broken, and shaking text is the fastest way to
 * make someone put a phone down. Silent under reduced motion.
 */
export function useCabinetShake(tier: WinTier, round: number): Animated.Value {
  return useWinShake(tier, round, 'cabinet');
}

/**
 * A lighter impact reserved for a screen-level celebration. The cabinet still
 * has its own mechanical nudge; this is the coordinated jolt that makes a
 * Big Win feel as though the phone's entire game stage reacted to it.
 */
export function useScreenShake(tier: WinTier, round: number): Animated.Value {
  return useWinShake(tier, round, 'screen');
}

function useWinShake(
  tier: WinTier,
  round: number,
  scope: 'cabinet' | 'screen',
): Animated.Value {
  const offset = useRef(new Animated.Value(0)).current;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    // A whole-page movement is an event, not a response to every ordinary
    // line win. Keeping it to the three headline tiers makes the impact rare.
    if (reducedMotion || tier === 'none' || (scope === 'screen' && (tier === 'win' || tier === 'burst'))) return;

    // A real cabinet answers every win with a physical response. Small wins
    // only get a two-pixel nudge; large tiers still hit hard enough to feel
    // like the machine has landed on its own feet.
    const amplitude =
      scope === 'screen'
        ? tier === 'big'
          ? 2
          : tier === 'mega'
            ? 4
            : 6
        : tier === 'win'
          ? 2
          : tier === 'burst'
            ? 4
            : tier === 'big'
              ? 7
              : tier === 'mega'
                ? 11
                : 14;
    const shakes =
      scope === 'screen'
        ? tier === 'big'
          ? 4
          : tier === 'mega'
            ? 6
            : 8
        : tier === 'win'
          ? 2
          : tier === 'burst'
            ? 4
            : tier === 'big'
              ? 6
              : tier === 'mega'
                ? 9
                : 11;
    const sequence = Array.from({ length: shakes }, (_, i) =>
      Animated.timing(offset, {
        toValue: (i % 2 === 0 ? 1 : -1) * amplitude * (1 - i / shakes),
        duration: 55,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const animation = Animated.sequence([
      ...sequence,
      Animated.timing(offset, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      offset.setValue(0);
    };
  }, [tier, round, scope, reducedMotion, offset]);

  return offset;
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  rays: {
    position: 'absolute',
    width: RAY_SIZE,
    height: RAY_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    /*
     * Nearly the whole screen, and the padding is now small on purpose.
     *
     * `alignSelf: stretch` plus a percentage width, rather than a minimum: a
     * minWidth only sets a floor, so the card was free to shrink-wrap its
     * contents — and its widest content was a banner that could not grow. The
     * card ended up sized by the thing it was supposed to be sizing.
     *
     * The horizontal padding came down from 16 to 8 because every point of it
     * is a point the banner does not get, and the gradient inside the frame is
     * a backing for the art rather than a mount for it.
     */
    width: '96%',
    maxWidth: 560,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.gold.light,
    alignItems: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  /*
   * As wide as the card, as tall as that makes it.
   *
   * On a 390-point phone this is a 358-point banner against the 279 points a
   * fixed 138-point height allowed — a third larger, and every word inside the
   * art grows with it. See BANNER_ASPECT for why the old rule could not.
   */
  banner: { width: '100%', aspectRatio: BANNER_ASPECT, marginBottom: spacing.sm },
  shine: {
    position: 'absolute',
    top: -60,
    bottom: -60,
    width: 70,
    left: '50%',
    marginLeft: -35,
  },
});
