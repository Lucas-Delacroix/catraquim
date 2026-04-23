import { spawn } from 'node:child_process';

const child = spawn('tsx', ['watch', 'src/cli.ts', 'start'], {
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
