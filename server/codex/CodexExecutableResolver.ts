import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexBridgeHealth } from '../../shared/codex/CodexBridgeTypes';

export interface CodexLaunchCommand {
  executablePath: string;
  args: string[];
  commandLabel: string;
}

export class CodexExecutableResolver {
  private readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  public resolve() {
    const explicitExecutable = process.env.CODEX_EXECUTABLE;
    if (explicitExecutable && isLaunchable(explicitExecutable)) {
      return buildLaunchCommand(explicitExecutable);
    }

    const sandboxExecutable = join(
      homedir(),
      '.codex',
      '.sandbox-bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex'
    );
    if (isLaunchable(sandboxExecutable)) {
      return buildLaunchCommand(sandboxExecutable);
    }

    const executableFromPath = this.resolveFromPath();
    if (executableFromPath) {
      return buildLaunchCommand(executableFromPath);
    }

    return buildLaunchCommand(process.platform === 'win32' ? 'codex.exe' : 'codex');
  }

  public buildHealth(publicOrigin: string, sessionTtlSeconds: number) {
    try {
      const command = this.resolve();
      const health: CodexBridgeHealth = {
        ok: true,
        platform: process.platform,
        cwd: this.cwd,
        executablePath: command.executablePath,
        commandLabel: command.commandLabel,
        publicOrigin,
        sessionTtlSeconds
      };
      return health;
    } catch (error) {
      const health: CodexBridgeHealth = {
        ok: false,
        platform: process.platform,
        cwd: this.cwd,
        executablePath: null,
        commandLabel: null,
        publicOrigin,
        sessionTtlSeconds,
        error: error instanceof Error ? error.message : 'Unable to resolve a Codex executable.'
      };
      return health;
    }
  }

  private resolveFromPath() {
    const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
    const lookupResult = spawnSync(lookupCommand, ['codex'], {
      encoding: 'utf8',
      windowsHide: true
    });

    if (lookupResult.status !== 0 || !lookupResult.stdout) {
      return null;
    }

    const candidates = lookupResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return candidates.find(isLaunchable) ?? candidates[0] ?? null;
  }
}

function buildLaunchCommand(executablePath: string): CodexLaunchCommand {
  const args = shouldUseDangerousBridgeMode() ? ['--dangerously-bypass-approvals-and-sandbox'] : [];

  return {
    executablePath,
    args,
    commandLabel: [executablePath, ...args].join(' ')
  };
}

function isLaunchable(filePath: string) {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldUseDangerousBridgeMode() {
  return process.env.CODEX_BRIDGE_DANGEROUS_MODE !== '0';
}
