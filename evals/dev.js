// Runs the evals server and rebuilds the UI each time a UI file changes.
import { spawn } from 'node:child_process';

const commands = [
  'vite build --watch --config evals/ui/vite.config.ts',
  'node --watch evals/server.js',
];

const children = commands.map(command => spawn(command, { stdio: 'inherit', shell: true }));

const stop = () => {
  for (const child of children) child.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
