import { mkdirSync, writeFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { CodexBridgeServer } from '../codex/CodexBridgeServer';
import { loadCodexLocalEnv } from '../codex/loadCodexLocalEnv';
import { startCloudflareTunnel } from './CloudflareTunnel';

const workspaceRoot = process.cwd();
loadCodexLocalEnv(workspaceRoot);
const runtimeDir = resolve(workspaceRoot, '.runtime', 'codex-daemon');
const statusFile = resolve(runtimeDir, 'status.json');
const host = process.env.CODEX_BRIDGE_HOST ?? '127.0.0.1';
const port = Number(process.env.CODEX_BRIDGE_PORT ?? 4186);
const publicOrigin = process.env.CODEX_PUBLIC_ORIGIN ?? 'https://linker.dialtone.earth';
const staticRoot = resolve(workspaceRoot, 'dist');
const localUrl = `http://${host}:${port}`;
const shouldStartTunnel = process.argv.includes('--tunnel') || process.env.CODEX_DAEMON_TUNNEL === '1';

mkdirSync(runtimeDir, { recursive: true });

const bridgeServer = new CodexBridgeServer({
  host,
  port,
  staticRoot,
  workspaceRoot,
  publicOrigin
});

let tunnelCommand = '';
let tunnelState = 'disabled';
let tunnelChild: ChildProcess | null = null;

void start();

async function start() {
  writeStatus('starting');
  await bridgeServer.listen();

  if (shouldStartTunnel) {
    try {
      const tunnel = await startCloudflareTunnel({
        workspaceRoot,
        localUrl,
        stdio: 'inherit'
      });
      tunnelChild = tunnel.child;
      tunnelCommand = tunnel.commandLabel;
      tunnelState = 'running';
      tunnelChild.on('exit', () => {
        tunnelState = 'stopped';
        writeStatus('running');
      });
    } catch (error) {
      tunnelState = `error: ${error instanceof Error ? error.message : 'Unable to start tunnel.'}`;
    }
  }

  writeStatus('running');
}

async function shutdown() {
  writeStatus('stopping');
  tunnelChild?.kill();
  await bridgeServer.close();
  writeStatus('stopped');
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

function writeStatus(state: string) {
  writeFileSync(
    statusFile,
    JSON.stringify(
      {
        state,
        pid: process.pid,
        host,
        port,
        localUrl,
        publicOrigin,
        tunnelState,
        tunnelCommand,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}
