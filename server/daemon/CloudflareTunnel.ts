import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { arch, homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const TUNNEL_ENV_KEYS = [
  'CODEX_TUNNEL_TOKEN',
  'CF_TUNNEL_TOKEN_CODEX',
  'CF_TUNNEL_TOKEN'
];

export async function ensureCloudflaredBinary(workspaceRoot: string) {
  const resolved = resolveConfiguredCloudflared(workspaceRoot);
  if (resolved) {
    return resolved;
  }

  const downloadSpec = resolveDownloadSpec();
  const targetPath = resolve(workspaceRoot, '.runtime', 'cloudflare', downloadSpec.fileName);
  if (existsSync(targetPath)) {
    return targetPath;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await downloadCloudflared(downloadSpec.url, targetPath);

  if (platform() !== 'win32') {
    chmodSync(targetPath, 0o755);
  }

  return targetPath;
}

export function resolveTunnelToken() {
  for (const envKey of TUNNEL_ENV_KEYS) {
    const value = process.env[envKey];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

export function buildTunnelRunArgs(localUrl: string) {
  const token = resolveTunnelToken();
  const tunnelName = process.env.CODEX_TUNNEL_NAME?.trim() || 'codex';

  if (token) {
    return ['tunnel', 'run', '--token', token, '--url', localUrl];
  }

  return ['tunnel', 'run', '--url', localUrl, tunnelName];
}

export async function startCloudflareTunnel(options: {
  workspaceRoot: string;
  localUrl: string;
  stdio: 'inherit' | ['ignore', number, number];
}): Promise<{ child: ChildProcess; commandLabel: string }> {
  const executablePath = await ensureCloudflaredBinary(options.workspaceRoot);
  const args = buildTunnelRunArgs(options.localUrl);
  const child = spawn(executablePath, args, {
    cwd: options.workspaceRoot,
    stdio: options.stdio,
    windowsHide: true
  });

  return {
    child,
    commandLabel: [executablePath, ...args].join(' ')
  };
}

function resolveConfiguredCloudflared(workspaceRoot: string) {
  const candidates = [
    process.env.CODEX_CLOUDFLARED_BIN,
    process.env.DIALTONE_CLOUDFLARED_BIN,
    join(workspaceRoot, '.runtime', 'cloudflare', platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
    join(homedir(), 'dialtone', 'env', 'cloudflare', platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
    'cloudflared'
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === 'cloudflared') {
      const lookupCommand = platform() === 'win32' ? 'where.exe' : 'which';
      const lookupResult = spawnSync(lookupCommand, ['cloudflared'], {
        encoding: 'utf8',
        windowsHide: true
      });
      if (lookupResult.status === 0 && lookupResult.stdout.trim()) {
        return lookupResult.stdout.split(/\r?\n/)[0].trim();
      }
      continue;
    }

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveDownloadSpec() {
  const currentPlatform = platform();
  const currentArch = arch();

  if (currentPlatform === 'win32' && currentArch === 'x64') {
    return {
      fileName: 'cloudflared.exe',
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    };
  }

  if (currentPlatform === 'linux' && currentArch === 'x64') {
    return {
      fileName: 'cloudflared',
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
    };
  }

  throw new Error(`Automatic cloudflared install is not configured for ${currentPlatform}/${currentArch}. Set CODEX_CLOUDFLARED_BIN.`);
}

async function downloadCloudflared(url: string, destinationPath: string) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const file = createWriteStream(destinationPath);
    const handleResponse = (response: IncomingMessage) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        file.close();
        void downloadCloudflared(response.headers.location, destinationPath).then(resolvePromise, rejectPromise);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        file.close();
        rejectPromise(new Error(`cloudflared download failed with status ${statusCode}.`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolvePromise();
      });
    };

    get(url, handleResponse).on('error', (error) => {
      file.close();
      rejectPromise(error);
    });
  });
}
