import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { WinOverlay } from '../components/WinOverlay';
import { winTier, type WinTier } from '../motion';
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
 * Relative to the original table wager. A profitable double or several
 * successful split hands can therefore earn a headline, while merely getting
 * all committed chips back never does.
 */
const BLACKJACK_WIN_TIERS = { big: 4, mega: 6, jackpot: 8 } as const;

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
  const [cardsSettling, setCardsSettling] = useState(false);
  const [displayedTotals, setDisplayedTotals] = useState<{
    dealer: ReturnType<typeof handValue> | null;
    hands: Array<ReturnType<typeof handValue> | null>;
  }>({
    dealer: null,
    hands: [],
  });
  const [handView, setHandView] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [headline, setHeadline] = useState<{ tier: WinTier; amount: number; round: number }>({
    tier: 'none', amount: 0, round: 0,
  });
  const headlineSequence = useRef(0);
  const lamp = useRef(new Animated.Value(0)).current;
  const presentationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const presentCards = useCallback((
    state: BlackjackPublic,
    duration: number,
    onPresented?: () => void,
  ) => {
    if (presentationTimer.current) clearTimeout(presentationTimer.current);
    setCardsSettling(true);
    presentationTimer.current = setTimeout(() => {
      setDisplayedTotals({
        dealer: handValue(state.dealer),
        hands: state.hands.map((hand) => handValue(hand.cards)),
      });
      setCardsSettling(false);
      presentationTimer.current = null;
      onPresented?.();
    }, duration);
  }, []);

  useEffect(() => () => {
    if (presentationTimer.current) clearTimeout(presentationTimer.current);
  }, []);

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
  const controlsLocked = busy || cardsSettling;

  useEffect(() => {
    if (!table) {
      setHandView(0);
      return;
    }
    setHandView(settled ? 0 : table.activeHand);
  }, [round?.roundId, settled, table?.activeHand, table?.hands.length]);

  /**
   * Sound and sparks for however the hand ended, once the dealer is revealed.
   *
   * Already delayed by the callers to land AFTER the cards have turned over —
   * which is the property the instant games had to be rebuilt to get, and which
   * this screen happened to have from the start. The fountain is added on the
   * same call for the same reason: the celebration must not precede the reveal.
   */
  const announce = useCallback((state: BlackjackPublic, payout: number, staked: number, originalBet: number) => {
    const natural = state.hands.some((hand) => hand.outcome === 'blackjack');
    const calculatedTier = winTier(payout, originalBet, BLACKJACK_WIN_TIERS);
    const headlineTier: WinTier = payout > staked
      ? natural && calculatedTier !== 'mega' && calculatedTier !== 'jackpot'
        ? 'big'
        : calculatedTier
      : 'none';

    if (headlineTier === 'mega' || headlineTier === 'jackpot') {
      sounds.megaWin();
      sounds.coins(9);
    } else if (headlineTier === 'big') {
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
    if (headlineTier === 'big' || headlineTier === 'mega' || headlineTier === 'jackpot') {
      headlineSequence.current += 1;
      setHeadline({ tier: headlineTier, amount: payout, round: headlineSequence.current });
    }
    const power = natural ? 1 : Math.max(0, Math.min(1, (payout / Math.max(staked, 1) - 1) / 1.5));
    sparks.current?.fire(power);
  }, []);

  const commitBalance = useCallback((value: number) => {
    const current = minor(value);
    setBalance(current);
    publishBalance(current);
  }, []);

  const recoverBalance = useCallback(async () => {
    try {
      const current = await api.getBalance();
      commitBalance(current.balance);
    } catch {
      // Do not guess whether a timed-out request reached the table. The next
      // successful request/navigation will fetch the authoritative wallet.
    }
  }, [api, commitBalance]);

  const deal = useCallback(async () => {
    if (busy) return;
    if (bet > balance) {
      setError('Not enough coins for that bet');
      return;
    }
    unlock();
    sounds.tap();

    setBusy(true);
    setError(null);
    setRound(null);
    setHeadline((current) => ({ ...current, tier: 'none' }));
    setDisplayedTotals({ dealer: null, hands: [] });
    commitBalance(balance - bet);

    try {
      const result = await api.placeBet({
        gameId: GAME_ID,
        stake: bet,
        idempotencyKey: `${Date.now()}-bj`,
      });
      setRound(result);

      const state = result.state as BlackjackPublic;
      if (result.status !== 'settled') commitBalance(result.balance);
      presentCards(state, 1_120, result.status === 'settled' ? () => {
        commitBalance(result.balance);
        announce(state, result.settlement?.payout ?? 0, bet, bet);
      } : undefined);
      // Four cards, dealt in sequence.
      [0, 1, 2, 3].forEach((i) => setTimeout(() => sounds.cardDeal(), i * 145));
    } catch (caught) {
      await recoverBalance();
      sounds.error();
      setError(caught instanceof PlayApiError ? caught.message : 'Could not deal. Try again.');
    } finally {
      setBusy(false);
    }
  }, [announce, api, balance, bet, busy, commitBalance, presentCards, recoverBalance]);

  const act = useCallback(
    async (action: string) => {
      if (!round || busy) return;
      unlock();
      sounds.tap();

      setBusy(true);
      setError(null);
      const currentTable = round.state as BlackjackPublic;
      const additionalStake = action === 'double' || action === 'split'
        ? currentTable.hands[currentTable.activeHand]?.stake ?? 0
        : 0;
      if (additionalStake > 0) commitBalance(balance - additionalStake);
      try {
        const result = await api.act({
          roundId: round.roundId,
          action: { type: action },
          idempotencyKey: `${Date.now()}-${action}`,
        });
        setRound(result);

        const state = result.state as BlackjackPublic;
        const actionMovesCards = action === 'hit' || action === 'double' || action === 'split';
        const dealerMovesCards = result.status === 'settled';
        const presentationMs = dealerMovesCards
          ? Math.min(1_080, 690 + Math.max(0, state.dealer.length - 2) * 145)
          : action === 'split' ? 860 : actionMovesCards ? 690 : 0;

        if (dealerMovesCards) {
          // A standing player's total is already known and must stay pinned
          // while the dealer reveals and draws. Only the dealer total waits.
          setDisplayedTotals((current) => ({ ...current, dealer: null }));
        }

        const finishSettlement = result.status === 'settled' ? () => {
          commitBalance(result.balance);
          announce(state, result.settlement?.payout ?? 0, result.settlement?.stake ?? bet, bet);
        } : undefined;

        if (result.status !== 'settled') commitBalance(result.balance);

        if (presentationMs > 0) {
          presentCards(state, presentationMs, finishSettlement);
        } else {
          setDisplayedTotals({
            dealer: handValue(state.dealer),
            hands: state.hands.map((hand) => handValue(hand.cards)),
          });
          finishSettlement?.();
        }

        // The sound belongs to the visible card crossing the felt, not the
        // button press while the server is still deciding the hand.
        if (action === 'split') {
          sounds.cardDeal();
          setTimeout(() => sounds.cardDeal(), 145);
        } else if (action === 'hit' || action === 'double') {
          sounds.cardDeal();
        }

        if (result.status === 'settled') {
          // The hole card turns over as the hand resolves.
          sounds.cardFlip();
        }
      } catch (caught) {
        await recoverBalance();
        sounds.error();
        setError(caught instanceof PlayApiError ? caught.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [announce, api, balance, bet, busy, commitBalance, presentCards, recoverBalance, round],
  );

  const splitTable = (table?.hands.length ?? 0) > 1;
  const visibleHandIndex = table ? Math.min(handView, Math.max(0, table.hands.length - 1)) : 0;
  const visibleHand = table?.hands[visibleHandIndex];

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
        <LinearGradient
          colors={['#087A51', '#075F41', '#043B2C', '#02251D']}
          locations={[0, 0.38, 0.76, 1]}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.82, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tableRail} pointerEvents="none" />
        <LinearGradient
          colors={['rgba(223,161,70,0.08)', 'rgba(89,40,13,0.76)', 'rgba(20,8,3,0.98)']}
          style={styles.tableRailGlow}
          pointerEvents="none"
        />
        <View style={styles.feltEdge} pointerEvents="none" />
        <Animated.View style={[styles.lampPool, { opacity: lamp.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.52] }) }]} pointerEvents="none" />
        <View style={styles.ruleArc} pointerEvents="none">
          <View style={styles.ruleArcLine} />
        </View>
        <View style={styles.dealerHardware} pointerEvents="none">
          <View style={styles.chipRack}>
            {['#C62B39', '#E9E6D7', '#2E66BC', '#248A5B', '#17191F'].map((chip, index) => (
              <View key={chip} style={[styles.rackChip, { backgroundColor: chip, left: 4 + index * 10 }]} />
            ))}
          </View>
          <View style={styles.cardShoe}>
            <LinearGradient colors={['#6A4B1B', '#15110D', '#020407']} style={StyleSheet.absoluteFill} />
            <View style={styles.shoeCard} />
            <View style={[styles.shoeCard, styles.shoeCardTwo]} />
            <View style={styles.shoeMouth} />
          </View>
        </View>
        <View style={styles.tablePlaque} pointerEvents="none">
          <Txt variant="h3" color="#F5D77E">BLACKJACK</Txt>
          <Txt variant="caption" color="rgba(255,232,164,0.76)">PAYS 3 TO 2 · DEALER STANDS ON ALL 17s</Txt>
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
                <PlayingCard key={`d-${i}`} rank={card.rank} suit={card.suit} index={i} dealOrder={i === 0 ? 1 : Math.max(0, i - 1)} trajectory="dealer" size={compactTable ? 'small' : 'normal'} />
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
            {table?.dealerRevealed && displayedTotals.dealer !== null ? (
              <View style={styles.handTotalBadge}>
                <Txt variant="h2" color="#FFF0B1">{displayedTotals.dealer.total}</Txt>
                {displayedTotals.dealer.soft ? <Txt variant="caption" color="#C9A95D">SOFT</Txt> : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/*
          A split is a row of betting positions, not several miniature tables.
          Only one full-size hand is on the felt at a time; the gold position is
          the hand the buttons will act on. Settled hands can be reviewed.
        */}
        {table && splitTable ? (
          <View style={styles.handPositions}>
            {table.hands.map((hand, handIndex) => {
              const value = handValue(hand.cards);
              const displayedTotal = displayedTotals.hands[handIndex];
              const active = !settled && handIndex === table.activeHand;
              const selected = handIndex === visibleHandIndex;
              return (
                <Pressable
                  key={`position-${handIndex}`}
                  disabled={!settled}
                  onPress={() => setHandView(handIndex)}
                  style={[
                    styles.handPosition,
                    selected && styles.handPositionSelected,
                    active && styles.handPositionActive,
                  ]}
                >
                  <Txt variant="caption" color={active ? colors.text.inverse : '#E4CA85'}>
                    HAND {handIndex + 1}
                  </Txt>
                  <Txt variant="bodySmall" color={active ? colors.text.inverse : '#FFF0B1'}>
                    {displayedTotal?.total ?? (cardsSettling && active ? 'DEALING…' : value.total)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {table && visibleHand ? (() => {
          const displayedTotal = displayedTotals.hands[visibleHandIndex];
          const active = !settled && visibleHandIndex === table.activeHand;
          return (
            <View style={[styles.seat, compactTable && styles.seatCompact, active && styles.seatActive]}>
              {active ? (
                <View style={styles.turnBanner}>
                  <Txt variant="caption" color={colors.text.inverse}>
                    HAND {visibleHandIndex + 1} · YOUR TURN — HIT OR STAND
                  </Txt>
                </View>
              ) : null}
              <View style={styles.seatLabel}>
                <Txt variant="caption" color={active ? '#FFE89B' : '#C9A95D'}>
                  {splitTable ? `HAND ${visibleHandIndex + 1}` : 'YOU'} · {format(minor(visibleHand.stake), 'GC')}
                </Txt>
              </View>
              <View style={styles.cards}>
                {visibleHand.cards.map((card, i) => (
                  <PlayingCard
                    key={`h${visibleHandIndex}-${i}`}
                    rank={card.rank}
                    suit={card.suit}
                    index={i}
                    dealOrder={visibleHandIndex === 0 && i === 1 ? 2 : i < 2 && visibleHandIndex > 0 ? i : 0}
                    trajectory="player"
                    size={compactTable ? 'small' : 'normal'}
                  />
                ))}
                {displayedTotal !== null && displayedTotal !== undefined ? (
                  <View style={styles.handTotalBadge}>
                    <Txt variant="h2" color={active ? '#FFF1B5' : '#F7E9BC'}>{displayedTotal.total}</Txt>
                    {displayedTotal.soft ? <Txt variant="caption" color="#C9A95D">SOFT</Txt> : null}
                  </View>
                ) : null}
              </View>
              {visibleHand.outcome && !cardsSettling ? (
                <Txt
                  variant="bodySmall"
                  color={
                    visibleHand.outcome === 'blackjack' || visibleHand.outcome === 'win'
                      ? colors.feedback.winBright
                      : visibleHand.outcome === 'push'
                        ? colors.text.secondary
                        : colors.feedback.loss
                  }
                >
                  {OUTCOME_TEXT[visibleHand.outcome]}
                  {visibleHand.payout ? ` · +${format(minor(visibleHand.payout), 'GC')}` : ''}
                </Txt>
              ) : null}
            </View>
          );
        })() : table ? null : (
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
                disabled={controlsLocked || !affordable}
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
              disabled={controlsLocked}
              style={styles.actionButton}
            />
          ))}
        </View>
      ) : (
        <Button
          label={settled ? `Deal again · ${format(bet, 'GC')}` : `Deal ${format(bet, 'GC')}`}
          onPress={deal}
          loading={busy}
          disabled={controlsLocked || bet > balance}
          style={styles.deal}
        />
      )}
      </View>
      <WinOverlay
        tier={headline.tier}
        amount={headline.amount}
        round={headline.round}
        onDone={() => setHeadline((current) => current.round === headline.round
          ? { ...current, tier: 'none' }
          : current)}
      />
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
  tableRail: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 80,
    borderWidth: 9,
    borderColor: '#341706',
    shadowColor: '#E2A85A',
    shadowOpacity: 0.26,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
  },
  tableRailGlow: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: -2,
    height: 70,
    borderBottomLeftRadius: 76,
    borderBottomRightRadius: 76,
    borderTopWidth: 1,
    borderTopColor: 'rgba(242,194,104,0.46)',
  },
  feltEdge: {
    ...StyleSheet.absoluteFillObject,
    margin: 10,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    borderBottomLeftRadius: 68,
    borderBottomRightRadius: 68,
    borderWidth: 1,
    borderColor: 'rgba(235,198,106,0.46)',
  },
  lampPool: { position: 'absolute', width: 260, height: 150, borderRadius: 130, alignSelf: 'center', top: -54, backgroundColor: '#F8CD63', shadowColor: '#FFE29A', shadowRadius: 40 },
  ruleArc: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    bottom: 28,
    height: 92,
    alignItems: 'center',
    opacity: 0.46,
  },
  ruleArcLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 82,
    borderTopWidth: 1,
    borderColor: 'rgba(242,205,116,0.56)',
    borderRadius: 999,
    transform: [{ scaleY: 0.48 }],
  },
  dealerHardware: { position: 'absolute', top: 10, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chipRack: {
    width: 62,
    height: 23,
    overflow: 'hidden',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#7B622D',
    backgroundColor: 'rgba(3,5,8,0.82)',
  },
  rackChip: {
    position: 'absolute',
    top: 3,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  cardShoe: { width: 66, height: 34, overflow: 'hidden', borderRadius: 6, borderWidth: 1, borderColor: '#D0A84B', transform: [{ perspective: 220 }, { rotateX: '-8deg' }] },
  shoeCard: { position: 'absolute', width: 32, height: 22, right: 8, top: 5, borderRadius: 3, borderWidth: 1, borderColor: '#E7CC86', backgroundColor: '#151E36', transform: [{ rotate: '-8deg' }] },
  shoeCardTwo: { right: 12, top: 3, opacity: 0.7 },
  shoeMouth: { position: 'absolute', left: 4, right: 4, bottom: 3, height: 5, borderRadius: 4, backgroundColor: '#050607', borderTopWidth: 1, borderTopColor: '#E2B758' },
  tablePlaque: {
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: 76,
    paddingVertical: 1,
    gap: 0,
  },
  feltSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '30%' },
  seat: { gap: spacing.sm, minHeight: 96 },
  seatCompact: { gap: 4, minHeight: 72 },
  handPositions: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 2,
  },
  handPosition: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(239,204,117,0.30)',
    backgroundColor: 'rgba(0,22,16,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  handPositionSelected: {
    borderColor: '#F4D273',
    backgroundColor: 'rgba(70,52,13,0.72)',
  },
  handPositionActive: {
    backgroundColor: '#E6BC4E',
    borderColor: '#FFF0AE',
    shadowColor: '#FFD86A',
    shadowOpacity: 0.82,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  seatActive: {
    borderWidth: 2,
    borderColor: '#F5D370',
    borderRadius: 14,
    backgroundColor: 'rgba(8,47,34,0.74)',
    padding: spacing.sm,
    shadowColor: '#FFD76A',
    shadowOpacity: 0.62,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  turnBanner: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#E6BC4E',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    shadowColor: '#FFE17F',
    shadowOpacity: 0.66,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  seatLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Extra right padding compensates for the negative margin that overlaps cards.
  cards: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg, minHeight: 74 },
  handTotalBadge: { minWidth: 54, minHeight: 54, marginLeft: spacing.md, paddingHorizontal: spacing.xs, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9,12,17,0.84)', borderWidth: 2, borderColor: '#C9A95D', shadowColor: '#F7CA62', shadowOpacity: 0.42, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
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
