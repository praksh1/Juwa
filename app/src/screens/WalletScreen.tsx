import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { usePlayer } from '../api/usePlayer';
import { createPlayApi, type HistoryEntry, type WalletResponse } from '../api/client';
import { ConversionPanel, ConversionPanelSkeleton } from '../components/ConversionPanel';
import { LOBBY_BED, useAmbientBed } from '../ambience';

/**
 * Wallet.
 *
 * ## Two balances, and what the second one is not
 *
 * Gold Coins are what the games are played with. Casino Cash is a conversion
 * balance held between a player and their agent: it buys GC, and it buys
 * nothing else. There is still no path from either to money — no withdrawal, no
 * cash-out, no player-to-player transfer — which is what the footer says and
 * what the absence of any such control means.
 *
 * This file used to open by explaining that there was no "Redeem" button at
 * all. There is one now, and it does not redeem for money: it asks an agent to
 * exchange GC for CC at a published rate, and it moves nothing until they
 * agree. The distinction is the whole product, so the panel states it in every
 * state it can be in.
 *
 * The activity list is the player-facing view of the double-entry ledger. Each
 * row is one side of a balanced transaction, so a support question — "where did
 * my 500 coins go?" — always has an answer that reconciles, rather than a
 * number someone has to take on trust.
 *
 * A bet and its payout appear as two rows, not one net figure. That is what the
 * player experienced, and it keeps gross wagered separate from net win, which
 * the business needs as separate numbers.
 */

const LABELS: Record<HistoryEntry['type'], string> = {
  deposit: 'Coin purchase',
  bonus: 'Bonus',
  bet: 'Bet',
  payout: 'Win',
  refund: 'Refund',
  adjustment: 'Adjustment',
  withdrawal: 'Withdrawal',
};

const GAME_NAMES: Record<string, string> = {
  'juwa-classic-slots': 'Juwa Classic',
  'juwa-blackjack': 'Blackjack',
  'juwa-roulette-eu': 'European Roulette',
};

function describe(entry: HistoryEntry): string {
  const game = entry.meta['game_id'] as string | undefined;
  const kind = entry.meta['kind'] as string | undefined;
  const base = LABELS[entry.type] ?? entry.type;

  if (game) return `${GAME_NAMES[game] ?? game} — ${base.toLowerCase()}`;
  if (kind === 'welcome') return 'Welcome bonus';
  if (kind === 'daily') return 'Daily bonus';
  if (kind === 'top_up') return 'Top-up';
  if (entry.type === 'deposit') {
    const pack = entry.meta['pack_id'] as string | undefined;
    return pack ? `Coin purchase — ${pack.replace('pack_', '')}` : base;
  }
  return base;
}

/** Relative time reads faster than a date for anything recent. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172_800) return 'Yesterday';
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function WalletScreen() {
  const { balance } = usePlayer();
  useAmbientBed(LOBBY_BED);
  const api = React.useRef(createPlayApi()).current;

  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [converting, setConverting] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The two balances and the conversion queue.
   *
   * Refetched whenever the GC balance changes, alongside the activity list, so
   * a spin or an approval shows up without a pull to refresh. A failure is
   * SWALLOWED rather than shown: the CC panel is additive, and a player whose
   * agent's rate lookup hiccuped should still see their coins and their
   * history.
   */
  const loadWallet = useCallback(async () => {
    try {
      setWallet(await api.getWallet());
    } catch {
      /* leave whatever was there; the panel is not the point of this screen */
    }
  }, [api]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet, balance]);

  const requestConversion = useCallback(
    async (direction: 'gc_to_cc' | 'cc_to_gc', amount: number) => {
      setConverting(true);
      try {
        await api.requestConversion({ direction, amount });
        await loadWallet();
      } finally {
        setConverting(false);
      }
    },
    [api, loadWallet],
  );

  const cancelConversion = useCallback(
    async (requestId: string) => {
      setConverting(true);
      try {
        await api.cancelConversion(requestId);
        await loadWallet();
      } finally {
        setConverting(false);
      }
    },
    [api, loadWallet],
  );

  useEffect(() => {
    let alive = true;
    api
      .getHistory()
      .then((page) => {
        if (!alive) return;
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
      })
      .catch(() => alive && setError('Could not load your activity'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // Refetches when the balance changes, so a spin or a purchase shows up
    // here without the player having to pull to refresh.
  }, [api, balance]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.getHistory(nextBefore);
      setEntries((current) => [...current, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch {
      setError('Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }, [api, nextBefore, loadingMore]);

  return (
    <Screen>
      <Card style={styles.balanceCard}>
        <Txt variant="caption" color={colors.text.muted}>
          GOLD COIN BALANCE
        </Txt>
        <Txt variant="moneyLarge" color={colors.gold.default}>
          {format(balance, 'GC')}
        </Txt>
        <View style={styles.actions}>
          <Button label="Get Coins" onPress={() => {}} style={styles.action} />
          <Button label="Free Coins" variant="secondary" onPress={() => {}} style={styles.action} />
        </View>
        <Txt variant="caption" color={colors.text.muted} style={styles.noCashValue}>
          Gold Coins have no cash value and cannot be withdrawn.
        </Txt>
      </Card>

      {/*
        Casino Cash, under the GC card and above the history.

        Under, because GC is the balance a player checks before they play and
        this must not push it off the top of the screen. Above the history,
        because a pending request is a thing they are waiting on and belongs
        with the balances rather than at the end of a list of past events.
      */}
      {wallet ? (
        <ConversionPanel
          data={wallet}
          busy={converting}
          onRequest={requestConversion}
          onCancel={cancelConversion}
        />
      ) : (
        <ConversionPanelSkeleton />
      )}

      <View>
        <SectionHeader title="Activity" />
        <Card style={styles.history}>
          {loading ? (
            <View style={styles.centre}>
              <ActivityIndicator color={colors.gold.default} />
            </View>
          ) : error ? (
            <View style={styles.centre}>
              <Txt variant="bodySmall" color={colors.feedback.error}>
                {error}
              </Txt>
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.centre}>
              <Txt variant="bodySmall" color={colors.text.muted}>
                Nothing here yet. Play a game and it will show up.
              </Txt>
            </View>
          ) : (
            entries.map((entry, i) => (
              <View key={entry.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={styles.rowLeft}>
                  <Txt variant="bodySmall">{describe(entry)}</Txt>
                  <Txt variant="caption" color={colors.text.muted}>
                    {ago(entry.at)}
                  </Txt>
                </View>
                <Txt
                  variant="money"
                  color={entry.amount >= 0 ? colors.feedback.win : colors.text.secondary}
                >
                  {entry.amount >= 0 ? '+' : ''}
                  {format(minor(entry.amount), 'GC')}
                </Txt>
              </View>
            ))
          )}

          {nextBefore ? (
            <Pressable
              onPress={loadMore}
              accessibilityRole="button"
              style={[styles.row, styles.rowDivider, styles.more]}
            >
              {loadingMore ? (
                <ActivityIndicator color={colors.gold.default} />
              ) : (
                <Txt variant="bodySmall" color={colors.gold.default}>
                  Show more
                </Txt>
              )}
            </Pressable>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  action: { flex: 1 },
  history: { padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.surface.border },
  rowLeft: { gap: 2, flex: 1 },
  noCashValue: { marginTop: spacing.md, textAlign: 'center' },
  centre: { padding: spacing.xl, alignItems: 'center' },
  more: { justifyContent: 'center' },
});
