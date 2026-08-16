/**
 * The steel, lights and moving hardware around a reel window.
 *
 * A game-specific title alone is a label pasted onto the same machine.  This
 * layer gives each cabinet a different *body* without touching its math,
 * symbols, reel count, lever, or bonus rule.  It intentionally lives outside
 * the reel glass, where the physical parts of a real cabinet live.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { usePrefersReducedMotion, type WinTier } from '../motion';

export type CabinetFlavor =
  | 'bulbs' | 'cards' | 'ocean' | 'sunset' | 'midnight' | 'neon'
  | 'sand' | 'frost' | 'jade' | 'carnival' | 'city' | 'spice'
  | 'aurora' | 'vault' | 'nova' | 'pharaoh' | 'storm';

export type CabinetTheme = { primary: string; secondary: string; accent: string };

const FLAVORS: Record<string, CabinetFlavor> = {
  'juwa-classic-slots': 'bulbs', 'slot-triple-bar': 'bulbs', 'slot-fruit-stand': 'bulbs', 'slot-lucky-sevens': 'bulbs',
  'slot-emerald-nights': 'jade', 'slot-jungle-run': 'jade', 'slot-royal-flush': 'cards',
  'slot-ocean-drift': 'ocean', 'slot-sunset-strip': 'sunset', 'slot-midnight-gold': 'midnight',
  'slot-neon-alley': 'neon', 'slot-desert-mirage': 'sand', 'slot-frost-peak': 'frost',
  'slot-jade-temple': 'jade', 'slot-carnival-row': 'carnival', 'slot-city-lights': 'city',
  'slot-spice-market': 'spice', 'slot-aurora-borealis': 'aurora', 'slot-vault-breaker': 'vault',
  'slot-supernova': 'nova', 'slot-pharaohs-vault': 'pharaoh', 'slot-storm-chaser': 'storm',
};

export function cabinetFlavorFor(gameId: string): CabinetFlavor {
  return FLAVORS[gameId] ?? 'bulbs';
}

function motif(flavor: CabinetFlavor, color: string, accent: string) {
  const line = { fill: 'none', stroke: color, strokeWidth: 2, strokeOpacity: 0.8 };
  switch (flavor) {
    case 'ocean': return <><Path d="M4 34 C23 8 42 58 61 32 S99 9 118 33" {...line} /><Circle cx="26" cy="13" r="5" fill={accent} opacity=".52" /><Circle cx="95" cy="47" r="3" fill={color} /></>;
    case 'jade': return <><Path d="M15 55 V10 L34 3 L53 10 V55 M66 55 V10 L85 3 L104 10 V55" {...line} /><Circle cx="34" cy="27" r="7" fill={accent} opacity=".6" /><Circle cx="85" cy="27" r="7" fill={accent} opacity=".6" /></>;
    case 'city': return <><Path d="M8 57 V29 H21 V12 H35 V43 H48 V23 H63 V57 M74 57 V17 H88 V36 H102 V6 H116 V57" {...line} /><Line x1="8" y1="53" x2="116" y2="53" stroke={accent} strokeWidth="2" /></>;
    case 'aurora': return <><Path d="M0 44 C23 3 43 57 62 19 S96 51 119 6" {...line} strokeWidth="4" /><Path d="M0 58 C18 25 42 72 64 38 S102 61 120 26" {...line} stroke={accent} strokeWidth="2" /></>;
    case 'nova': return <><Circle cx="60" cy="30" r="19" {...line} /><Circle cx="60" cy="30" r="4" fill={accent} /><Path d="M15 30 H105 M60 0 V60 M27 8 L94 52 M94 8 L27 52" {...line} strokeOpacity=".42" /></>;
    case 'storm': return <><Path d="M15 4 L52 4 L38 25 L74 25 L31 57 L43 34 L12 34 Z" fill={accent} opacity=".84" /><Path d="M84 6 L113 6 L100 26 L118 26 L87 55" {...line} /></>;
    case 'vault': return <><Circle cx="60" cy="30" r="25" {...line} /><Circle cx="60" cy="30" r="13" {...line} /><Line x1="35" y1="30" x2="85" y2="30" {...line} /><Line x1="60" y1="5" x2="60" y2="55" {...line} /></>;
    case 'pharaoh': return <><Path d="M10 55 L28 8 L46 55 Z M73 55 L91 8 L110 55 Z" {...line} /><Circle cx="28" cy="32" r="6" fill={accent} /><Circle cx="91" cy="32" r="6" fill={accent} /></>;
    case 'frost': return <><Path d="M12 48 L34 8 L56 48 M65 48 L87 8 L109 48 M4 51 H116" {...line} /><Path d="M18 36 H50 M71 36 H103" {...line} strokeOpacity=".45" /></>;
    case 'spice': return <><Path d="M12 54 C20 12 36 12 44 54 C52 12 68 12 76 54 C84 12 100 12 108 54" {...line} /><Circle cx="28" cy="28" r="5" fill={accent} /></>;
    case 'cards': return <><Path d="M14 54 L32 7 L50 54 Z M70 54 L88 7 L106 54 Z" {...line} /><Path d="M32 17 L32 45 M88 17 L88 45" {...line} strokeOpacity=".42" /></>;
    case 'neon': return <><Rect x="13" y="7" width="94" height="46" rx="5" {...line} /><Path d="M25 42 L46 17 H74 L95 42" {...line} stroke={accent} /></>;
    case 'carnival': return <><Path d="M8 50 C26 2 43 2 61 50 C79 2 96 2 114 50" {...line} /><Circle cx="28" cy="24" r="5" fill={accent} /><Circle cx="60" cy="13" r="5" fill={accent} /><Circle cx="92" cy="24" r="5" fill={accent} /></>;
    case 'sunset': return <><Circle cx="60" cy="37" r="20" {...line} /><Line x1="9" y1="55" x2="111" y2="55" stroke={accent} strokeWidth="3" /></>;
    case 'midnight': return <><Circle cx="24" cy="16" r="3" fill={accent} /><Circle cx="56" cy="30" r="2" fill={color} /><Circle cx="96" cy="11" r="4" fill={accent} /><Path d="M8 56 C37 34 80 71 115 43" {...line} /></>;
    case 'sand': return <><Path d="M8 55 L35 9 L62 55 M65 55 L92 9 L118 55" {...line} /><Path d="M4 52 C30 42 90 63 118 50" {...line} strokeOpacity=".46" /></>;
    case 'bulbs':
    default: return <><Path d="M8 56 H112" {...line} /><Circle cx="20" cy="17" r="5" fill={accent} /><Circle cx="50" cy="35" r="4" fill={color} /><Circle cx="80" cy="17" r="5" fill={accent} /><Circle cx="104" cy="37" r="4" fill={color} /></>;
  }
}

/** Physical side panels and a distinct moving mechanism for every cabinet. */
export function CabinetPersonality({ gameId, theme, spinning, tier, placement = 'shell' }: { gameId: string; theme: CabinetTheme; spinning: boolean; tier: WinTier; placement?: 'shell' | 'glass' }) {
  const reduced = usePrefersReducedMotion();
  const flavor = cabinetFlavorFor(gameId);
  const pulse = useRef(new Animated.Value(0)).current;
  const travel = useRef(new Animated.Value(0)).current;
  const loud = tier === 'burst' || tier === 'big' || tier === 'mega' || tier === 'jackpot';

  useEffect(() => {
    if (reduced) { pulse.setValue(loud ? 0.85 : 0.34); return undefined; }
    const pace = flavor === 'storm' ? 260 : flavor === 'ocean' || flavor === 'aurora' ? 1_450 : 800;
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: loud ? 1 : 0.72, duration: pace, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.12, duration: pace, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(travel, { toValue: 1, duration: spinning ? 680 : flavor === 'ocean' || flavor === 'aurora' ? 2_600 : 1_800, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(travel, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]));
    glow.start(); motion.start();
    return () => { glow.stop(); motion.stop(); };
  }, [flavor, loud, pulse, reduced, spinning, travel]);

  const shimmer = travel.interpolate({ inputRange: [0, 1], outputRange: [-120, 560] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, loud ? 1 : 0.72] });
  const metal = useMemo(() => [theme.primary, '#090B18', theme.secondary] as const, [theme]);

  return (
    <View style={styles.shell} pointerEvents="none" accessibilityElementsHidden>
      {placement === 'shell' ? <LinearGradient colors={metal} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backplate} /> : null}
      <View style={[styles.leftPlate, placement === 'glass' && styles.glassPlate]}><Svg width="100%" height="100%" viewBox="0 0 120 60" preserveAspectRatio="none">{motif(flavor, theme.primary, theme.accent)}</Svg></View>
      <View style={[styles.rightPlate, placement === 'glass' && styles.glassPlate]}><Svg width="100%" height="100%" viewBox="0 0 120 60" preserveAspectRatio="none">{motif(flavor, theme.primary, theme.accent)}</Svg></View>
      {placement === 'shell' ? <View style={[styles.topRim, { borderColor: theme.accent }]} /> : null}
      {placement === 'shell' ? <View style={[styles.bottomRim, { borderColor: theme.secondary }]} /> : null}
      <Animated.View style={[styles.movingLight, placement === 'glass' && styles.glassLight, { opacity, backgroundColor: theme.accent, transform: [{ translateX: shimmer }, { rotate: '18deg' }] }]} />
    </View>
  );
}

/** One local, themed win reaction. It replaces a generic coin blast on most machines. */
export function CabinetReward({ gameId, theme, tier, round }: { gameId: string; theme: CabinetTheme; tier: WinTier; round: number }) {
  const reduced = usePrefersReducedMotion();
  const flare = useRef(new Animated.Value(0)).current;
  const flavor = cabinetFlavorFor(gameId);
  const active = tier === 'win' || tier === 'burst';
  useEffect(() => {
    if (!active) { flare.setValue(0); return undefined; }
    if (reduced) { flare.setValue(0.65); return undefined; }
    const animation = Animated.sequence([
      Animated.timing(flare, { toValue: 1, duration: flavor === 'storm' ? 160 : 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(tier === 'burst' ? 800 : 440),
      Animated.timing(flare, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [active, flare, flavor, reduced, round, tier]);
  if (!active) return null;
  const scale = flare.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const rotate = flare.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '18deg'] });
  return (
    <Animated.View pointerEvents="none" style={[styles.reward, { opacity: flare, transform: [{ scale }] }]}>
      <Svg width="100%" height="100%" viewBox="0 0 300 180" preserveAspectRatio="none">
        {flavor === 'storm' ? <Path d="M148 8 L203 8 L177 70 L231 70 L130 174 L151 104 L90 104 Z" fill={theme.accent} opacity=".84" /> : null}
        {flavor === 'ocean' ? <Path d="M0 116 C45 55 88 167 135 104 S220 48 300 111" fill="none" stroke={theme.accent} strokeWidth="7" strokeOpacity=".85" /> : null}
        {flavor === 'aurora' ? <Path d="M0 130 C54 27 95 175 150 86 S236 148 300 43" fill="none" stroke={theme.accent} strokeWidth="9" strokeOpacity=".78" /> : null}
        {flavor === 'nova' ? <><Circle cx="150" cy="90" r="55" fill="none" stroke={theme.accent} strokeWidth="5" /><Circle cx="150" cy="90" r="15" fill={theme.accent} /></> : null}
        {flavor === 'vault' ? <><Circle cx="150" cy="90" r="58" fill="none" stroke={theme.accent} strokeWidth="7" /><Line x1="92" y1="90" x2="208" y2="90" stroke={theme.accent} strokeWidth="4" /></> : null}
        {!['storm', 'ocean', 'aurora', 'nova', 'vault'].includes(flavor) ? <Path d="M18 147 L82 74 L128 118 L183 39 L276 141" fill="none" stroke={theme.accent} strokeWidth="7" strokeOpacity=".78" /> : null}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  backplate: { ...StyleSheet.absoluteFillObject, opacity: 0.62 },
  leftPlate: { position: 'absolute', left: 0, top: '13%', bottom: '10%', width: '12%', opacity: 0.72 },
  rightPlate: { position: 'absolute', right: 0, top: '13%', bottom: '10%', width: '12%', opacity: 0.72, transform: [{ scaleX: -1 }] },
  glassPlate: { width: '8%', top: 0, bottom: 0, opacity: 0.42 },
  topRim: { position: 'absolute', top: 3, left: '10%', right: '10%', borderTopWidth: 2, opacity: 0.72 },
  bottomRim: { position: 'absolute', bottom: 3, left: '10%', right: '10%', borderTopWidth: 3, opacity: 0.82 },
  movingLight: { position: 'absolute', top: '-28%', width: 30, height: '165%', borderRadius: 20, opacity: 0.5 },
  glassLight: { width: 16, opacity: 0.2 },
  reward: { ...StyleSheet.absoluteFillObject, zIndex: 3 },
});
