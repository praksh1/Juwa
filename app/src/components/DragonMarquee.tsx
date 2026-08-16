/**
 * Dragon's Hoard's own moving title glass.
 *
 * This belongs to one cabinet only. It is deliberately drawn rather than an
 * image so its beveled lettering and animated glow stay sharp at phone and
 * desktop sizes without a second, stretched title asset.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { usePrefersReducedMotion } from '../motion';

export function DragonMarquee({ height }: { height: number }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      sweep.setValue(0.35);
      breath.setValue(0.5);
      return undefined;
    }
    const lights = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const pass = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(sweep, { toValue: 1, duration: 1_350, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(1_100),
        Animated.timing(sweep, { toValue: 0, duration: 1, useNativeDriver: true }),
      ]),
    );
    lights.start();
    pass.start();
    return () => {
      lights.stop();
      pass.stop();
    };
  }, [breath, reduced, sweep]);

  const eyeOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const titleScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] });
  const shineX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-260, 420] });

  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none" accessibilityLabel="Dragon's Hoard">
      <LinearGradient colors={['#180206', '#6F100E', '#D3511A', '#54100B', '#120106']} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="dragon-title" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF0B0" />
            <Stop offset="0.25" stopColor="#FFB94A" />
            <Stop offset="0.58" stopColor="#E74718" />
            <Stop offset="1" stopColor="#6A0908" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="2" y="2" width="296" height="56" rx="6" fill="none" stroke="#F8D46B" strokeOpacity="0.9" strokeWidth="1.6" />
        <Rect x="6" y="6" width="288" height="48" rx="4" fill="none" stroke="#3A0405" strokeWidth="2" />
        {/* Two serpentine strokes imply a dragon coiled around the sign. */}
        <Path d="M8 43 C26 19 40 51 58 30 C72 12 87 15 100 26" fill="none" stroke="#F0A838" strokeOpacity="0.7" strokeWidth="2.2" />
        <Path d="M292 43 C274 19 260 51 242 30 C228 12 213 15 200 26" fill="none" stroke="#F0A838" strokeOpacity="0.7" strokeWidth="2.2" />
      </Svg>
      <Animated.View style={[styles.title, { transform: [{ scale: titleScale }] }]}>
        <Svg width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="xMidYMid meet">
          <SvgText x="150" y="40" fontSize="28" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif" textAnchor="middle" letterSpacing="1.4" fill="#1C0203" stroke="#1C0203" strokeWidth="7">
            DRAGON'S HOARD
          </SvgText>
          <SvgText x="150" y="38" fontSize="28" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif" textAnchor="middle" letterSpacing="1.4" fill="url(#dragon-title)" stroke="#FFD875" strokeWidth="1.1">
            DRAGON'S HOARD
          </SvgText>
          <SvgText x="150" y="29" fontSize="28" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif" textAnchor="middle" letterSpacing="1.4" fill="rgba(255,255,255,0.45)">
            DRAGON'S HOARD
          </SvgText>
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.eye, styles.eyeLeft, { opacity: eyeOpacity }]} />
      <Animated.View style={[styles.eye, styles.eyeRight, { opacity: eyeOpacity }]} />
      <Animated.View style={[styles.shine, { transform: [{ translateX: shineX }, { rotate: '18deg' }] }]}>
        <LinearGradient colors={['transparent', 'rgba(255,250,210,0.62)', 'transparent']} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden', justifyContent: 'center', borderBottomWidth: 2, borderColor: '#8D4312' },
  title: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', top: '43%', width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3A20', shadowColor: '#FF4A25', shadowOpacity: 0.95, shadowRadius: 8, elevation: 6 },
  eyeLeft: { left: '11%' },
  eyeRight: { right: '11%' },
  shine: { position: 'absolute', top: -50, bottom: -50, left: 0, width: 50 },
});
