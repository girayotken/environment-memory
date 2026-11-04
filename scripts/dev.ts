import { spawn } from 'node:child_process';

const children = ['dev:server', 'dev:client'].map(script => spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { stdio: 'inherit', env: process.env },
));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 200).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
children.forEach(child => child.on('exit', code => { if (!stopping) stop(code ?? 1); }));
