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
  loading: boolean;
  error: string | null;
}

export function usePlayer() {
  const api = useRef<PlayApi>(createPlayApi()).current;
  const [state, setState] = useState<PlayerState>({
    balance: minor(0),
    dailyStreak: 0,
    vipLevel: 0,
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
  }, [refresh]);

  const claimDaily = useCallback(async () => {
    try {
      const result = await api.claimDailyBonus();
      if (result.granted) {
        setState((current) => ({
          ...current,
          balance: minor(result.balance),
          dailyStreak: result.streakDay,
        }));
      }
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
