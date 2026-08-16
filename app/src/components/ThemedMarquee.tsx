/**
 * Per-machine animated title glass.
 *
 * Rules, symbols and controls stay in their own systems. This component only
 * gives each cabinet a recognisable moving identity: a fruit machine's bulbs,
 * an ocean machine's ripples, a storm machine's lightning, and so on.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { usePrefersReducedMotion } from '../motion';

type Theme = { primary: string; secondary: string; accent: string };
type Flavor = 'bulbs' | 'cards' | 'ripple' | 'sunset' | 'stars' | 'neon' | 'sand' | 'frost' | 'jade' | 'carnival' | 'city' | 'spice' | 'aurora' | 'vault' | 'nova' | 'pharaoh' | 'storm';

const FLAVORS: Record<string, Flavor> = {
  'juwa-classic-slots': 'bulbs',
  'slot-triple-bar': 'bulbs',
  'slot-fruit-stand': 'bulbs',
  'slot-lucky-sevens': 'bulbs',
  'slot-emerald-nights': 'jade',
  'slot-royal-flush': 'cards',
  'slot-ocean-drift': 'ripple',
  'slot-sunset-strip': 'sunset',
  'slot-midnight-gold': 'stars',
  'slot-neon-alley': 'neon',
  'slot-desert-mirage': 'sand',
  'slot-frost-peak': 'frost',
  'slot-jade-temple': 'jade',
  'slot-carnival-row': 'carnival',
  'slot-jungle-run': 'jade',
  'slot-city-lights': 'city',
  'slot-spice-market': 'spice',
  'slot-aurora-borealis': 'aurora',
  'slot-vault-breaker': 'vault',
  'slot-supernova': 'nova',
  'slot-pharaohs-vault': 'pharaoh',
  'slot-storm-chaser': 'storm',
};

function decor(flavor: Flavor, color: string, accent: string) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.5, strokeOpacity: 0.76 };
  switch (flavor) {
    case 'ripple':
      return <><Path d="M0 43 C28 20 54 62 82 39 S136 18 164 39 S218 60 246 36 S280 24 300 35" {...common} /><Path d="M0 51 C34 33 58 66 91 47 S149 27 182 48 S240 66 300 43" {...common} strokeOpacity={0.42} /></>;
    case 'storm':
      return <Path d="M28 49 L73 13 L66 34 L111 20 L83 51 L89 31 L42 47 L56 27 Z M201 47 L244 12 L238 32 L278 20 L253 49 L257 32 L219 48 L232 27 Z" {...common} strokeWidth={2.4} />;
    case 'aurora':
      return <><Path d="M0 48 C36 5 70 57 109 18 S173 50 211 12 S264 42 300 7" {...common} strokeWidth={3.2} /><Path d="M0 58 C38 22 70 68 112 32 S177 65 220 25 S270 50 300 28" {...common} strokeOpacity={0.4} strokeWidth={4} /></>;
    case 'vault':
      return <><Circle cx="44" cy="30" r="21" {...common} /><Circle cx="44" cy="30" r="11" {...common} strokeOpacity={0.48} /><Line x1="23" y1="30" x2="65" y2="30" {...common} /><Circle cx="256" cy="30" r="21" {...common} /><Circle cx="256" cy="30" r="11" {...common} strokeOpacity={0.48} /><Line x1="235" y1="30" x2="277" y2="30" {...common} /></>;
    case 'nova':
      return <><Path d="M48 30 H115 M185 30 H252 M78 12 L105 25 M222 12 L195 25 M78 48 L105 35 M222 48 L195 35" {...common} strokeWidth={2} /><Circle cx="150" cy="30" r="15" {...common} /></>;
    case 'frost':
      return <><Path d="M22 42 L46 18 L64 42 L86 13 L108 42 M192 42 L214 16 L233 42 L254 12 L279 42" {...common} strokeWidth={2.4} /><Path d="M16 47 H116 M184 47 H284" {...common} strokeOpacity={0.42} /></>;
    case 'sand':
    case 'pharaoh':
      return <><Path d="M13 48 L48 19 L83 48 Z M217 48 L252 19 L287 48 Z" {...common} /><Path d="M2 53 C45 41 77 57 120 47 S207 41 298 52" {...common} strokeOpacity={0.48} /></>;
    case 'cards':
      return <><Path d="M21 49 L44 17 L67 49 Z M233 49 L256 17 L279 49 Z" {...common} /><Path d="M44 17 L44 47 M256 17 L256 47" {...common} strokeOpacity={0.42} /></>;
    case 'jade':
      return <><Path d="M8 48 C30 10 52 10 76 48 C100 10 122 10 146 48" {...common} strokeWidth={2.5} /><Path d="M154 48 C178 10 200 10 224 48 C248 10 270 10 292 48" {...common} strokeWidth={2.5} /></>;
    case 'city':
      return <Path d="M12 49 V27 H28 V15 H45 V38 H62 V23 H79 V49 M221 49 V20 H240 V34 H258 V11 H276 V29 H291 V49" {...common} strokeWidth={2.2} />;
    case 'neon':
      return <><Path d="M5 47 H295 M28 13 V47 M74 13 V47 M226 13 V47 M272 13 V47" {...common} strokeWidth={2} /><Path d="M99 47 L118 15 H182 L201 47" {...common} /></>;
    case 'spice':
      return <><Path d="M19 49 C45 10 71 46 93 17 C112 45 132 14 151 46" {...common} strokeWidth={2.4} /><Path d="M151 46 C174 12 196 46 218 18 C241 47 265 11 288 49" {...common} strokeWidth={2.4} /></>;
    case 'sunset':
      return <><Circle cx="150" cy="34" r="22" {...common} /><Line x1="100" y1="52" x2="200" y2="52" {...common} strokeWidth={2.5} /></>;
    case 'carnival':
    case 'bulbs':
    case 'stars':
    default:
      return <><Path d="M8 49 H292" {...common} /><Circle cx="38" cy="18" r="4" fill={accent} /><Circle cx="78" cy="32" r="3" fill={color} /><Circle cx="222" cy="32" r="3" fill={color} /><Circle cx="262" cy="18" r="4" fill={accent} /></>;
  }
}

export function ThemedMarquee({ gameId, name, height, theme }: { gameId: string; name: string; height: number; theme: Theme }) {
  const reduced = usePrefersReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const flavor = FLAVORS[gameId] ?? 'stars';

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.45);
      return undefined;
    }
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: flavor === 'storm' ? 300 : 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: flavor === 'storm' ? 780 : 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const pass = Animated.loop(Animated.sequence([
      Animated.delay(flavor === 'storm' ? 800 : 1_300),
      Animated.timing(sweep, { toValue: 1, duration: flavor === 'ripple' ? 2_000 : 1_250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(1_100),
      Animated.timing(sweep, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]));
    glow.start();
    pass.start();
    return () => { glow.stop(); pass.stop(); };
  }, [flavor, pulse, reduced, sweep]);

  const title = name.toUpperCase();
  const titleLength = Math.min(260, Math.max(110, title.length * 16));
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0.92] });
  const travel = Math.max(320, width);
  const x = sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, travel + 90] });
  const id = useMemo(() => `marquee-${gameId.replace(/[^a-z0-9]/gi, '')}`, [gameId]);

  return (
    <View style={[styles.wrap, { height }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} pointerEvents="none" accessibilityLabel={name}>
      <LinearGradient colors={[theme.primary, theme.secondary, theme.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.decor, { opacity }]}>
        <Svg width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="none">
          {decor(flavor, theme.accent, theme.secondary)}
        </Svg>
      </Animated.View>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF8DF" />
            <Stop offset="0.38" stopColor={theme.accent} />
            <Stop offset="1" stopColor={theme.secondary} />
          </SvgLinearGradient>
        </Defs>
        <Rect x="2" y="2" width="296" height="56" rx="6" fill="none" stroke={theme.accent} strokeWidth="1.5" strokeOpacity="0.9" />
        <Rect x="6" y="6" width="288" height="48" rx="4" fill="none" stroke="rgba(0,0,0,0.52)" strokeWidth="2" />
        <SvgText x="150" y="42" fontSize="29" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif" textAnchor="middle" letterSpacing="1.4" textLength={titleLength} lengthAdjust="spacingAndGlyphs" fill="rgba(0,0,0,0.8)" stroke="rgba(0,0,0,0.82)" strokeWidth="5.5">{title}</SvgText>
        <SvgText x="150" y="38" fontSize="29" fontWeight="900" fontFamily="Impact, Arial Black, sans-serif" textAnchor="middle" letterSpacing="1.4" textLength={titleLength} lengthAdjust="spacingAndGlyphs" fill={`url(#${id})`} stroke={theme.accent} strokeWidth="1.05">{title}</SvgText>
      </Svg>
      <Animated.View style={[styles.shine, { transform: [{ translateX: x }, { rotate: '18deg' }] }]}>
        <LinearGradient colors={['transparent', 'rgba(255,255,255,0.5)', 'transparent']} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden', justifyContent: 'center', borderBottomWidth: 2, borderColor: 'rgba(255,255,255,0.22)' },
  decor: { ...StyleSheet.absoluteFillObject },
  shine: { position: 'absolute', top: -50, bottom: -50, left: 0, width: 56 },
});
