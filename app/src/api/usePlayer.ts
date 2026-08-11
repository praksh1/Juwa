import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { minor, type Minor } from '@juwa/money';
import { PlayApiError, createPlayApi, type PlayApi } from './client';

/**
 * The player's live balance and streak.
 *
 * Every screen that shows a balance reads it from here. Before this existed the
 * lobby rendered a hard-coded 1,250,000 while the game screen showed the real
 * figure from the server — the kind of inconsistency a player notices in about
 * two seconds and never trusts again.
 */
export interface PlayerState {
  balance: Minor;
  dailyStreak: number;
  vipLevel: number;
  /** True once today's free coins are gone, so the button can be disabled. */
  bonusClaimedToday: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * A nudge that the balance changed somewhere else — a purchase confirmed, a
 * bonus claimed on another screen.
 *
 * Every `usePlayer` listens, so one refetch keeps the lobby, the wallet and the
 * store in agreement. Without it a player who buys coins sees the new balance
 * on one screen and the old one on the next, which reads as a bug even though
 * the money is fine.
 */
const balanceListeners = new Set<() => void>();

export function notifyBalanceChanged(): void {
  for (const listener of balanceListeners) listener();
}

/**
 * The exact balance the server just reported, pushed to every screen.
 *
 * ## Why this exists alongside `notifyBalanceChanged`
 *
 * Every game screen keeps its own copy of the balance, updated from the round
 * response, and told nobody. The lobby header sits mounted underneath the
 * pushed game screen the whole time, so it kept whatever figure it had loaded
 * when the player first arrived — and stayed wrong until the page was
 * reloaded. A player who won 40,000 coins went back to the lobby and saw the
 * number they started with, which reads as the win not having counted.
 *
 * The fix is not `notifyBalanceChanged`. That refetches, and a refetch per spin
 * is a network round trip per spin from every mounted listener — for a number
 * the server just handed us in the response we already have. So this carries
 * the VALUE instead: no request, no delay, and every screen shows the same
 * figure at the same moment.
 *
 * It is still only ever the server's number. Nothing here computes a balance;
 * a caller passes on what it was told, which is why this cannot drift from the
 * ledger.
 */
const valueListeners = new Set<(balance: Minor) => void>();

export function publishBalance(balance: Minor): void {
  for (const listener of valueListeners) listener(balance);
}

export function usePlayer() {
  const api = useRef<PlayApi>(createPlayApi()).current;
  const [state, setState] = useState<PlayerState>({
    balance: minor(0),
    dailyStreak: 0,
    vipLevel: 0,
    // Assumed CLAIMED until the server says otherwise. An enabled button that
    // turns out to be dead is worse than a disabled one that lights up a moment
    // later — the first teaches the player the button lies.
    bonusClaimedToday: true,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await api.getBalance();
      setState({
        balance: minor(result.balance),
        dailyStreak: result.dailyStreak,
        vipLevel: result.vipLevel,
        bonusClaimedToday: result.bonusClaimedToday ?? false,
        loading: false,
        error: null,
      });
    } catch (caught) {
      setState((current) => ({
        ...current,
        loading: false,
        error: caught instanceof PlayApiError ? caught.message : 'Could not load your balance',
      }));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    balanceListeners.add(listener);

    // The cheap path: a value the server already gave somebody else.
    const onValue = (balance: Minor) =>
      setState((current) =>
        current.balance === balance ? current : { ...current, balance, loading: false },
      );
    valueListeners.add(onValue);

    return () => {
      balanceListeners.delete(listener);
      valueListeners.delete(onValue);
    };
  }, [refresh]);

  const claimDaily = useCallback(async () => {
    try {
      const result = await api.claimDailyBonus();
      // The flag is set whatever the answer. Granted means it is gone; refused
      // almost always means it was already gone, and in both cases the button
      // must stop being pressable.
      setState((current) => ({
        ...current,
        bonusClaimedToday: true,
        ...(result.granted
          ? { balance: minor(result.balance), dailyStreak: result.streakDay }
          : {}),
      }));
      return result;
    } catch (caught) {
      return {
        granted: false,
        coins: 0,
        streakDay: state.dailyStreak,
        balance: state.balance,
        reason: caught instanceof PlayApiError ? caught.message : 'Could not claim',
      };
    }
  }, [api, state.balance, state.dailyStreak]);

  return useMemo(() => ({ ...state, refresh, claimDaily }), [state, refresh, claimDaily]);
}
