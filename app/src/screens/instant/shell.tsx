/**
 * The shared frame for the instant games.
 *
 * Crash, Limbo, Dice, Plinko, Mines and Golden Scratch differ entirely in what they draw and
 * barely at all in what they do: load a balance, pick a stake, send one bet,
 * show what came back, handle the failure. That common half lives here so each
 * screen is only its own play area — the same trick that lets twenty-three
 * slots share one screen.
 *
 * ## The rule these screens must not break
 *
 * The client never decides an outcome. Every number on screen either came back
 * from the server in a settlement, or is a PRICE quoted before the bet from
 * `@juwa/economy` — the same module the server settles with. There is no third
 * category, and in particular there is no "work out what the player probably
 * won" path. A screen that can compute a payout is a screen a patched client
 * can compute a favourable one from.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { format, minor, type Minor } from '@juwa/money';
import { publishBalance } from '../../api/usePlayer';
import { betOptions, suggestedBet } from '@juwa/economy';
import { colors, radius, spacing } from '@juwa/ui';
import { Screen, Txt } from '../../components/primitives';
import { SoundToggles } from '../../components/SoundToggles';
import { HowToPlayButton } from '../../components/HowToPlay';
import { INSTANT_BED, INSTANT_BEDS, useAmbientBed } from '../../ambience';
import { INSTANT_RULES } from './rules';
import { sounds, unlock, useSoundSet } from '../../sound';
import { INSTANT_SOUNDS, INSTANT_SOUND_SETS } from '../../api/sound-sets';
import { Fireworks, type FireworksHandle } from '../../components/Fireworks';
import { usePrefersReducedMotion } from '../../motion';
import { PlayApiError, createPlayApi, type PlayApi, type RoundResponse } from '../../api/client';

export interface InstantGame {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
  accent: string;
  /** The physical character of this game cabinet — not merely its colour. */
  cabinet?: InstantCabinet;
}

export type InstantCabinet = 'crash' | 'limbo' | 'dice' | 'plinko' | 'mines' | 'scratch';

export interface InstantState {
  balance: Minor;
  bet: Minor;
  setBet: (value: Minor) => void;
  options: Minor[];
  busy: boolean;
  error: string | null;
  round: RoundResponse | null;
  /** Open a round. Returns the response so a screen can animate from it. */
  play: (action?: { type: string; [key: string]: unknown }) => Promise<RoundResponse | null>;
  /** Continue an open round — Mines only. */
  act: (action: { type: string; [key: string]: unknown }) => Promise<RoundResponse | null>;
  reset: () => void;
}

export function useInstantGame(game: InstantGame): InstantState {
  // Held in a ref so a re-render never swaps the client mid-round.
  const api = useRef<PlayApi>(createPlayApi()).current;
  const MIN = minor(game.minBet);
  const MAX = minor(game.maxBet);

  const [balance, setBalance] = useState<Minor>(minor(0));
  const [bet, setBet] = useState<Minor>(MIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<RoundResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => {
        if (!alive) return;
        const current = minor(result.balance);
        setBalance(current);
        setBet(suggestedBet(current, MIN, MAX));
      })
      .catch(() => setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api, MIN, MAX]);

  const options = useMemo(() => betOptions(balance, MIN, MAX), [balance, MIN, MAX]);

  const send = useCallback(
    async (run: () => Promise<RoundResponse>) => {
      setError(null);
      setBusy(true);
      try {
        const result = await run();
        setRound(result);
        setBalance(minor(result.balance));
        // Keeps the lobby header honest without a refetch. See publishBalance.
        publishBalance(minor(result.balance));
        return result;
      } catch (caught) {
        setError(
          caught instanceof PlayApiError ? caught.message : 'Something went wrong. Try again.',
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const play = useCallback(
    (action?: { type: string; [key: string]: unknown }) => {
      if (bet > balance) {
        setError('Not enough coins for that bet');
        return Promise.resolve(null);
      }
      return send(() =>
        api.placeBet({
          gameId: game.id,
          stake: bet,
          // Unique per attempt, so a retry after a timeout is recognised as the
          // same bet rather than charged twice.
          idempotencyKey: `${game.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...(action ? { action } : {}),
        }),
      );
    },
    [api, bet, balance, game.id, send],
  );

  const act = useCallback(
    (action: { type: string; [key: string]: unknown }) => {
      const open = round;
      if (!open) return Promise.resolve(null);
      return send(() =>
        api.act({
          roundId: open.roundId,
          action,
          idempotencyKey: `${open.roundId}-${action.type}-${Date.now()}`,
        }),
      );
    },
    [api, round, send],
  );

  return {
    balance,
    bet,
    setBet,
    options,
    busy,
    error,
    round,
    play,
    act,
    reset: () => setRound(null),
  };
}

/**
 * Balance, stake chips and the error line.
 *
 * The play area is passed as children, so each game owns the middle of the
 * screen and nothing else.
 */
export function InstantLayout({
  game,
  state,
  children,
  action,
  dockControl,
  footer,
  /** Keep balance/rules/audio visible while a tall playfield scrolls beneath it. */
  pinHeader = false,
  /** Locked while a multi-step round is open — the stake is already committed. */
  stakeLocked = false,
}: {
  game: InstantGame;
  state: InstantState;
  children: React.ReactNode;
  /**
   * The one button that plays the game.
   *
   * A slot of its own rather than another child, because the ORDER matters and
   * the layout is what knows it: board, then stake, then the button. Passed as
   * a child it landed above the stake chips, which pushed them off the bottom
   * of a 700-point screen — so the control for choosing how much to bet was
   * below the fold on every one of these games.
   */
  action?: React.ReactNode;
  /** Compact game-specific choices pinned with the stake and play button. */
  dockControl?: React.ReactNode;
  footer?: React.ReactNode;
  pinHeader?: boolean;
  stakeLocked?: boolean;
}) {
  /**
   * The room these games are in.
   *
   * They had no music at all, which made them the quietest screens in the app —
   * and they are also the ones with the least happening visually, so the
   * silence was doing real damage. `bed-deep` is the least melodic of the six
   * families, which is what a game with a rising multiplier needs: anything
   * with a tune fights the tension the number is building.
   */
  useAmbientBed(INSTANT_BEDS[game.id] ?? INSTANT_BED);

  /*
   * Recorded wins, not the synthesised fallback.
   *
   * These games never installed a sound set — `SoundSet` is written in the
   * vocabulary of a reel and none of them has reels — so every win here played
   * the two-oscillator chime that exists only to cover a slow download. See
   * INSTANT_SOUNDS.
   */
  useEffect(() => {
    useSoundSet(INSTANT_SOUND_SETS[game.id] ?? INSTANT_SOUNDS);
  }, [game.id]);

  const header = (
    <View style={styles.topRow}>
      <View>
        <Txt variant="caption" color={colors.text.muted}>
          BALANCE
        </Txt>
        <Txt variant="money" color={colors.gold.default}>
          {format(state.balance, 'GC')}
        </Txt>
      </View>
      {INSTANT_RULES[game.id] ? (
        <HowToPlayButton
          title={game.name}
          content={INSTANT_RULES[game.id]!}
          accent={game.accent}
        />
      ) : null}
      <SoundToggles compact />
    </View>
  );

  return (
    <View style={styles.frame}>
    {pinHeader ? <View style={styles.pinnedHeader}>{header}</View> : null}
    <Screen contentStyle={[styles.scrollBody, !!dockControl && styles.scrollBodyWithControl]}>
      {!pinHeader ? header : null}

      {children}

      {/*
        Hidden, not dimmed, while a round is open.

        The stake is already committed at that point, so the chips are dead
        controls — and on Mines, which is the tallest, the fifty
        points they occupy were pushing the CASH OUT button off the bottom of
        the screen at exactly the moment it is the only thing the player wants.
        Dimming them kept the cost and removed the use.
      */}
      {footer}

      {state.error ? (
        <Txt variant="bodySmall" color={colors.feedback.error}>
          {state.error}
        </Txt>
      ) : null}
    </Screen>

      {/*
        THE DOCK.

        Measured on a 700-point phone, the tab bar floats over the bottom 69
        points — so the usable height is 631, and several of these games put
        their one play button underneath it. The button looked present and was
        not tappable: a tap on Plinko's Drop opened the Wallet tab instead.

        Shaving each board was the first attempt and it is the wrong shape of
        fix — it has to be redone for every new viewport, and it trades away
        the play area to buy space for the control. Pinning is what roulette
        does, the founder liked it there, and it is correct by construction:
        the button cannot be below the fold because it is not in the scroll.

        The scroll reserves the matching height, so nothing is permanently
        hidden behind it.
      */}
      {action ? <View style={styles.dock}>
        {dockControl ? <View style={styles.dockControl}>{dockControl}</View> : null}
        {!stakeLocked ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dockChips}>
          {state.options.map((option) => {
            const selected = option === state.bet;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  unlock();
                  sounds.tap();
                  state.setBet(option);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.dockChip, selected && { backgroundColor: game.accent, borderColor: lighten(game.accent) }]}
              >
                <Txt variant="caption" color={selected ? colors.surface.base : colors.text.secondary}>{format(option, 'GC')}</Txt>
              </Pressable>
            );
          })}
        </ScrollView> : null}
        {action}
      </View> : null}
    </View>
  );
}

/**
 * The play area's panel.
 *
 * Was a flat `#05091A` rectangle with a grey hairline — the same slab on all
 * games, which is most of why they read as one unfinished screen rather
 * than distinct games. It is now lit: a vertical gradient so the panel has a top
 * and a bottom, a border in the game's own accent so each one is identifiably
 * itself, and a sheen across the top third.
 *
 * The accent is the single strongest per-game signal available here. These
 * games have no artwork — no reels, no felt, no cards — so colour is doing the
 * work that a painted cabinet does on a slot.
 */
export function Board({
  accent,
  children,
  /** Set on the frame a win is revealed — the panel flares and throws sparks. */
  celebrate,
  cabinet = 'crash',
  bodyStyle,
}: {
  accent: string;
  children: React.ReactNode;
  celebrate?: CelebrationHandle;
  cabinet?: InstantCabinet;
  /** Per-game geometry. Tall playfields may reclaim side padding without changing every cabinet. */
  bodyStyle?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState({ width: 320, height: 320 });
  const flare = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  /**
   * The rim flares when a win lands.
   *
   * Cheap, and it does most of the work: the border already carries the game's
   * accent, so driving it to full brightness for half a second turns the whole
   * panel into the thing that reacted. A number changing colour is a detail
   * you have to be looking at; the frame lighting up is not.
   */
  useEffect(() => {
    if (!celebrate) return undefined;
    celebrate.onWin = (power: number) => {
      if (reduced) return;
      flare.setValue(0);
      Animated.sequence([
        Animated.timing(flare, { toValue: 1, duration: 110, useNativeDriver: false }),
        Animated.timing(flare, { toValue: 0, duration: 620, useNativeDriver: false }),
      ]).start();
      celebrate.sparks.current?.fire(power);
    };
    return () => {
      celebrate.onWin = undefined;
    };
  }, [celebrate, flare, reduced]);

  const borderColor = flare.interpolate({
    inputRange: [0, 1],
    outputRange: [`${accent}55`, '#FFFFFF'],
  });
  const finish = CABINET_FINISH[cabinet];

  return (
    <Animated.View
      style={[styles.boardOuter, { borderColor, shadowColor: accent }]}
      onLayout={(event) =>
        setSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      <LinearGradient
        colors={finish.panel}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.cabinetArt}>
        <Image
          source={{ uri: `/art/tiles/${CABINET_ART[cabinet]}` }}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>
      <LinearGradient
        colors={['rgba(1,4,12,0.12)', 'rgba(1,4,12,0.66)', 'rgba(1,4,12,0.92)']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StageAtmosphere cabinet={cabinet} accent={accent} />
      {/* A cabinet's glass is a material, not a plain dark rectangle. */}
      <View style={[styles.innerRim, { borderColor: finish.rim }]} pointerEvents="none" />
      {/* The sheen. Non-interactive, and it must say so on a plain View —
          `pointerEvents` does not reach the DOM through LinearGradient. */}
      <View style={styles.boardSheen} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.boardBody, bodyStyle]}>{children}</View>
      {celebrate ? (
        <Fireworks
          width={size.width}
          height={size.height}
          controller={celebrate.sparks}
        />
      ) : null}
    </Animated.View>
  );
}

const CABINET_FINISH: Record<InstantCabinet, {
  panel: [string, string, string];
  rim: string;
}> = {
  crash: { panel: ['#1A0705', '#0A0509', '#02030A'], rim: '#F3B84A' },
  limbo: { panel: ['#06212B', '#031018', '#01050B'], rim: '#67E8F9' },
  dice: { panel: ['#122104', '#091006', '#020502'], rim: '#D9F99D' },
  plinko: { panel: ['#25062F', '#12071F', '#030108'], rim: '#F5B7FF' },
  mines: { panel: ['#062633', '#04121D', '#01050A'], rim: '#7DD3FC' },
  scratch: { panel: ['#341504', '#16070A', '#030204'], rim: '#FFE08A' },
};

const CABINET_ART: Record<InstantCabinet, string> = {
  crash: 'juwa-crash.png',
  limbo: 'juwa-limbo.png',
  dice: 'juwa-dice.png',
  plinko: 'juwa-plinko.png',
  mines: 'juwa-mines.png',
  scratch: 'juwa-scratch.png',
};

/**
 * Non-interactive moving light architecture behind each game. The six boards
 * deliberately have different geometry, so a player changes *place* when
 * changing games rather than merely changing the colour of one card.
 */
function StageAtmosphere({ cabinet, accent }: { cabinet: InstantCabinet; accent: string }) {
  const drift = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: cabinet === 'crash' ? 3500 : 5200, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: cabinet === 'crash' ? 3500 : 5200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cabinet, drift, reduced]);

  const translate = drift.interpolate({ inputRange: [0, 1], outputRange: ['-14%', '14%'] });
  const rotate = drift.interpolate({ inputRange: [0, 1], outputRange: ['-10deg', '10deg'] });

  return (
    <View pointerEvents="none" style={styles.stageAtmosphere}>
      {cabinet === 'crash' ? <>
        <Animated.View style={[styles.crashArc, { borderColor: accent, transform: [{ rotate }] }]} />
        <Animated.View style={[styles.crashArcInner, { borderColor: '#FFE9A6', transform: [{ rotate: rotate }] }]} />
        <Animated.View style={[styles.crashStreak, { backgroundColor: accent, transform: [{ translateX: translate }, { rotate: '-24deg' }] }]} />
      </> : null}
      {cabinet === 'limbo' ? <>
        <Animated.View style={[styles.limboBeam, { backgroundColor: accent, transform: [{ translateX: translate }, { rotate: '-18deg' }] }]} />
        <View style={[styles.limboFrame, { borderColor: accent }]} />
      </> : null}
      {cabinet === 'dice' ? <>
        <Animated.View style={[styles.diceDiamond, { borderColor: accent, transform: [{ rotate }] }]} />
        <View style={[styles.diceDiamondInner, { borderColor: '#FFF6BE' }]} />
      </> : null}
      {cabinet === 'plinko' ? <>
        <Animated.View style={[styles.plinkoHalo, { borderColor: accent, transform: [{ rotate }] }]} />
        <View style={styles.plinkoMatrix}>{Array.from({ length: 24 }, (_, i) => <View key={i} style={[styles.matrixDot, { backgroundColor: i % 3 === 0 ? '#FFF0FC' : accent }]} />)}</View>
      </> : null}
      {cabinet === 'mines' ? <>
        <Animated.View style={[styles.minesSweep, { backgroundColor: accent, transform: [{ translateX: translate }, { rotate: '-36deg' }] }]} />
        <View style={styles.minesMesh}>{Array.from({ length: 16 }, (_, i) => <View key={i} style={[styles.meshCell, { borderColor: accent }]} />)}</View>
      </> : null}
      {cabinet === 'scratch' ? <>
        <Animated.View style={[styles.scratchRay, { backgroundColor: accent, transform: [{ rotate }] }]} />
        <Animated.View style={[styles.scratchRayAlt, { backgroundColor: '#FFF2AC', transform: [{ rotate: '-28deg' }, { translateX: translate }] }]} />
      </> : null}
    </View>
  );
}

/**
 * The handle a game uses to set its own board off.
 *
 * A mutable object rather than a prop, because the celebration is an EVENT at
 * a moment, not a state the board is in. Passing `won` as a prop would mean the
 * board re-firing whenever it re-rendered while that flag was true, and
 * deriving "is this a new win" inside the board from a payout it does not own.
 */
export interface CelebrationHandle {
  sparks: React.MutableRefObject<FireworksHandle | null>;
  onWin?: (power: number) => void;
}

/**
 * Wire a board for celebration, and get back the trigger.
 *
 * `power` is derived from the payout against the stake and clamped: a win of
 * ten times the stake or more is a full burst, and everything smaller scales
 * down from there. So a 1.01× cash-out gets a flicker and a 40× gets fireworks,
 * which is the ordering a player expects without being told.
 */
export function useCelebration(): {
  handle: CelebrationHandle;
  celebrate: (round: RoundResponse | null) => void;
} {
  const sparks = useRef<FireworksHandle | null>(null);
  const handle = useRef<CelebrationHandle>({ sparks }).current;

  const celebrate = useCallback(
    (round: RoundResponse | null) => {
      const payout = round?.settlement?.payout ?? 0;
      const stake = round?.settlement?.stake ?? 0;
      if (payout <= 0 || stake <= 0) return;
      const ratio = payout / stake;
      handle.onWin?.(Math.max(0, Math.min(1, (ratio - 1) / 9)));
    },
    [handle],
  );

  return { handle, celebrate };
}

/**
 * The primary action. One per screen, always the largest thing on it.
 *
 * Gradient rather than flat fill, with a highlight along the top edge — the
 * same treatment the roulette wheel's bezel gets, for the same reason: a flat
 * coloured pill reads as a placeholder. It also BREATHES while it is waiting
 * to be pressed, which is the cheapest way to make a static screen feel alive
 * and, more usefully, points at the one control that does anything.
 */
export function PlayButton({
  label,
  onPress,
  disabled,
  colour,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colour: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (disabled) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [disabled, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          unlock();
          sounds.tap();
          onPress();
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.play,
          {
            shadowColor: colour,
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale: pressed && !disabled ? 0.975 : 1 }],
          },
        ]}
      >
        <LinearGradient
          colors={['#12131C', darken(colour), '#05060B']}
          locations={[0, 0.48, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.playCore, { borderColor: lighten(colour) }]} pointerEvents="none">
          <LinearGradient
            colors={[lighten(colour), colour, darken(colour)]}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.playSheen} pointerEvents="none" />
        <Txt variant="h3" color={colors.surface.base}>
          {label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Shift a hex accent towards white or black.
 *
 * The five accents are given as hex in one table, and asking for a second and
 * third shade of each by hand would be three columns to keep in step. Mixing
 * here means a new game needs one colour and gets a lit button.
 */
function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const value = (n >> shift) & 0xff;
    return Math.round(value + (target - value) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
const lighten = (hex: string) => mix(hex, 255, 0.42);
const darken = (hex: string) => mix(hex, 0, 0.34);

/**
 * Play the right sound for a settled round — WHEN THE PICTURE SAYS SO.
 *
 * ## The bug this replaces, which was mine and was serious
 *
 * The first version was an effect keyed on the round: the moment the server's
 * response arrived, the sound played. But every one of these games now has an
 * animation between the response and the reveal — Crash climbs for up to four
 * seconds, Plinko falls peg by peg, Limbo and Dice churn. So the win chime
 * sounded first and the game announced the win afterwards.
 *
 * The founder's reading of that was exact and damning: "feels like the system
 * knows when the player is going to win and the sound appears first". It is a
 * fair description of what was happening. The client did know — it had been
 * told, correctly, several seconds earlier — and it leaked that knowledge
 * through the speaker.
 *
 * In a real-money product this is the kind of defect that ends a licence
 * application. In this one it destroys the only thing a social casino has to
 * sell, which is that the game is straight.
 *
 * ## So it is called, not observed
 *
 * There is no effect and nothing watches the round. Each game calls `announce`
 * at the exact frame its own animation finishes, which is the frame the player
 * learns the result. A game that forgets to call it is silent — a bug, but a
 * safe one, and much easier to notice than a sound arriving early.
 *
 * Guarded by round id so a re-render cannot replay a fanfare over a result the
 * player is already reading.
 */
export function useSettlementAnnouncer(): (round: RoundResponse | null) => void {
  const announced = useRef<string | null>(null);

  return useCallback((round: RoundResponse | null) => {
    if (!round || round.status !== 'settled') return;
    if (announced.current === round.roundId) return;
    announced.current = round.roundId;

    const payout = round.settlement?.payout ?? 0;
    const stake = round.settlement?.stake ?? 0;
    if (payout <= 0) {
      sounds.lose();
      return;
    }
    // Ten times the stake is the threshold the slots use for their longest
    // fanfare, and using the same one here means a big win sounds like a big
    // win everywhere in the app rather than per screen.
    if (payout >= stake * 10) sounds.bigWin();
    else sounds.win();
  }, []);
}

/** The pinned button (58) plus the dock's own padding, top and bottom. */
const DOCK_HEIGHT = 58 + 24 + 48;

export const styles = StyleSheet.create({
  frame: { flex: 1 },
  /** Clears the dock, which floats over this scroll view. */
  scrollBody: { paddingBottom: DOCK_HEIGHT + spacing.md },
  scrollBodyWithControl: { paddingBottom: DOCK_HEIGHT + 52 + spacing.md },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface.raised,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  dockChips: { gap: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: 1 },
  dockControl: { minHeight: 34, paddingBottom: spacing.xs, justifyContent: 'center' },
  dockChip: { minHeight: 34, minWidth: 76, paddingHorizontal: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: '#3A3446', backgroundColor: '#15131D', justifyContent: 'center', alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pinnedHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface.border,
    zIndex: 3,
  },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  chips: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chipsLocked: { opacity: 0.4 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  play: {
    minHeight: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#5A441A',
    // A coloured glow under the one button that does anything.
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  playCore: { ...StyleSheet.absoluteFillObject, margin: 4, borderRadius: 11, borderWidth: 1, overflow: 'hidden' },
  playSheen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '46%',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  boardOuter: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  cabinetArt: { ...StyleSheet.absoluteFillObject, opacity: 0.34 },
  stageAtmosphere: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', opacity: 0.46 },
  crashArc: { position: 'absolute', width: '138%', aspectRatio: 1, left: '-22%', top: '-64%', borderWidth: 1, borderRadius: 999 },
  crashArcInner: { position: 'absolute', width: '100%', aspectRatio: 1, left: '0%', top: '-46%', borderWidth: 1, borderRadius: 999, opacity: 0.6 },
  crashStreak: { position: 'absolute', width: '86%', height: 2, left: '-10%', top: '56%', shadowOpacity: 0.9, shadowRadius: 10 },
  limboBeam: { position: 'absolute', height: '185%', width: '12%', left: '42%', top: '-42%', opacity: 0.25 },
  limboFrame: { position: 'absolute', left: '13%', right: '13%', top: '18%', bottom: '18%', borderWidth: 1, borderRadius: 18, opacity: 0.22 },
  diceDiamond: { position: 'absolute', width: 240, height: 240, alignSelf: 'center', top: -34, borderWidth: 1, transform: [{ rotate: '45deg' }], opacity: 0.36 },
  diceDiamondInner: { position: 'absolute', width: 140, height: 140, alignSelf: 'center', top: 16, borderWidth: 1, transform: [{ rotate: '45deg' }], opacity: 0.2 },
  plinkoHalo: { position: 'absolute', width: 260, height: 260, alignSelf: 'center', top: -92, borderWidth: 1, borderRadius: 130, opacity: 0.4 },
  plinkoMatrix: { position: 'absolute', right: 12, bottom: 14, width: 102, flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: 0.42 },
  matrixDot: { width: 5, height: 5, borderRadius: 3 },
  minesSweep: { position: 'absolute', height: '180%', width: '16%', left: '18%', top: '-40%', opacity: 0.18 },
  minesMesh: { position: 'absolute', left: 18, right: 18, top: 16, bottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: 0.16 },
  meshCell: { width: '22%', aspectRatio: 1, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  scratchRay: { position: 'absolute', width: '150%', height: 3, left: '-30%', top: '42%', opacity: 0.45 },
  scratchRayAlt: { position: 'absolute', width: '100%', height: 2, left: '4%', top: '62%', opacity: 0.45 },
  innerRim: { ...StyleSheet.absoluteFillObject, margin: 4, borderWidth: 1, borderRadius: radius.md, opacity: 0.55 },
  boardSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '34%' },
  /*
   * Tight on purpose. Plinko's pegs and Mines' 25 tiles are the two tallest
   * play areas, and at `lg` padding with `md` gaps both pushed their own play
   * button below the fold on a 700-point screen — the exact complaint that got
   * roulette's controls pinned. Height is the scarce resource on these two and
   * nowhere is it cheaper to reclaim than in the gaps.
   */
  boardBody: { padding: spacing.md, gap: spacing.sm, alignItems: 'center' },
  /** @deprecated Use `Board`. Kept only until the last screen stops importing it. */
  board: {
    backgroundColor: '#05091A',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  result: { alignItems: 'center', gap: 2, minHeight: 44, justifyContent: 'center' },
});
