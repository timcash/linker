import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';

import {CodexBridgeServer} from '../server/codex/CodexBridgeServer';
import type {
  CodexAuthLoginResponse,
  CodexBridgeHealth,
  CodexBridgePublicConfig,
} from '../shared/codex/CodexBridgeTypes';

const TEST_HOST = '127.0.0.1';
const TEST_PORT = 4191;
const TEST_PASSWORD = 'test-local-password';
const TEST_PUBLIC_ORIGIN = 'https://linker.dialtone.earth';
type CodexErrorResponse = {
  error: string;
  ok: false;
};

async function main(): Promise<void> {
  process.env.CODEX_BRIDGE_PASSWORD = TEST_PASSWORD;
  process.env.CODEX_BRIDGE_PORT = String(TEST_PORT);
  process.env.CODEX_PUBLIC_ORIGIN = TEST_PUBLIC_ORIGIN;

  const server = new CodexBridgeServer({
    host: TEST_HOST,
    port: TEST_PORT,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    staticRoot: resolve(process.cwd(), 'dist'),
    workspaceRoot: process.cwd(),
  });

  await server.listen();

  try {
    const publicConfigResponse =
      await fetchJson<CodexBridgePublicConfig>('/api/codex/public-config');
    assert.equal(publicConfigResponse.status, 200, 'The Codex bridge should expose its public config.');
    const publicConfigBody = expectBody(
      publicConfigResponse.body,
      'The public config should include a JSON body.',
    );
    assert.equal(publicConfigBody.ok, true, 'The public config should report ok.');
    assert.equal(publicConfigBody.authRequired, true, 'The bridge should require unlock auth.');
    assert.equal(publicConfigBody.publicOrigin, TEST_PUBLIC_ORIGIN, 'The public config should expose the tunnel origin.');

    const unauthorizedHealth =
      await fetchJson<CodexBridgeHealth | CodexErrorResponse>('/api/codex/health');
    assert.equal(unauthorizedHealth.status, 401, 'The health route should reject unauthenticated requests.');

    const wrongPassword = await fetchJson<CodexAuthLoginResponse | CodexErrorResponse>(
      '/api/codex/auth/login',
      {
      body: JSON.stringify({password: 'wrong-password'}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      },
    );
    assert.equal(wrongPassword.status, 401, 'The bridge should reject the wrong password.');

    const loginResponse = await fetchJson<CodexAuthLoginResponse>('/api/codex/auth/login', {
      body: JSON.stringify({password: TEST_PASSWORD}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
    });
    assert.equal(loginResponse.status, 200, 'The bridge should accept the configured password.');
    const loginBody = expectBody(loginResponse.body, 'The login response should include a JSON body.');
    assert.equal(loginBody.ok, true, 'The login response should report success.');
    assert.ok(typeof loginBody.authToken === 'string' && loginBody.authToken.length > 0, 'The login response should return an auth token.');

    const authorizedHealth = await fetchJson<CodexBridgeHealth>('/api/codex/health', {
      headers: {Authorization: `Bearer ${loginBody.authToken}`},
    });
    assert.equal(authorizedHealth.status, 200, 'The health route should accept the short-lived unlock token.');
    const authorizedHealthBody = expectBody(
      authorizedHealth.body,
      'The authorized health response should include a JSON body.',
    );
    assert.equal(authorizedHealthBody.publicOrigin, TEST_PUBLIC_ORIGIN, 'The authorized health response should keep the public origin.');
    assert.equal(authorizedHealthBody.sessionTtlSeconds > 0, true, 'The authorized health response should expose a positive TTL.');

    const logoutResponse = await fetchJson<{ok: true}>('/api/codex/auth/logout', {
      headers: {Authorization: `Bearer ${loginBody.authToken}`},
      method: 'POST',
    });
    assert.equal(logoutResponse.status, 200, 'The logout route should revoke the unlock token.');

    await delay(50);

    const revokedHealth = await fetchJson<CodexBridgeHealth | CodexErrorResponse>(
      '/api/codex/health',
      {
      headers: {Authorization: `Bearer ${loginBody.authToken}`},
      },
    );
    assert.equal(revokedHealth.status, 401, 'The revoked token should stop working after logout.');
  } finally {
    await server.close();
  }

  console.log('Codex bridge tests passed.');
}

void main();

async function fetchJson<T>(pathname: string, init?: RequestInit): Promise<{
  body: T | null;
  status: number;
}> {
  const response = await fetch(`http://${TEST_HOST}:${TEST_PORT}${pathname}`, init);
  const text = await response.text();
  const body = text.length > 0 ? parseJson<T>(text) : null;

  return {
    body,
    status: response.status,
  };
}

function parseJson<T>(text: string): T {
  const parsed: unknown = JSON.parse(text);
  return parsed as T;
}

function expectBody<T>(body: T | null, message: string): T {
  assert.notEqual(body, null, message);
  return body as T;
}
