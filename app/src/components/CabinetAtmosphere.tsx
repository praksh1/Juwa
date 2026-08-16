/**
 * The ambient layer that makes a reel bay feel housed in a cabinet rather than
 * placed on a flat app card.  It is intentionally shared: the game room still
 * supplies each machine's identity, while the bulbs, smoked glass and moving
 * reflection supply the physical-casino language common to every machine.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePrefersReducedMotion } from '../motion';

const THEATRE = '/art/atmosphere/cabinet-theatre-v1.png';

export function CabinetAtmosphere() {
  const reduced = usePrefersReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      sweep.setValue(0.45);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 6_800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(1_600),
        Animated.timing(sweep, { toValue: 0, duration: 1, useNativeDriver: true }),
        Animated.delay(2_400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);

  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-260, 260] });
  const opacity = sweep.interpolate({ inputRange: [0, 0.3, 0.72, 1], outputRange: [0, 0.05, 0.17, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      {/* Original art, deliberately held back so every game's own room remains visible. */}
      <Image source={{ uri: THEATRE }} style={styles.theatre} resizeMode="cover" />
      {/* A broad, infrequent reflection moving over the protective glass. */}
      <Animated.View style={[styles.sweep, { opacity, transform: [{ translateX }, { rotate: '-12deg' }] }]}>
        <LinearGradient
          colors={['rgba(255,224,150,0)', 'rgba(255,235,183,0.58)', 'rgba(255,224,150,0)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View style={styles.glass} />
    </View>
  );
}

const styles = StyleSheet.create({
  theatre: { ...StyleSheet.absoluteFillObject, opacity: 0.3 },
  // Wider than the bay, so the edges never enter the picture while it moves.
  sweep: { position: 'absolute', top: '-30%', bottom: '-30%', width: 160, left: '50%', marginLeft: -80 },
  // A small smoked-glass veil ties a bright tile and the theatre art together.
  glass: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2, 4, 13, 0.12)' },
});
