import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { publishBalance } from '../api/usePlayer';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Button, Card, Txt } from '../components/primitives';
import { SoundToggles } from '../components/SoundToggles';
import { PlayingCard, type Suit } from '../components/PlayingCard';
import { sounds, unlock } from '../sound';
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

export function BlackjackScreen() {
  const api = useRef<PlayApi>(createPlayApi()).current;

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(1_000));
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  /** Sound for however the hand ended, once the dealer is revealed. */
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
        </View>
        <View style={styles.rtpPill}>
          <Txt variant="caption" color={colors.text.secondary}>
            Pays 3:2
          </Txt>
        </View>
        {/* Sound, reachable without leaving the game. See SoundToggles. */}
        <SoundToggles compact />
      </View>

      <Card style={styles.table}>
        {/* Dealer */}
        <View style={styles.seat}>
          <View style={styles.seatLabel}>
            <Txt variant="caption" color={colors.text.muted}>
              DEALER
            </Txt>
            {table?.dealerRevealed && dealerValue ? (
              <Txt variant="bodySmall" color={colors.text.secondary}>
                {dealerValue.total}
                {dealerValue.soft ? ' (soft)' : ''}
              </Txt>
            ) : null}
          </View>
          <View style={styles.cards}>
            {table ? (
              table.dealer.map((card, i) => (
                <PlayingCard key={`d-${i}`} rank={card.rank} suit={card.suit} index={i} />
              ))
            ) : (
              <Txt variant="bodySmall" color={colors.text.muted}>
                —
              </Txt>
            )}
            {/* Before the reveal the hole card is not in `dealer` at all — the
                server never sent it. This is a placeholder, not a hidden value. */}
            {table && !table.dealerRevealed ? (
              <PlayingCard rank="?" suit="S" hidden index={1} />
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Player, one block per hand after a split */}
        {table ? (
          table.hands.map((hand, handIndex) => {
            const value = handValue(hand.cards);
            const active = !settled && handIndex === table.activeHand;
            return (
              <View
                key={`h-${handIndex}`}
                style={[styles.seat, active && styles.seatActive]}
              >
                <View style={styles.seatLabel}>
                  <Txt variant="caption" color={active ? colors.gold.default : colors.text.muted}>
                    {table.hands.length > 1 ? `HAND ${handIndex + 1}` : 'YOU'}
                    {' · '}
                    {format(minor(hand.stake), 'GC')}
                  </Txt>
                  <Txt variant="bodySmall" color={colors.text.secondary}>
                    {value.total}
                    {value.soft ? ' (soft)' : ''}
                  </Txt>
                </View>
                <View style={styles.cards}>
                  {hand.cards.map((card, i) => (
                    <PlayingCard
                      key={`h${handIndex}-${i}`}
                      rank={card.rank}
                      suit={card.suit}
                      index={i}
                      size={table.hands.length > 1 ? 'small' : 'normal'}
                    />
                  ))}
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
          })
        ) : (
          <View style={styles.seat}>
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
      </Card>

      {/* Bet selection is only meaningful between hands. */}
      {!inHand ? (
        <View style={styles.betRow}>
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
        </View>
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
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.base,
    padding: spacing.lg,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  // Green felt, because a blackjack table is green felt.
  table: { backgroundColor: colors.table.felt, borderColor: colors.table.feltLight, gap: spacing.lg },
  seat: { gap: spacing.sm, minHeight: 96 },
  seatActive: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold.default,
    paddingLeft: spacing.md,
    marginLeft: -spacing.md,
  },
  seatLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Extra right padding compensates for the negative margin that overlaps cards.
  cards: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg, minHeight: 74 },
  divider: { height: 1, backgroundColor: colors.table.feltLight },
  betRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    minWidth: 64,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  chipOff: { opacity: 0.35 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  actionButton: { flexGrow: 1, minWidth: 100 },
  deal: { minHeight: 56 },
});
