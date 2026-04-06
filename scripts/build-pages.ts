import {spawn} from 'node:child_process';

const [command, args] =
  process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', 'run', 'build']]
    : ['npm', ['run', 'build']];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_SITE_BASE_PATH: '/linker/',
  },
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
