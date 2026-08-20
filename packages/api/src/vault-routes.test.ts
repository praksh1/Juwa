import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError, type AgentsDb, type VaultsDb } from '@juwa/server';
import { vaultRoutes, type VaultCtx } from './vault-routes.js';

const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAYER = '22222222-2222-4222-8222-222222222222';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ctx(body: Record<string, unknown> = {}): VaultCtx {
  return { url: new URL('https://juwa.test'), body, player: { playerId: PLAYER } };
}

function fixtures() {
  const calls: { operation: string; args: unknown[] }[] = [];
  const wallet = { playable: 900, pending: 100, saved: 500, returnPending: 0 };
  const request = {
    id: '33333333-3333-4333-8333-333333333333',
    playerId: PLAYER,
    username: 'player-one',
    agentId: AGENT,
    amount: 100,
    remainingAmount: 100,
    status: 'pending' as const,
    requestedAt: new Date(0).toISOString(),
    decidedAt: null,
    reason: null,
  };
  const vaults = {
    wallet: async (playerId: string) => {
      calls.push({ operation: 'wallet', args: [playerId] });
      return wallet;
    },
    playerRequests: async (playerId: string) => {
      calls.push({ operation: 'playerRequests', args: [playerId] });
      return [request];
    },
    agentRequests: async (agentId: string) => {
      calls.push({ operation: 'agentRequests', args: [agentId] });
      return [request];
    },
    agentPlayers: async (agentId: string) => {
      calls.push({ operation: 'agentPlayers', args: [agentId] });
      return [{
        playerId: PLAYER, username: 'player-one', ...wallet,
        lastSeenAt: new Date(0).toISOString(),
        dormantEligibleAt: new Date(0).toISOString(), dormantEligible: true,
      }];
    },
    agentReturns: async (agentId: string) => {
      calls.push({ operation: 'agentReturns', args: [agentId] });
      return [];
    },
    policy: async () => ({ inactiveDays: 60, warningDays: 30 }),
    request: async (...args: unknown[]) => {
      calls.push({ operation: 'request', args });
      return request.id;
    },
    cancel: async (...args: unknown[]) => {
      calls.push({ operation: 'cancel', args });
    },
    approve: async (...args: unknown[]) => {
      calls.push({ operation: 'approve', args });
    },
    reject: async (...args: unknown[]) => {
      calls.push({ operation: 'reject', args });
    },
    restore: async (...args: unknown[]) => {
      calls.push({ operation: 'restore', args });
      return request.id;
    },
    requestDormantReturn: async (...args: unknown[]) => {
      calls.push({ operation: 'requestDormantReturn', args });
      return request.id;
    },
    cancelDormantReturn: async (...args: unknown[]) => {
      calls.push({ operation: 'cancelDormantReturn', args });
    },
  };
  const agents = {
    agentForPlayer: async (playerId: string) => {
      calls.push({ operation: 'agentForPlayer', args: [playerId] });
      return { agentId: AGENT, displayName: 'Agent One' };
    },
    agentStatus: async (profileId: string) => {
      calls.push({ operation: 'agentStatus', args: [profileId] });
      return {
        agentId: AGENT,
        displayName: 'Agent One',
        status: 'active' as const,
        inventory: 10_000,
        playerCount: 1,
      };
    },
  };
  return {
    calls,
    routes: vaultRoutes(vaults as unknown as VaultsDb, agents as unknown as AgentsDb),
  };
}

describe('Agent Vault routes', () => {
  it('returns the operator-controlled dormant-player policy to the agent UI', async () => {
    const { routes } = fixtures();
    const result = await routes['GET /agent/vault']!(ctx()) as Record<string, unknown>;
    assert.deepEqual(result['policy'], { inactiveDays: 60, warningDays: 30 });
  });

  it('always scopes a save request to the signed-in player', async () => {
    const { calls, routes } = fixtures();
    await routes['POST /wallet/vault/save']!(
      ctx({ amount: 100, playerId: OTHER_PLAYER, idempotencyKey: 'save-once' }),
    );
    const save = calls.find((call) => call.operation === 'request');
    assert.deepEqual(save?.args, [PLAYER, 100, 'save-once']);
  });

  it('uses the authenticated agent identity when approving a request', async () => {
    const { calls, routes } = fixtures();
    await routes['POST /agent/vault/approve']!(
      ctx({ requestId: '33333333-3333-4333-8333-333333333333', agentId: 'attacker' }),
    );
    const approval = calls.find((call) => call.operation === 'approve');
    assert.deepEqual(approval?.args, ['33333333-3333-4333-8333-333333333333', AGENT]);
  });

  it('restores only through the authenticated agent while keeping player attribution', async () => {
    const { calls, routes } = fixtures();
    await routes['POST /agent/vault/restore']!(
      ctx({ playerId: OTHER_PLAYER, amount: 250, idempotencyKey: 'restore-once' }),
    );
    const restore = calls.find((call) => call.operation === 'restore');
    assert.deepEqual(restore?.args, [AGENT, OTHER_PLAYER, 250, 'restore-once']);
  });

  it('starts a dormant return only through the authenticated agent', async () => {
    const { calls, routes } = fixtures();
    await routes['POST /agent/vault/dormant-return']!(ctx({
      playerId: OTHER_PLAYER,
      agentId: 'attacker',
      amount: 250,
      idempotencyKey: 'dormant-return-once',
    }));
    const warning = calls.find((call) => call.operation === 'requestDormantReturn');
    assert.deepEqual(warning?.args, [AGENT, OTHER_PLAYER, 250, 'dormant-return-once']);
  });

  it('rejects invalid amounts before calling the database', async () => {
    const { calls, routes } = fixtures();
    await assert.rejects(
      routes['POST /wallet/vault/save']!(ctx({ amount: -1 })),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_amount',
    );
    assert.equal(calls.some((call) => call.operation === 'request'), false);
  });

  it('blocks suspended agents before they can change custody', async () => {
    const { calls, routes } = fixtures();
    const suspendedAgents = {
      agentForPlayer: async () => null,
      agentStatus: async () => ({
        agentId: AGENT,
        displayName: 'Agent One',
        status: 'suspended' as const,
        inventory: 0,
        playerCount: 1,
      }),
    };
    const suspendedRoutes = vaultRoutes(
      {
        approve: async (...args: unknown[]) => calls.push({ operation: 'approve', args }),
      } as unknown as VaultsDb,
      suspendedAgents as unknown as AgentsDb,
    );
    await assert.rejects(
      suspendedRoutes['POST /agent/vault/approve']!(
        ctx({ requestId: '33333333-3333-4333-8333-333333333333' }),
      ),
      (error: unknown) => error instanceof ApiError && error.code === 'agent_inactive',
    );
    assert.equal(calls.some((call) => call.operation === 'approve'), false);
  });
});
