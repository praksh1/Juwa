import { randomUUID } from 'node:crypto';
import { ApiError, type AgentsDb, type VaultsDb } from '@juwa/server';

export interface VaultCtx {
  url: URL;
  body: Record<string, unknown>;
  player: { playerId: string };
}

const MAX_VAULT_AMOUNT = 1_000_000_000;

function wholeAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ApiError('Enter a whole number of GC greater than zero.', 400, 'invalid_amount');
  }
  if (amount > MAX_VAULT_AMOUNT) {
    throw new ApiError('That amount is too large for one request.', 400, 'amount_too_large');
  }
  return amount;
}

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new ApiError(`${name} is required.`, 400, 'invalid_input');
  }
  return value.trim();
}

function idempotencyKey(value: unknown): string {
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new ApiError('idempotencyKey is invalid.', 400, 'invalid_input');
  }
  return value.trim();
}

function vaultError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/Insufficient (funds|saved funds)/i.test(message)) {
    return new ApiError('There are not enough GC in that balance.', 402, 'insufficient_funds');
  }
  if (/already have|agent_vault_one_pending|duplicate key/i.test(message)) {
    return new ApiError(
      'You already have a save request waiting for your agent. Cancel it or wait for a decision.',
      409,
      'request_already_open',
    );
  }
  if (/does not have an agent/i.test(message)) {
    return new ApiError('Your account is not linked to an agent.', 403, 'no_agent');
  }
  if (/not active/i.test(message)) {
    return new ApiError('Your agent cannot manage saved GC at the moment.', 403, 'agent_inactive');
  }
  if (/not yours|not pending|does not belong|no longer belongs/i.test(message)) {
    return new ApiError('That request is no longer available to you.', 409, 'not_pending');
  }
  return new ApiError('The Agent Vault could not be updated. Please try again.', 500, 'vault_failed');
}

export function vaultRoutes(
  vaults: VaultsDb,
  agents: AgentsDb,
): Record<string, (ctx: VaultCtx) => Promise<unknown>> {
  async function activeAgent(ctx: VaultCtx) {
    const agent = await agents.agentStatus(ctx.player.playerId);
    if (!agent) throw new ApiError('Not found', 404, 'not_found');
    if (agent.status !== 'active') {
      throw new ApiError('Your agent account is not active.', 403, 'agent_inactive');
    }
    return agent;
  }

  async function playerWallet(playerId: string) {
    const agent = await agents.agentForPlayer(playerId);
    const [wallet, requests] = await Promise.all([
      vaults.wallet(playerId),
      vaults.playerRequests(playerId),
    ]);
    return {
      wallet,
      agent: agent ? { agentId: agent.agentId, displayName: agent.displayName } : null,
      requests,
    };
  }

  return {
    'GET /wallet': (ctx) => playerWallet(ctx.player.playerId),

    'POST /wallet/vault/save': async (ctx) => {
      try {
        await vaults.request(
          ctx.player.playerId,
          wholeAmount(ctx.body['amount']),
          idempotencyKey(ctx.body['idempotencyKey']),
        );
        return playerWallet(ctx.player.playerId);
      } catch (error) {
        throw vaultError(error);
      }
    },

    'POST /wallet/vault/cancel': async (ctx) => {
      try {
        await vaults.cancel(id(ctx.body['requestId'], 'requestId'), ctx.player.playerId);
        return playerWallet(ctx.player.playerId);
      } catch (error) {
        throw vaultError(error);
      }
    },

    'GET /agent/vault': async (ctx) => {
      const agent = await activeAgent(ctx);
      const [requests, players] = await Promise.all([
        vaults.agentRequests(agent.agentId),
        vaults.agentPlayers(agent.agentId),
      ]);
      return { requests, players };
    },

    'POST /agent/vault/approve': async (ctx) => {
      const agent = await activeAgent(ctx);
      try {
        await vaults.approve(id(ctx.body['requestId'], 'requestId'), agent.agentId);
        return { ok: true };
      } catch (error) {
        throw vaultError(error);
      }
    },

    'POST /agent/vault/reject': async (ctx) => {
      const agent = await activeAgent(ctx);
      try {
        await vaults.reject(
          id(ctx.body['requestId'], 'requestId'),
          agent.agentId,
          typeof ctx.body['reason'] === 'string' ? ctx.body['reason'].slice(0, 300) : undefined,
        );
        return { ok: true };
      } catch (error) {
        throw vaultError(error);
      }
    },

    'POST /agent/vault/restore': async (ctx) => {
      const agent = await activeAgent(ctx);
      const playerId = id(ctx.body['playerId'], 'playerId');
      try {
        await vaults.restore(
          agent.agentId,
          playerId,
          wholeAmount(ctx.body['amount']),
          idempotencyKey(ctx.body['idempotencyKey']),
        );
        return { ok: true, player: await vaults.wallet(playerId) };
      } catch (error) {
        throw vaultError(error);
      }
    },
  };
}
