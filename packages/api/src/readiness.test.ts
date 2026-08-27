import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { PostgresDb } from '@juwa/server';
import { createServer, type ServerConfig } from './server.js';

async function readinessResponse(
  query: () => Promise<{ rows: Record<string, unknown>[] }>,
): Promise<Response> {
  const db = new PostgresDb({ query: async () => ({ rows: [] }) } as never);
  const created = createServer({
    db,
    query: query as ServerConfig['query'],
    jwtSecret: 'readiness-test-secret',
    allowedOrigins: ['https://juwa.example'],
  });

  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const port = (created.server.address() as AddressInfo).port;

  try {
    return await fetch(`http://127.0.0.1:${port}/health/ready`);
  } finally {
    created.close();
    created.server.close();
  }
}

describe('database readiness', () => {
  it('returns 200 when the database answers', async () => {
    const response = await readinessResponse(async () => ({ rows: [{ '?column?': 1 }] }));
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
    assert.equal(body['database'], 'reachable');
    assert.equal(typeof body['responseTimeMs'], 'number');
  });

  it('returns a private 503 when the database fails', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await readinessResponse(async () => {
        throw new Error('postgres://secret-host/private-database failed');
      });
      assert.equal(response.status, 503);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body['ok'], false);
      assert.equal(body['database'], 'unavailable');
      assert.equal(typeof body['responseTimeMs'], 'number');
      assert.equal(JSON.stringify(body).includes('secret-host'), false);
    } finally {
      console.error = originalError;
    }
  });
});
