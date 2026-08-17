/**
 * Full-reel environmental motion for slot cabinets.
 *
 * This is deliberately scenery, not a translucent symbol in a corner. Each
 * effect occupies the reel glass and expresses the game's setting: water
 * crosses Ocean Drift, ice grows over Frost Peak, lightning ruptures Storm
 * Chaser, and a vine-swinging figure crosses Jungle Run. Symbols remain above
 * this layer, so none of it changes the result or obscures a winning line.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { usePrefersReducedMotion } from '../motion';

type Environment =
  | 'ocean' | 'sunset' | 'frost' | 'storm' | 'jungle' | 'aurora'
  | 'nova' | 'neon' | 'city' | 'desert' | 'vault' | 'jade'
  | 'carnival' | 'classic' | 'triple' | 'orchard' | 'lucky' | 'royal'
  | 'pharaoh' | 'emerald' | 'midnight' | 'spice';

const ENVIRONMENT: Record<string, Environment> = {
  'juwa-classic-slots': 'classic',
  'slot-triple-bar': 'triple',
  'slot-fruit-stand': 'orchard',
  'slot-lucky-sevens': 'lucky',
  'slot-desert-mirage': 'desert',
  'slot-pharaohs-vault': 'pharaoh',
  'slot-jade-temple': 'jade',
  'slot-royal-flush': 'royal',
  'slot-midnight-gold': 'midnight',
  'slot-spice-market': 'spice',
  'slot-emerald-nights': 'emerald',
  'slot-frost-peak': 'frost',
  'slot-storm-chaser': 'storm',
  'slot-supernova': 'nova',
  'slot-aurora-borealis': 'aurora',
  'slot-vault-breaker': 'vault',
  'slot-city-lights': 'city',
  'slot-neon-alley': 'neon',
  'slot-ocean-drift': 'ocean',
  'slot-sunset-strip': 'sunset',
  'slot-carnival-row': 'carnival',
  'slot-jungle-run': 'jungle',
};

export function SlotEnvironment({ gameId, accent }: { gameId: string; accent: string }) {
  const reduced = usePrefersReducedMotion();
  const phase = useRef(new Animated.Value(0)).current;
  const environment = ENVIRONMENT[gameId] ?? 'royal';

  useEffect(() => {
    if (reduced) {
      phase.setValue(0.45);
      return undefined;
    }
    const duration = environment === 'storm' ? 2_100 : environment === 'sunset' ? 1_550 : 3_200;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(phase, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(phase, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [environment, phase, reduced]);

  const driftX = phase.interpolate({ inputRange: [0, 1], outputRange: [-34, 20] });
  const reverseX = phase.interpolate({ inputRange: [0, 1], outputRange: [26, -28] });
  const riseY = phase.interpolate({ inputRange: [0, 1], outputRange: [34, -68] });
  const glow = phase.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.18, 0.72, 0.2] });
  const flash = phase.interpolate({ inputRange: [0, 0.48, 0.5, 0.53, 1], outputRange: [0, 0, 0.95, 0.08, 0] });
  const scale = phase.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.18] });

  const scene = useMemo(() => {
    switch (environment) {
      case 'ocean':
        return <>
          <Animated.View style={[styles.waveBack, { transform: [{ translateX: reverseX }] }]}><Wave color="#43E5FF" opacity={0.23} /></Animated.View>
          <Animated.View style={[styles.waveFront, { transform: [{ translateX: driftX }] }]}><Wave color="#B6FAFF" opacity={0.38} /></Animated.View>
          {[22, 49, 76].map((left, index) => <Animated.View key={left} style={[styles.bubble, { left: `${left}%`, opacity: glow, transform: [{ translateY: riseY }, { scale: index === 1 ? 1.35 : 0.85 }] }]} />)}
        </>;
      case 'sunset':
        return <>
          <View style={styles.skyline}><Svg width="100%" height="100%" viewBox="0 0 320 120" preserveAspectRatio="none"><Path d="M0 112V83h26V61h28v51h22V44h36v68h22V73h29v39h25V35h42v77h19V66h31v46h40" fill="rgba(5,2,18,.74)" stroke="#FF8C38" strokeWidth="1.4" /></Svg></View>
          <Animated.View style={[styles.neonSweep, { opacity: glow, transform: [{ translateX: driftX }, { rotate: '-8deg' }] }]}><LinearGradient colors={['transparent', '#FFEF84', '#FF4BC8', 'transparent']} style={StyleSheet.absoluteFill} /></Animated.View>
        </>;
      case 'frost':
        return <>
          <Animated.View style={[styles.frostBloom, { opacity: glow, transform: [{ scale }] }]}><LinearGradient colors={['rgba(230,252,255,.72)', 'rgba(97,208,255,.22)', 'transparent']} style={StyleSheet.absoluteFill} /></Animated.View>
          <View style={styles.fullSvg}><Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="none"><Path d="M0 12l38 26 21-29 28 42 34-49 26 43 37-31 35 42 29-49 29 38 43-30M0 170l42-34 18 27 31-46 30 44 32-30 31 43 35-52 31 39 40-35 30 38" fill="none" stroke="#DDF9FF" strokeOpacity=".42" strokeWidth="2" /></Svg></View>
        </>;
      case 'storm':
        return <>
          <Animated.View style={[styles.cloudBank, { transform: [{ translateX: reverseX }] }]}>{[0, 1, 2, 3].map((n) => <View key={n} style={[styles.cloud, { left: n * 72, top: (n % 2) * 12 }]} />)}</Animated.View>
          <Animated.View style={[styles.lightning, { opacity: flash }]}><Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="none"><Path d="M185 0l-39 73h35l-52 107 91-126h-42l38-54" fill="#F5FEFF" stroke="#69EDFF" strokeWidth="3" /></Svg></Animated.View>
        </>;
      case 'jungle':
        return <>
          <View style={styles.fullSvg}><Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="none"><Path d="M18 0c9 55-15 79 7 125M78 0c-7 48 18 72-3 128M264 0c8 41-19 78 1 139M306 0c-16 50 13 78-9 124" fill="none" stroke="#76D62E" strokeOpacity=".36" strokeWidth="5" /></Svg></View>
          <Animated.View style={[styles.monkeySwing, { transform: [{ translateX: driftX }, { translateY: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [10, -9, 10] }) }, { rotate: '-11deg' }] }]}><Monkey /></Animated.View>
        </>;
      case 'aurora':
        return <Animated.View style={[styles.auroraBand, { opacity: glow, transform: [{ translateX: driftX }, { rotate: '-8deg' }] }]}><LinearGradient colors={['transparent', '#49FFD4', '#A879FF', '#58E8FF', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /></Animated.View>;
      case 'nova':
        return <>
          <Animated.View style={[styles.nova, { opacity: glow, transform: [{ scale }] }]}><LinearGradient colors={['#FFFFFF', '#FF7CEE', '#7028FF', 'transparent']} style={StyleSheet.absoluteFill} /></Animated.View>
          <View style={styles.starField}>{[9, 22, 38, 57, 73, 88].map((left, index) => <View key={left} style={[styles.star, { left: `${left}%`, top: `${16 + (index * 23) % 68}%`, backgroundColor: index % 2 ? '#FF8FEA' : '#B9F6FF' }]} />)}</View>
        </>;
      case 'neon':
        return <Animated.View style={[styles.gridSweep, { opacity: glow, transform: [{ translateY: riseY }] }]}><Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="none">{[20,50,80,110,140,170].map(y => <Path key={y} d={`M0 ${y}H320`} stroke="#FF47C8" strokeOpacity=".28" />)}{[25,75,125,175,225,275].map(x => <Path key={x} d={`M${x} 0V180`} stroke="#53EBFF" strokeOpacity=".22" />)}</Svg></Animated.View>;
      case 'city':
        return <><Animated.View style={[styles.spotlight, styles.spotlightLeft, { opacity: glow, transform: [{ rotate: '-18deg' }] }]} /><Animated.View style={[styles.spotlight, styles.spotlightRight, { opacity: glow, transform: [{ rotate: '18deg' }] }]} /></>;
      case 'desert':
        return <><Animated.View style={[styles.sandVeil, { transform: [{ translateX: driftX }] }]} /><View style={styles.fullSvg}><Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="none"><Path d="M0 148c52-44 90 20 143-20s101 24 177-22v74H0z" fill="rgba(255,193,76,.18)" /></Svg></View></>;
      case 'vault':
        return <><Animated.View style={[styles.scanLine, { opacity: glow, transform: [{ translateY: riseY }] }]} /><View style={styles.vaultReticle} /></>;
      case 'jade':
        return <Animated.View style={[styles.jadeFacet, { opacity: glow, transform: [{ rotate: '45deg' }, { scale }] }]} />;
      case 'carnival':
        return <View style={styles.bulbRail}>{Array.from({ length: 12 }, (_, n) => <Animated.View key={n} style={[styles.carnivalBulb, { backgroundColor: n % 2 ? '#FFDA5B' : '#FF4DA6', opacity: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [n % 2 ? .25 : .9, n % 2 ? .9 : .25, n % 2 ? .25 : .9] }) }]} />)}</View>;
      case 'orchard':
        return <><Animated.View style={[styles.orchardGlow, { opacity: glow, transform: [{ scale }] }]} /><Animated.View style={[styles.leafSweep, { transform: [{ translateX: reverseX }, { rotate: '24deg' }] }]} /></>;
      case 'spice':
        return <>{[12, 31, 54, 78, 91].map((left, index) => <Animated.View key={left} style={[styles.ember, { left: `${left}%`, backgroundColor: index % 2 ? '#FFB33B' : '#FF5A30', opacity: glow, transform: [{ translateY: riseY }] }]} />)}</>;
      case 'triple':
        return <View style={styles.mechanicalBands}>{[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.mechanicalBand, { top: 24 + index * 48, opacity: glow, transform: [{ translateX: index % 2 ? reverseX : driftX }] }]}><LinearGradient colors={['transparent', 'rgba(255,226,132,.5)', 'rgba(255,255,255,.18)', 'transparent']} start={{ x: 0, y: .5 }} end={{ x: 1, y: .5 }} style={StyleSheet.absoluteFill} /></Animated.View>)}</View>;
      case 'lucky':
        return <><Animated.View style={[styles.jackpotHalo, { opacity: glow, transform: [{ scale }, { rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) }] }]} />{[18, 36, 66, 84].map((left, index) => <Animated.View key={left} style={[styles.luckySpark, { left: `${left}%`, top: `${22 + index * 17}%`, opacity: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [index % 2 ? .18 : .9, index % 2 ? .9 : .18, index % 2 ? .18 : .9] }) }]} />)}</>;
      case 'pharaoh':
        return <><Animated.View style={[styles.sunDisc, { opacity: glow, transform: [{ scale }] }]} /><View style={styles.hieroglyphRail}>{[0, 1, 2, 3, 4, 5].map((index) => <View key={index} style={[styles.hieroglyphMark, { transform: [{ rotate: `${index * 23}deg` }] }]} />)}</View></>;
      case 'emerald':
        return <><Animated.View style={[styles.emeraldLens, { opacity: glow, transform: [{ scale }, { rotate: '45deg' }] }]} /><Animated.View style={[styles.emeraldScan, { transform: [{ translateX: driftX }, { rotate: '-12deg' }] }]} /></>;
      case 'midnight':
        return <><View style={styles.midnightCity}>{Array.from({ length: 14 }, (_, index) => <Animated.View key={index} style={[styles.midnightWindow, { left: `${5 + (index * 7) % 90}%`, bottom: `${8 + (index * 19) % 62}%`, opacity: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [index % 3 ? .18 : .82, index % 3 ? .82 : .18, index % 3 ? .18 : .82] }) }]} />)}</View><Animated.View style={[styles.goldMoon, { opacity: glow, transform: [{ scale }] }]} /></>;
      case 'classic':
        return <Animated.View style={[styles.chromePass, { opacity: glow, transform: [{ translateX: driftX }, { rotate: '15deg' }] }]} />;
      case 'royal':
      default:
        return <><Animated.View style={[styles.royalRay, styles.royalRayLeft, { opacity: glow, transform: [{ rotate: '-24deg' }] }]} /><Animated.View style={[styles.royalRay, styles.royalRayRight, { opacity: glow, transform: [{ rotate: '24deg' }] }]} /></>;
    }
  }, [accent, driftX, environment, flash, glow, phase, reverseX, riseY, scale]);

  return <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden>{scene}</View>;
}

function Wave({ color, opacity }: { color: string; opacity: number }) {
  return <Svg width="140%" height="100%" viewBox="0 0 440 60" preserveAspectRatio="none"><Path d="M0 30C42 1 72 58 115 29S189 2 232 30s75 27 118-1 59-17 90 0v31H0z" fill={color} fillOpacity={opacity} /><Path d="M0 28c42-29 72 28 115-1s74-27 117 1 75 27 118 0 59-17 90 0" fill="none" stroke="#E9FFFF" strokeOpacity={opacity + .12} strokeWidth="2" /></Svg>;
}

function Monkey() {
  return <Svg width="70" height="76" viewBox="0 0 70 76"><Path d="M34 0c0 15-8 21-17 28" fill="none" stroke="#9ED451" strokeWidth="3" /><Circle cx="34" cy="28" r="10" fill="#311B12" /><Circle cx="34" cy="47" r="14" fill="#24120C" /><Path d="M22 43C9 37 4 49 15 55M46 42c14-9 21 1 12 12M25 57l-9 15m29-15 10 14" fill="none" stroke="#2B160E" strokeWidth="7" strokeLinecap="round" /><Path d="M47 51c21 2 18 21 5 22" fill="none" stroke="#2B160E" strokeWidth="5" strokeLinecap="round" /></Svg>;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', zIndex: 0 },
  fullSvg: { ...StyleSheet.absoluteFillObject },
  waveBack: { position: 'absolute', left: -25, right: -25, bottom: 24, height: 62 },
  waveFront: { position: 'absolute', left: -25, right: -25, bottom: -2, height: 70 },
  bubble: { position: 'absolute', bottom: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: '#C9FAFF', backgroundColor: 'rgba(82,226,255,.18)' },
  skyline: { ...StyleSheet.absoluteFillObject, top: 30 },
  neonSweep: { position: 'absolute', left: -90, top: -40, width: 120, bottom: -40 },
  frostBloom: { position: 'absolute', left: -60, top: -90, width: 220, height: 220, borderRadius: 110 },
  cloudBank: { position: 'absolute', left: -40, right: -40, top: -32, height: 90 },
  cloud: { position: 'absolute', width: 120, height: 54, borderRadius: 50, backgroundColor: 'rgba(30,42,58,.76)', shadowColor: '#000', shadowOpacity: .9, shadowRadius: 18 },
  lightning: { ...StyleSheet.absoluteFillObject },
  monkeySwing: { position: 'absolute', left: '42%', top: 2 },
  auroraBand: { position: 'absolute', left: -80, right: -80, top: 10, height: 86, borderRadius: 50 },
  nova: { position: 'absolute', left: '38%', top: '24%', width: 86, height: 86, borderRadius: 43, shadowColor: '#FF78EA', shadowOpacity: 1, shadowRadius: 30 },
  starField: { ...StyleSheet.absoluteFillObject },
  star: { position: 'absolute', width: 4, height: 4, borderRadius: 2, shadowColor: '#FFF', shadowOpacity: 1, shadowRadius: 6 },
  gridSweep: { ...StyleSheet.absoluteFillObject, top: 15 },
  spotlight: { position: 'absolute', top: -45, width: 70, height: '150%', backgroundColor: 'rgba(220,241,255,.13)' },
  spotlightLeft: { left: 54 },
  spotlightRight: { right: 54 },
  sandVeil: { position: 'absolute', left: -70, top: 0, width: 130, bottom: 0, backgroundColor: 'rgba(255,199,89,.11)', transform: [{ rotate: '18deg' }] },
  scanLine: { position: 'absolute', left: 12, right: 12, top: 110, height: 3, backgroundColor: '#54F5FF', shadowColor: '#54F5FF', shadowOpacity: 1, shadowRadius: 12 },
  vaultReticle: { position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderColor: 'rgba(73,245,255,.2)', alignSelf: 'center', top: 22 },
  jadeFacet: { position: 'absolute', width: 132, height: 132, alignSelf: 'center', top: 8, borderWidth: 2, borderColor: 'rgba(102,255,198,.28)', backgroundColor: 'rgba(37,184,126,.08)' },
  bulbRail: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  carnivalBulb: { width: 7, height: 7, borderRadius: 4, shadowColor: '#FFF', shadowOpacity: 1, shadowRadius: 6 },
  orchardGlow: { position: 'absolute', left: '35%', top: '25%', width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(121,255,82,.13)', shadowColor: '#FFEB68', shadowOpacity: .65, shadowRadius: 25 },
  leafSweep: { position: 'absolute', left: -30, bottom: 8, width: 90, height: 26, borderRadius: 100, backgroundColor: 'rgba(72,210,67,.24)' },
  ember: { position: 'absolute', bottom: 4, width: 5, height: 10, borderRadius: 4, shadowColor: '#FF8B33', shadowOpacity: 1, shadowRadius: 8 },
  chromePass: { position: 'absolute', left: -80, top: -30, width: 78, bottom: -30, backgroundColor: 'rgba(255,247,201,.16)' },
  royalRay: { position: 'absolute', top: -40, width: 40, height: '150%', backgroundColor: 'rgba(255,224,126,.1)' },
  royalRayLeft: { left: 70 },
  royalRayRight: { right: 70 },
  mechanicalBands: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  mechanicalBand: { position: 'absolute', left: -70, width: 170, height: 20, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,219,112,.28)' },
  jackpotHalo: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 3, borderColor: 'rgba(255,70,60,.28)', alignSelf: 'center', top: 2, shadowColor: '#FFD84E', shadowOpacity: .8, shadowRadius: 22 },
  luckySpark: { position: 'absolute', width: 8, height: 8, transform: [{ rotate: '45deg' }], backgroundColor: '#FFF2A4', shadowColor: '#FF4638', shadowOpacity: 1, shadowRadius: 8 },
  sunDisc: { position: 'absolute', width: 150, height: 150, borderRadius: 75, alignSelf: 'center', top: 15, backgroundColor: 'rgba(255,191,47,.11)', borderWidth: 2, borderColor: 'rgba(255,229,133,.24)', shadowColor: '#FF9D28', shadowOpacity: .8, shadowRadius: 25 },
  hieroglyphRail: { position: 'absolute', left: 12, right: 12, bottom: 9, flexDirection: 'row', justifyContent: 'space-around' },
  hieroglyphMark: { width: 11, height: 18, borderWidth: 2, borderColor: 'rgba(255,210,94,.28)', borderRadius: 5 },
  emeraldLens: { position: 'absolute', width: 112, height: 112, alignSelf: 'center', top: 30, borderWidth: 3, borderColor: 'rgba(91,255,183,.3)', backgroundColor: 'rgba(18,199,122,.09)', shadowColor: '#49F2AB', shadowOpacity: .75, shadowRadius: 24 },
  emeraldScan: { position: 'absolute', left: -70, top: -20, bottom: -20, width: 55, backgroundColor: 'rgba(130,255,204,.13)' },
  midnightCity: { ...StyleSheet.absoluteFillObject },
  midnightWindow: { position: 'absolute', width: 5, height: 11, borderRadius: 2, backgroundColor: '#FFD76B', shadowColor: '#FFB32C', shadowOpacity: 1, shadowRadius: 7 },
  goldMoon: { position: 'absolute', right: 30, top: 18, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,211,101,.12)', borderWidth: 1, borderColor: 'rgba(255,236,166,.3)' },
});
