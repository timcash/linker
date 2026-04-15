import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCAL_ENV_FILES = ['.env.local', '.env.codex.local'];

export function loadCodexLocalEnv(workspaceRoot: string) {
  for (const fileName of LOCAL_ENV_FILES) {
    const filePath = resolve(workspaceRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    applyEnvFile(filePath);
  }
}

function applyEnvFile(filePath: string) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
