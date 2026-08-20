/**
 * Is this account an agent, and what have they got.
 *
 * Two hooks, split on purpose:
 *
 *   `useAgentRole`  — one cheap question, asked once when the app starts, that
 *                     decides whether the agent tab exists at all.
 *   `useAgentDesk`  — everything the dashboard needs, loaded only after the
 *                     player has actually opened it.
 *
 * Nothing here is a security boundary. The tab is hidden from players because
 * showing them a distribution screen they cannot use would be confusing, not
 * because hiding it stops anybody: every `/agent/*` route resolves the caller's
 * agent record from the verified token before it does anything, so a player who
 * edits this in their own browser gets a dashboard where every request comes
 * back 404.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlayApiError,
  createPlayApi,
  type AgentInvite,
  type AgentPlayer,
  type AgentSummary,
  type AgentVaultData,
  type AgentTxn,
  type PlayApi,
} from './client';
import { notifyBalanceChanged } from './usePlayer';

export interface AgentRole {
  agent: AgentSummary | null;
  /** The agent this account BELONGS to, if any. Players have this; agents may not. */
  agentName: string | null;
  loading: boolean;
}

export function useAgentRole(): AgentRole {
  const api = useRef<PlayApi>(createPlayApi()).current;
  const [role, setRole] = useState<AgentRole>({ agent: null, agentName: null, loading: true });

  useEffect(() => {
    let alive = true;
    api
      .getProfile()
      .then((profile) => {
        if (!alive) return;
        setRole({
          agent: profile.agent ?? null,
          agentName: profile.agentName ?? null,
          loading: false,
        });
      })
      // A failure here means no agent tab, which is the safe wrong answer: it
      // can only ever hide something from somebody who has it, never show
      // something to somebody who does not.
      .catch(() => alive && setRole({ agent: null, agentName: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [api]);

  return role;
}

export interface AgentDesk {
  summary: AgentSummary | null;
  players: AgentPlayer[];
  transactions: AgentTxn[];
  invites: AgentInvite[];
  /** Player-attributed saved GC. Never part of distributable inventory. */
  vault: AgentVaultData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  allocate: (playerId: string, amount: number) => Promise<{ ok: boolean; message?: string }>;
  createInvite: (label?: string) => Promise<{ ok: boolean; token?: string; message?: string }>;
  createPlayer: (details: {
    username: string;
    password: string;
    dateOfBirth: string;
    region: string;
  }) => Promise<{ ok: boolean; signInWith?: string; message?: string }>;
  resetPassword: (
    playerId: string,
    password: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** Confirm or return a player's save-for-later request. */
  decideVault: (
    requestId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** Move saved GC back to that same player's playable balance. */
  restoreVault: (playerId: string, amount: number) => Promise<{ ok: boolean; message?: string }>;
  /** Begin the operator-reviewed return of an inactive player's saved GC. */
  requestDormantReturn: (
    playerId: string,
    amount: number,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** Stop a return during its warning period and put the GC back in the player's vault. */
  cancelDormantReturn: (requestId: string) => Promise<{ ok: boolean; message?: string }>;
}

export function useAgentDesk(): AgentDesk {
  const api = useRef<PlayApi>(createPlayApi()).current;
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [players, setPlayers] = useState<AgentPlayer[]>([]);
  const [transactions, setTransactions] = useState<AgentTxn[]>([]);
  const [invites, setInvites] = useState<AgentInvite[]>([]);
  const [vault, setVault] = useState<AgentVaultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      /*
       * In parallel, and the vault read is allSettled rather than part of
       * the `all`.
       *
       * Four of these five are what the desk IS. The fifth is a queue that may
       * be empty, may 404 on an older server, and must never be the reason an
       * agent cannot see their inventory or fund a player who is standing in
       * front of them. A rejection here leaves `vault` null and the panel
       * simply absent.
       */
      const [next, playerList, txns, inviteList, queue] = await Promise.all([
        api.getAgentSummary(),
        api.getAgentPlayers(),
        api.getAgentTransactions(),
        api.getAgentInvites(),
        api.getAgentVault().then(
          (value) => value,
          () => null,
        ),
      ]);
      setSummary(next);
      setPlayers(playerList.players);
      setTransactions(txns.transactions);
      setInvites(inviteList.invites);
      setVault(queue);
      setError(null);
    } catch (caught) {
      setError(caught instanceof PlayApiError ? caught.message : 'Could not load your agent desk');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Move coins to a player.
   *
   * The idempotency key is generated HERE, once per attempt, and reused if the
   * request has to be retried — that is the whole protection against a phone
   * losing signal after the server has already moved the coins. A key generated
   * inside the retry would be no protection at all.
   *
   * The optimistic update is deliberately absent. Everywhere else in this app a
   * balance can flicker and correct itself harmlessly; here the number IS the
   * transaction, and an inventory that briefly shows coins it does not have is
   * how an agent over-commits to a player standing in front of them.
   */
  const allocate = useCallback(
    async (playerId: string, amount: number) => {
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const result = await api.allocateToPlayer({ playerId, amount, idempotencyKey });
        setSummary((current) => (current ? { ...current, inventory: result.inventory } : current));
        setPlayers((current) =>
          current.map((player) =>
            player.playerId === playerId ? { ...player, balance: result.playerBalance } : player,
          ),
        );
        // An agent funding themselves is a normal case — they are a player too.
        notifyBalanceChanged();
        // Refresh in the background so the ledger list picks up the new row
        // without the caller waiting for it.
        void refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message: caught instanceof PlayApiError ? caught.message : 'Could not send those coins',
        };
      }
    },
    [api, refresh],
  );

  /**
   * Approve or reject one request.
   *
   * No optimistic update, for the same reason `allocate` has none: the numbers
   * on this screen ARE the transaction, and an inventory that briefly shows
   * coins it does not have is how an agent over-commits to somebody in the
   * room. The refresh that follows is awaited, so the queue the agent looks at
   * next is the queue the server has.
   */
  const decideVault = useCallback(
    async (requestId: string, decision: 'approve' | 'reject', reason?: string) => {
      try {
        if (decision === 'approve') await api.approveVaultSave(requestId);
        else await api.rejectVaultSave(requestId, reason);
        notifyBalanceChanged();
        await refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message:
            caught instanceof PlayApiError ? caught.message : 'Could not update that request',
        };
      }
    },
    [api, refresh],
  );

  const restoreVault = useCallback(
    async (playerId: string, amount: number) => {
      const idempotencyKey = `vault-restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        await api.restoreVaultCoins({ playerId, amount, idempotencyKey });
        notifyBalanceChanged();
        await refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message: caught instanceof PlayApiError ? caught.message : 'Could not restore those GC',
        };
      }
    },
    [api, refresh],
  );

  const requestDormantReturn = useCallback(
    async (playerId: string, amount: number) => {
      const idempotencyKey = `vault-return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        await api.requestDormantVaultReturn({ playerId, amount, idempotencyKey });
        await refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message:
            caught instanceof PlayApiError
              ? caught.message
              : 'Could not start the return warning period',
        };
      }
    },
    [api, refresh],
  );

  const cancelDormantReturn = useCallback(
    async (requestId: string) => {
      try {
        await api.cancelDormantVaultReturn(requestId);
        await refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message:
            caught instanceof PlayApiError ? caught.message : 'Could not cancel that return',
        };
      }
    },
    [api, refresh],
  );

  const createInvite = useCallback(
    async (label?: string) => {
      try {
        const result = await api.createAgentInvite(label);
        void refresh();
        return { ok: true, token: result.token };
      } catch (caught) {
        return {
          ok: false,
          message: caught instanceof PlayApiError ? caught.message : 'Could not create an invite',
        };
      }
    },
    [api, refresh],
  );

  /**
   * Create an account for a player standing in front of the agent.
   *
   * The agent types a username and a first password and reads both back to the
   * player. The account comes back flagged so the app makes the player replace
   * that password before it will let them do anything else — which is what
   * stops the agent's copy from working for the life of the account.
   */
  const createPlayer = useCallback(
    async (details: { username: string; password: string; dateOfBirth: string; region: string }) => {
      try {
        const result = await api.createAgentPlayer({ ...details, country: 'US' });
        void refresh();
        return { ok: true, signInWith: result.signInWith };
      } catch (caught) {
        return {
          ok: false,
          message:
            caught instanceof PlayApiError ? caught.message : 'Could not create that account',
        };
      }
    },
    [api, refresh],
  );

  /**
   * A player has forgotten their password.
   *
   * There is no "email me a link" for these accounts and there never will be —
   * they sign in at a domain that cannot receive mail, deliberately. So the
   * agent sets a new temporary one in person, exactly as they did when the
   * account was created, and the same flag makes the player replace it at the
   * next sign-in.
   *
   * `refresh` is called so the player row shows the pending-password state; it
   * is the only visible sign an agent has that the reset landed.
   */
  const resetPassword = useCallback(
    async (playerId: string, password: string) => {
      try {
        await api.resetPlayerPassword({ playerId, password });
        void refresh();
        return { ok: true };
      } catch (caught) {
        return {
          ok: false,
          message:
            caught instanceof PlayApiError ? caught.message : 'Could not reset that password',
        };
      }
    },
    [api, refresh],
  );

  return useMemo(
    () => ({
      summary,
      players,
      transactions,
      invites,
      vault,
      loading,
      error,
      refresh,
      allocate,
      createInvite,
      createPlayer,
      resetPassword,
      decideVault,
      restoreVault,
      requestDormantReturn,
      cancelDormantReturn,
    }),
    [
      summary,
      players,
      transactions,
      invites,
      vault,
      loading,
      error,
      refresh,
      allocate,
      createInvite,
      createPlayer,
      resetPassword,
      decideVault,
      restoreVault,
      requestDormantReturn,
      cancelDormantReturn,
    ],
  );
}
