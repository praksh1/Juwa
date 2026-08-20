import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { publishBalance } from '../api/usePlayer';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Button, Card, Txt } from '../components/primitives';
import { SoundToggles } from '../components/SoundToggles';
import { PlayingCard, type Suit } from '../components/PlayingCard';
import { sounds, unlock, useSoundSet } from '../sound';
import { BLACKJACK_SOUNDS } from '../api/sound-sets';
import { BLACKJACK_BED, useAmbientBed } from '../ambience';
import { HowToPlayButton, type HowToPlayContent } from '../components/HowToPlay';
import { Fireworks, type FireworksHandle } from '../components/Fireworks';
import {
  PlayApiError,
  USE_DEMO_API,
  createPlayApi,
  type PlayApi,
  type RoundResponse,
} from '../api/client';

const GAME_ID = 'juwa-blackjack';
const MIN_BET = minor(100);
const MAX_BET = minor(100_000);

/**
 * Blackjack.
 *
 * The multi-step counterpart to slots. A round stays open between requests: the
 * server holds the shoe and the dealer's hole card, and this screen only ever
 * sees what a player at the table would see.
 *
 * `availableActions` comes from the server and is the single source of truth for
 * which buttons exist. The screen never works out for itself whether a double
 * is legal — if it did, the two could disagree, and the disagreement would
 * always favour whichever side was wrong.
 */

interface Card {
  rank: string;
  suit: Suit;
}

interface Hand {
  cards: Card[];
  stake: number;
  done: boolean;
  outcome?: 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
  payout?: number;
}

interface BlackjackPublic {
  hands: Hand[];
  activeHand: number;
  dealer: Card[];
  dealerRevealed: boolean;
}

/** Mirrors the engine's scoring so the total can be shown without a round trip. */
function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11;
      aces++;
    } else if (['K', 'Q', 'J', '10'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const ACTION_LABELS: Record<string, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
};

const OUTCOME_TEXT: Record<string, string> = {
  blackjack: 'BLACKJACK!',
  win: 'You win',
  push: 'Push — stake returned',
  lose: 'Dealer wins',
  bust: 'Bust',
};


/**
 * How to play, for the game that needs it most.
 *
 * Blackjack looks simple and is not. A casual player knows "get to 21" and does
 * not know that the dealer must draw to 16 and stand on 17, that a soft hand
 * cannot bust on the next card, that a natural pays three to two while every
 * other win pays even money, or what doubling actually commits them to. Every
 * one of those changes what the right move is, and none of them is discoverable
 * from the buttons.
 *
 * The odds line is the honest one: 99.5% is the best return in this building,
 * and only if you play well — which is a fact worth telling a player, because
 * it is the reason to learn the game rather than a reason to distrust it.
 */
const BLACKJACK_RULES: HowToPlayContent = {
  summary:
    'Beat the dealer by getting closer to 21 than they do, without going over. ' +
    'Cards are worth their number, picture cards are 10, and an ace is 1 or 11 — ' +
    'whichever helps you.',
  steps: [
    'Choose your stake and press Deal. You get two cards face up; the dealer gets one face up and one face down.',
    'Hit to take another card, or Stand to keep what you have. Go over 21 and you lose the hand immediately.',
    'When you stand, the dealer turns over their card and draws until they reach 17 or more.',
    'Closest to 21 without going over wins. Equal totals is a push and your stake comes back.',
  ],
  controls: [
    { label: 'Hit', body: 'Take one more card. You can keep hitting until you stand or go over 21.' },
    { label: 'Stand', body: 'Take no more cards and pass to the dealer.' },
    {
      label: 'Double',
      body: 'Double your stake and take exactly one more card, then stand automatically. Offered only on your first two cards.',
    },
    {
      label: 'Split',
      body: 'Only when your first two cards are a pair. Splits them into two hands, each with its own stake, played one after the other.',
    },
  ],
  edge:
    'An ace with a ten or a picture card is a blackjack and pays 3:2 — a 1,000 ' +
    'coin stake returns 2,500. Every other win pays even money. The dealer must ' +
    'draw to 16 and must stand on 17, which is why their upcard tells you so ' +
    'much. Played well this is the best return in the building at 99.5%, and ' +
    '"soft" on your total means you hold an ace counting as 11 — you cannot go ' +
    'over 21 on the next card.',
};

export function BlackjackScreen() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const compactTable = viewportHeight < 860 || viewportWidth < 440;
  const api = useRef<PlayApi>(createPlayApi()).current;

  /*
   * The table's own room tone and its own three sounds — a card, a chip and a
   * result. This screen had neither: it was the last game in the app with no
   * music and no recorded win, playing the synthesised fallback that exists to
   * cover a slow download. See BLACKJACK_SOUNDS.
   */
  useAmbientBed(BLACKJACK_BED);
  useEffect(() => {
    useSoundSet(BLACKJACK_SOUNDS);
  }, []);

  /** The coin fountain, thrown when a hand pays. */
  const sparks = useRef<FireworksHandle | null>(null);
  const [tableSize, setTableSize] = useState({ width: 340, height: 380 });

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(1_000));
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lamp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(lamp, { toValue: 1, duration: 2600, useNativeDriver: true }),
      Animated.timing(lamp, { toValue: 0, duration: 2600, useNativeDriver: true }),
    ]));
    glow.start();
    return () => glow.stop();
  }, [lamp]);

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => {
        if (!alive) return;
        const current = minor(result.balance);
        setBalance(current);
        setBet(suggestedBet(current, MIN_BET, MAX_BET));
      })
      .catch(() => alive && setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api]);

  const options = useMemo(() => betOptions(balance, MIN_BET, MAX_BET), [balance]);
  const table = round?.state as BlackjackPublic | undefined;
  const settled = round?.status === 'settled';
  const inHand = Boolean(round) && !settled;

  /**
   * Sound and sparks for however the hand ended, once the dealer is revealed.
   *
   * Already delayed by the callers to land AFTER the cards have turned over —
   * which is the property the instant games had to be rebuilt to get, and which
   * this screen happened to have from the start. The fountain is added on the
   * same call for the same reason: the celebration must not precede the reveal.
   */
  const announce = useCallback((state: BlackjackPublic, payout: number, staked: number) => {
    const natural = state.hands.some((hand) => hand.outcome === 'blackjack');
    if (natural) {
      sounds.bigWin();
      sounds.coins(6);
    } else if (payout > staked) {
      sounds.win();
    } else if (payout === staked) {
      sounds.cardFlip();
    } else {
      sounds.lose();
    }

    /*
     * A natural always gets the full burst — it is the best hand in the game
     * and pays 3:2, so it is a moment regardless of the stake. Everything else
     * scales with what was actually returned, and a push (payout equals stake)
     * throws nothing: getting your own money back is not a win.
     */
    if (payout <= staked) return;
    const power = natural ? 1 : Math.max(0, Math.min(1, (payout / Math.max(staked, 1) - 1) / 1.5));
    sparks.current?.fire(power);
  }, []);

  const deal = useCallback(async () => {
    if (busy) return;
    if (bet > balance) {
      setError('Not enough coins for that bet');
      return;
    }
    unlock();
    sounds.cardDeal();

    setBusy(true);
    setError(null);
    setRound(null);
    setBalance((current) => minor(current - bet));

    try {
      const result = await api.placeBet({
        gameId: GAME_ID,
        stake: bet,
        idempotencyKey: `${Date.now()}-bj`,
      });
      setRound(result);
      setBalance(minor(result.balance));
      publishBalance(minor(result.balance));

      const state = result.state as BlackjackPublic;
      // Four cards, dealt in sequence.
      [0, 1, 2, 3].forEach((i) => setTimeout(() => sounds.cardDeal(), i * 110));
      if (result.status === 'settled') {
        setTimeout(() => announce(state, result.settlement?.payout ?? 0, bet), 500);
      }
    } catch (caught) {
      setBalance((current) => minor(current + bet));
      sounds.error();
      setError(caught instanceof PlayApiError ? caught.message : 'Could not deal. Try again.');
    } finally {
      setBusy(false);
    }
  }, [announce, api, balance, bet, busy]);

  const act = useCallback(
    async (action: string) => {
      if (!round || busy) return;
      unlock();
      sounds.tap();
      if (action === 'hit' || action === 'double' || action === 'split') sounds.cardDeal();

      setBusy(true);
      setError(null);
      try {
        const result = await api.act({
          roundId: round.roundId,
          action: { type: action },
          idempotencyKey: `${Date.now()}-${action}`,
        });
        setRound(result);
        setBalance(minor(result.balance));
        publishBalance(minor(result.balance));

        if (result.status === 'settled') {
          const state = result.state as BlackjackPublic;
          // The hole card turns over as the hand resolves.
          sounds.cardFlip();
          setTimeout(
            () => announce(state, result.settlement?.payout ?? 0, result.settlement?.stake ?? bet),
            420,
          );
        }
      } catch (caught) {
        sounds.error();
        setError(caught instanceof PlayApiError ? caught.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [announce, api, bet, busy, round],
  );

  const dealerValue = table ? handValue(table.dealer) : null;
  const splitTable = (table?.hands.length ?? 0) > 1;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, compactTable && styles.contentCompact]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
        </View>
        {/*
          The rules, one tap away.

          Blackjack is the least self-explanatory game in the app — soft totals,
          when a double is offered, what the dealer is obliged to do — and none
          of it is visible from the buttons. It replaces a "Pays 3:2" pill that
          stated one rule out of six. See BLACKJACK_RULES.
        */}
        <HowToPlayButton title="Blackjack" content={BLACKJACK_RULES} accent={colors.gold.default} />
        {/* Sound, reachable without leaving the game. See SoundToggles. */}
        <SoundToggles compact />
      </View>

      <View
        style={[styles.table, compactTable && styles.tableCompact]}
        onLayout={(event) =>
          setTableSize({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
      >
        <Image
          source={{ uri: '/art/tiles/juwa-blackjack.png' }}
          resizeMode="cover"
          style={styles.tableArtwork}
        />
        {/*
          Lit felt, not a flat green rectangle.

          A real table is a bowl of light: brightest under the lamp in the
          middle, falling off to the rail. One radial-ish gradient plus a darker
          rim is the whole difference between "green background" and "table",
          and it costs two views.
        */}
        <LinearGradient
          colors={['rgba(3,5,9,0.88)', 'rgba(5,72,51,0.84)', 'rgba(1,25,19,0.94)']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tableRail} pointerEvents="none">
          <View style={styles.tableRailInner} />
        </View>
        <LinearGradient colors={['rgba(181,119,50,0)', 'rgba(116,62,19,0.68)', 'rgba(25,11,5,0.95)']} style={styles.tableRailGlow} pointerEvents="none" />
        <View style={styles.feltInset} pointerEvents="none" />
        <Animated.View style={[styles.lampPool, { opacity: lamp.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.52] }) }]} pointerEvents="none" />
        <View style={styles.tableDimension} pointerEvents="none" />
        <View style={styles.tablePerspectiveLeft} pointerEvents="none" />
        <View style={styles.tablePerspectiveRight} pointerEvents="none" />
        <View style={styles.playerArc} pointerEvents="none" />
        <View style={styles.tableWatermark} pointerEvents="none">
          <Txt variant="display" color="rgba(242,210,125,0.10)">21</Txt>
        </View>
        <View style={styles.casinoRules} pointerEvents="none">
          <Txt variant="caption" color="rgba(255,224,145,0.62)">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17</Txt>
        </View>
        <View style={[styles.betSpot, styles.betSpotLeft]} pointerEvents="none" />
        <View style={[styles.betSpot, styles.betSpotCentre]} pointerEvents="none" />
        <View style={[styles.betSpot, styles.betSpotRight]} pointerEvents="none" />
        <View style={styles.dealerHardware} pointerEvents="none">
          <View style={styles.discardTray}>
            <View style={styles.discardSlot} />
            <View style={styles.discardSlot} />
            <View style={styles.discardSlot} />
          </View>
          <View style={styles.cardShoe}>
            <LinearGradient colors={['#6A4B1B', '#15110D', '#020407']} style={StyleSheet.absoluteFill} />
            <View style={styles.shoeCard} />
            <View style={[styles.shoeCard, styles.shoeCardTwo]} />
            <View style={styles.shoeMouth} />
          </View>
        </View>
        <View style={styles.tablePlaque} pointerEvents="none">
          <Txt variant="caption" color="#FFE9A6">JUWA GRAND TABLE · 21</Txt>
        </View>
        <View style={styles.feltSheen} pointerEvents="none">
          <LinearGradient
            colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Dealer */}
        <View style={[styles.seat, compactTable && styles.seatCompact]}>
          <View style={styles.seatLabel}>
            <Txt variant="caption" color="#C9A95D">
              DEALER
            </Txt>
          </View>
          <View style={styles.cards}>
            {table ? (
              table.dealer.map((card, i) => (
                <PlayingCard key={`d-${i}`} rank={card.rank} suit={card.suit} index={i} dealOrder={i === 0 ? 1 : 4 + i} trajectory="dealer" size={compactTable ? 'small' : 'normal'} />
              ))
            ) : (
              <Txt variant="bodySmall" color={colors.text.muted}>
                —
              </Txt>
            )}
            {/* Before the reveal the hole card is not in `dealer` at all — the
                server never sent it. This is a placeholder, not a hidden value. */}
            {table && !table.dealerRevealed ? (
              <PlayingCard rank="?" suit="S" hidden index={1} dealOrder={3} trajectory="dealer" size={compactTable ? 'small' : 'normal'} />
            ) : null}
            {table?.dealerRevealed && dealerValue ? (
              <View style={styles.handTotalBadge}>
                <Txt variant="h2" color="#FFF0B1">{dealerValue.total}</Txt>
                {dealerValue.soft ? <Txt variant="caption" color="#C9A95D">SOFT</Txt> : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Player, one block per hand after a split */}
        {table ? (
          <View style={splitTable ? styles.splitHands : undefined}>
          {table.hands.map((hand, handIndex) => {
            const value = handValue(hand.cards);
            const active = !settled && handIndex === table.activeHand;
            return (
              <View
                key={`h-${handIndex}`}
                style={[
                  styles.seat,
                  compactTable && styles.seatCompact,
                  splitTable && styles.splitSeat,
                  active && styles.seatActive,
                ]}
              >
                <View style={styles.seatLabel}>
            <Txt variant="caption" color={active ? '#FFE89B' : '#C9A95D'}>
                    {table.hands.length > 1 ? `HAND ${handIndex + 1}` : 'YOU'}
                    {' · '}
                    {format(minor(hand.stake), 'GC')}
                  </Txt>
                </View>
                <View style={[styles.cards, splitTable && styles.cardsSplit]}>
                  {hand.cards.map((card, i) => (
                    <PlayingCard
                      key={`h${handIndex}-${i}`}
                      rank={card.rank}
                      suit={card.suit}
                      index={i}
                      dealOrder={i * 2 + handIndex}
                      trajectory="player"
                      size={compactTable || table.hands.length > 1 ? 'small' : 'normal'}
                    />
                  ))}
                  <View style={[styles.handTotalBadge, splitTable && styles.handTotalBadgeSplit]}>
                    <Txt variant="h2" color={active ? '#FFF1B5' : '#F7E9BC'}>{value.total}</Txt>
                    {value.soft ? <Txt variant="caption" color="#C9A95D">SOFT</Txt> : null}
                  </View>
                </View>
                {hand.outcome ? (
                  <Txt
                    variant="bodySmall"
                    color={
                      hand.outcome === 'blackjack' || hand.outcome === 'win'
                        ? colors.feedback.winBright
                        : hand.outcome === 'push'
                          ? colors.text.secondary
                          : colors.feedback.loss
                    }
                  >
                    {OUTCOME_TEXT[hand.outcome]}
                    {hand.payout ? ` · +${format(minor(hand.payout), 'GC')}` : ''}
                  </Txt>
                ) : null}
              </View>
            );
          })}
          </View>
        ) : (
          <View style={[styles.seat, compactTable && styles.seatCompact]}>
            <Txt variant="bodySmall" color={colors.text.muted}>
              Pick a bet and deal.
            </Txt>
          </View>
        )}

        {error ? (
          <Txt variant="bodySmall" color={colors.feedback.error}>
            {error}
          </Txt>
        ) : USE_DEMO_API ? (
          <Txt variant="caption" color={colors.feedback.warning}>
            ⚠️ Demo mode cannot deal blackjack — the dealer, the shoe and the
            hole card all live on the server. Configure EXPO_PUBLIC_API_URL.
          </Txt>
        ) : null}

        {/* Over the felt, under nothing. See Fireworks. */}
        <Fireworks width={tableSize.width} height={tableSize.height} controller={sparks} />
      </View>

      </ScrollView>

      {/* The betting rail is deliberately outside the scroll view. A player
          should never lose their stake chips after a hand settles. */}
      <View style={[styles.tableDock, compactTable && styles.tableDockCompact]}>
      {settled ? (
        <View style={styles.payoutReadout}>
          <Txt variant="caption" color="#CBA75A">LAST HAND</Txt>
          <Txt variant="bodySmall" color={(round?.settlement?.payout ?? 0) > 0 ? colors.feedback.winBright : colors.feedback.loss}>
            {(round?.settlement?.payout ?? 0) > 0 ? `PAYS ${format(minor(round?.settlement?.payout ?? 0), 'GC')}` : 'NO WIN · DEAL AGAIN'}
          </Txt>
        </View>
      ) : null}
      {/* Bet selection is only meaningful between hands. */}
      {!inHand ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.betRow}>
          {options.map((option) => {
            const active = option === bet;
            const affordable = option <= balance;
            return (
              <Pressable
                key={option}
                onPress={() => setBet(option)}
                disabled={busy || !affordable}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: !affordable }}
                style={[styles.chip, active && styles.chipActive, !affordable && styles.chipOff]}
              >
                <Txt
                  variant="caption"
                  color={active ? colors.text.inverse : colors.text.secondary}
                >
                  {format(option, 'GC')}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {inHand ? (
        <View style={styles.actions}>
          {round!.availableActions.map((action) => (
            <Button
              key={action}
              label={ACTION_LABELS[action] ?? action}
              variant={action === 'hit' || action === 'stand' ? 'primary' : 'secondary'}
              onPress={() => act(action)}
              disabled={busy}
              style={styles.actionButton}
            />
          ))}
        </View>
      ) : (
        <Button
          label={settled ? `Deal again · ${format(bet, 'GC')}` : `Deal ${format(bet, 'GC')}`}
          onPress={deal}
          loading={busy}
          disabled={busy || bet > balance}
          style={styles.deal}
        />
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.base,
  },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 190 },
  contentCompact: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: 150 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  // Green felt, because a blackjack table is green felt — but lit, and with a
  // rail. See the gradients in the render.
  table: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 82,
    borderBottomRightRadius: 82,
    borderWidth: 2,
    borderColor: '#B98B28',
    overflow: 'hidden',
    padding: spacing.lg + 4,
    gap: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.72,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
  },
  tableCompact: { padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 58, borderBottomRightRadius: 58 },
  tableArtwork: { ...StyleSheet.absoluteFillObject, opacity: 0.24 },
  tableRail: { ...StyleSheet.absoluteFillObject, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 80, borderBottomRightRadius: 80, borderWidth: 9, borderColor: '#3D1D0B', padding: 5 },
  tableRailInner: { flex: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 67, borderBottomRightRadius: 67, borderWidth: 2, borderColor: 'rgba(255,224,137,0.78)', shadowColor: '#000', shadowOpacity: 0.75, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  tableRailGlow: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 58, borderBottomLeftRadius: 72, borderBottomRightRadius: 72, opacity: 0.88 },
  feltInset: { ...StyleSheet.absoluteFillObject, margin: 14, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 62, borderBottomRightRadius: 62, borderWidth: 1, borderColor: 'rgba(246,214,128,0.35)' },
  lampPool: { position: 'absolute', width: 260, height: 150, borderRadius: 130, alignSelf: 'center', top: -54, backgroundColor: '#F8CD63', shadowColor: '#FFE29A', shadowRadius: 40 },
  tableDimension: { position: 'absolute', left: 30, right: 30, bottom: -44, height: 126, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(255,224,133,0.26)', backgroundColor: 'rgba(0,0,0,0.14)', transform: [{ scaleX: 1.18 }] },
  tablePerspectiveLeft: { position: 'absolute', left: 7, top: 70, bottom: 46, width: 2, backgroundColor: 'rgba(255,218,121,0.28)', transform: [{ rotate: '2deg' }] },
  tablePerspectiveRight: { position: 'absolute', right: 7, top: 70, bottom: 46, width: 2, backgroundColor: 'rgba(255,218,121,0.28)', transform: [{ rotate: '-2deg' }] },
  playerArc: { position: 'absolute', left: '13%', right: '13%', bottom: 19, height: 104, borderRadius: 999, borderWidth: 2, borderColor: 'rgba(246,210,119,0.26)', transform: [{ scaleY: 0.62 }] },
  tableWatermark: { position: 'absolute', alignSelf: 'center', top: '43%', width: 120, alignItems: 'center', transform: [{ rotate: '-8deg' }] },
  casinoRules: { position: 'absolute', left: 30, right: 30, bottom: 20, alignItems: 'center' },
  betSpot: { position: 'absolute', bottom: 37, width: 72, height: 38, borderRadius: 36, borderWidth: 1, borderColor: 'rgba(241,206,113,0.23)', transform: [{ scaleY: 0.62 }] },
  betSpotLeft: { left: '12%' },
  betSpotCentre: { alignSelf: 'center' },
  betSpotRight: { right: '12%' },
  dealerHardware: { position: 'absolute', top: 10, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  discardTray: { width: 46, height: 25, paddingHorizontal: 5, flexDirection: 'row', gap: 3, alignItems: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#8A6A2A', backgroundColor: 'rgba(3,5,8,0.78)' },
  discardSlot: { flex: 1, height: 15, borderRadius: 2, backgroundColor: 'rgba(236,222,184,0.14)' },
  cardShoe: { width: 66, height: 34, overflow: 'hidden', borderRadius: 6, borderWidth: 1, borderColor: '#D0A84B', transform: [{ perspective: 220 }, { rotateX: '-8deg' }] },
  shoeCard: { position: 'absolute', width: 32, height: 22, right: 8, top: 5, borderRadius: 3, borderWidth: 1, borderColor: '#E7CC86', backgroundColor: '#151E36', transform: [{ rotate: '-8deg' }] },
  shoeCardTwo: { right: 12, top: 3, opacity: 0.7 },
  shoeMouth: { position: 'absolute', left: 4, right: 4, bottom: 3, height: 5, borderRadius: 4, backgroundColor: '#050607', borderTopWidth: 1, borderTopColor: '#E2B758' },
  tablePlaque: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,218,116,0.62)', backgroundColor: 'rgba(8,12,16,0.66)' },
  feltSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '30%' },
  seat: { gap: spacing.sm, minHeight: 96 },
  seatCompact: { gap: 4, minHeight: 72 },
  // A split creates two betting positions on the same table, not a second
  // table below the first. Keeping the hands beside one another prevents the
  // second hand and its controls from falling under Safari's browser chrome.
  splitHands: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  splitSeat: { flex: 1, minWidth: 0, minHeight: 116, paddingHorizontal: 3 },
  seatActive: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold.default,
    paddingLeft: spacing.md,
    marginLeft: -spacing.md,
  },
  seatLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Extra right padding compensates for the negative margin that overlaps cards.
  cards: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg, minHeight: 74 },
  cardsSplit: { paddingRight: 0, minHeight: 58 },
  handTotalBadge: { minWidth: 54, minHeight: 54, marginLeft: spacing.md, paddingHorizontal: spacing.xs, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9,12,17,0.84)', borderWidth: 2, borderColor: '#C9A95D', shadowColor: '#F7CA62', shadowOpacity: 0.42, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  handTotalBadgeSplit: { minWidth: 42, minHeight: 42, marginLeft: 4, borderRadius: 21 },
  divider: { height: 1, backgroundColor: 'rgba(255,221,137,0.38)' },
  betRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: '#121825',
    borderWidth: 1.5,
    borderColor: '#6F5420',
    minWidth: 64,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#E1B649', borderColor: '#FFF0B0' },
  chipOff: { opacity: 0.35 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  actionButton: { flexGrow: 1, minWidth: 100 },
  deal: { minHeight: 56 },
  tableDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm, backgroundColor: '#0B0C14', borderTopWidth: 1, borderTopColor: '#886522' },
  tableDockCompact: { paddingHorizontal: spacing.sm, paddingTop: 5, paddingBottom: spacing.sm, gap: 5 },
  payoutReadout: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.sm },
});
