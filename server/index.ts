import { resolve } from 'node:path';
import { CodexBridgeServer } from './codex/CodexBridgeServer';
import { loadCodexLocalEnv } from './codex/loadCodexLocalEnv';

const workspaceRoot = process.cwd();
loadCodexLocalEnv(workspaceRoot);
const host = process.env.CODEX_BRIDGE_HOST ?? '127.0.0.1';
const port = Number(process.env.CODEX_BRIDGE_PORT ?? 4186);
const staticRoot = resolve(workspaceRoot, 'dist');
const publicOrigin = process.env.CODEX_PUBLIC_ORIGIN ?? 'https://linker.dialtone.earth';

const bridgeServer = new CodexBridgeServer({
  host,
  port,
  staticRoot,
  workspaceRoot,
  publicOrigin
});

bridgeServer
  .listen()
  .then(() => {
    console.log(`[codex-bridge] Listening on http://${host}:${port}`);
    console.log(`[codex-bridge] Workspace root: ${workspaceRoot}`);
    console.log(`[codex-bridge] Public origin: ${publicOrigin}`);
    console.log('[codex-bridge] WebSocket endpoint: /codex-bridge');
  })
  .catch((error) => {
    console.error('[codex-bridge] Failed to start:', error);
    process.exit(1);
  });

const shutdown = async () => {
  await bridgeServer.close();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
