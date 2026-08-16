/**
 * A restrained near-miss beat: one scatter says "1", then the second says
 * "2".  Three is intentionally left to the feature/free-spin intro, which is
 * the louder reward and should not compete with a little counter card.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

export function ScatterCallout({ count, round, accent }: { count: number; round: number; accent: string }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.58)).current;

  useEffect(() => {
    let cancelled = false;
    const beat = (value: number) => new Promise<void>((resolve) => {
      setShown(value);
      opacity.setValue(0);
      scale.setValue(reduced ? 1 : 0.58);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: reduced ? 1 : 150, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1.08, friction: 5, tension: 120, useNativeDriver: true }),
        ]),
        Animated.timing(scale, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.delay(reduced ? 520 : 680),
        Animated.timing(opacity, { toValue: 0, duration: reduced ? 1 : 220, useNativeDriver: true }),
      ]).start(() => resolve());
    });
    const run = async () => {
      // Do not announce a full trigger as "1", "2", "3"; the bonus intro is
      // a single clean payoff.  This component owns only the anticipation.
      if (count < 1 || count >= 3) return;
      await beat(1);
      if (!cancelled && count >= 2) await beat(2);
      if (!cancelled) setShown(0);
    };
    void run();
    return () => { cancelled = true; opacity.stopAnimation(); scale.stopAnimation(); };
  }, [accent, count, opacity, reduced, round, scale]);

  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity, transform: [{ scale }] }]} accessibilityElementsHidden>
      <View style={[styles.badge, { borderColor: accent, shadowColor: accent }]}>
        <Txt variant="h2" style={[styles.number, { color: accent }]}>{shown}</Txt>
        <View>
          <Txt variant="caption" style={styles.label}>SCATTER</Txt>
          <Txt variant="caption" style={styles.subLabel}>{shown === 1 ? 'ONE LANDED' : 'TWO LANDED'}</Txt>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: '32%', alignItems: 'center', zIndex: 5 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(5, 7, 20, 0.9)', borderWidth: 2, shadowOpacity: 0.9, shadowRadius: 12, elevation: 8 },
  number: { fontWeight: '900', lineHeight: 31 },
  label: { color: '#FFF2C1', fontWeight: '900', letterSpacing: 1.6 },
  subLabel: { color: 'rgba(255,255,255,0.68)', fontWeight: '700', letterSpacing: 0.8, fontSize: 9 },
});
