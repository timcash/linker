import assert from 'node:assert/strict';
import {resolve} from 'node:path';

import {CodexBridgeServer} from '../server/codex/CodexBridgeServer';
import type {
  CodexBridgeHealth,
  CodexBridgePublicConfig,
} from '../shared/codex/CodexBridgeTypes';
import {DEFAULT_REMOTE_AUTH_ORIGIN} from '../src/remote-config';

const TEST_HOST = '127.0.0.1';
const TEST_PORT = 4191;
const TEST_PUBLIC_ORIGIN = DEFAULT_REMOTE_AUTH_ORIGIN;
type CodexErrorResponse = {
  error: string;
  ok: false;
};

async function main(): Promise<void> {
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
    assert.equal(publicConfigBody.authRequired, true, 'The public config should describe the Cloudflare Access requirement.');
    assert.equal(publicConfigBody.publicOrigin, TEST_PUBLIC_ORIGIN, 'The public config should expose the tunnel origin.');

    const healthResponse =
      await fetchJson<CodexBridgeHealth | CodexErrorResponse>('/api/codex/health');
    assert.equal(healthResponse.status, 200, 'The health route should be reachable without a second password token.');
    const healthBody = expectBody(
      healthResponse.body,
      'The health response should include a JSON body.',
    );
    assert.equal(healthBody.ok, true, 'The health response should report success.');
    assert.equal(healthBody.publicOrigin, TEST_PUBLIC_ORIGIN, 'The health response should keep the public origin.');

    const notFoundResponse = await fetchJson<CodexErrorResponse>('/api/codex/auth/login', {
      method: 'POST',
    });
    assert.equal(notFoundResponse.status, 404, 'The legacy password login route should no longer be part of the codex bridge workflow.');
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
